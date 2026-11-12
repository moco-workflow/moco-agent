import { generateCodeVerifier, generateCodeChallenge, generateState } from './pkce-utils';
import { PKCE_KEYS, setPkce, getPkce, removePkce } from './token-storage';

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  id_token?: string;
}

export interface OAuthConfig {
  authorizeUrl: string;
  tokenUrl: string;
  clientId: string;
  redirectUri: string;
  clientSecret?: string; // Optional, not used in PKCE flow
  scope: string;
  /**
   * Provider-specific extras appended to the authorize request, as a query
   * string fragment. Google needs `access_type=offline&prompt=consent` or it
   * never issues a refresh token at all; bsso needs nothing.
   */
  extraAuthParams?: string;
  /**
   * Where to come back to when no explicit `returnTo` is given.
   *
   * Set only when the redirect URI points at a *different* app on this origin:
   * the IdP has one registered callback, so the app that owns it completes the
   * exchange and then bounces the browser to this URL. Tokens are in shared
   * same-origin storage by then, so the session survives the hop.
   */
  defaultReturnTo?: string;
}

/**
 * A failed refresh, carrying enough detail to decide whether the session is
 * actually dead or we just could not reach the provider.
 *
 * This distinction is the whole re-authentication policy: `invalid_grant` means
 * the refresh token is spent or revoked and only the user can fix it, while a
 * network drop or a provider 5xx must leave the session intact so the next
 * request can retry.
 */
export class TokenRefreshError extends Error {
  readonly status: number;
  readonly oauthError?: string;

  constructor(message: string, status: number, oauthError?: string) {
    super(message);
    this.name = 'TokenRefreshError';
    this.status = status;
    this.oauthError = oauthError;
  }

  /** True when re-authenticating is the only way forward. */
  get isUnrecoverable(): boolean {
    if (
      this.oauthError === 'invalid_grant' ||
      this.oauthError === 'invalid_client' ||
      this.oauthError === 'unauthorized_client'
    ) {
      return true;
    }
    // A bare 400/401 with no parseable error code still means the provider
    // rejected the grant rather than failed to serve it.
    return this.status === 400 || this.status === 401;
  }
}

/** Pull the RFC 6749 `error` code out of a token endpoint error body, if present. */
function parseOAuthError(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body);
    return typeof parsed?.error === 'string' ? parsed.error : undefined;
  } catch {
    return undefined;
  }
}

export class OAuth2Client {
  private config: OAuthConfig;

  constructor(config: OAuthConfig) {
    this.config = config;
  }

  /**
   * Client credentials for the token endpoint.
   *
   * `client_secret` is omitted entirely when unset rather than sent empty:
   * Google answers `invalid_client` to `client_secret=`, which would make the
   * whole Google flow unusable.
   */
  private clientParams(): Record<string, string> {
    const params: Record<string, string> = { client_id: this.config.clientId };
    if (this.config.clientSecret) {
      params.client_secret = this.config.clientSecret;
    }
    return params;
  }

  /**
   * Initiate OAuth2 PKCE login flow
   * Redirects to OAuth provider with PKCE parameters
   *
   * @param returnTo Absolute URL to come back to after sign-in. Encoded into
   *   `state` so a session that expired mid-task resumes where it left off.
   *   Defaults to `config.defaultReturnTo`, which is set when another app owns
   *   the callback.
   */
  async initiateLogin(returnTo?: string): Promise<void> {
    // Generate PKCE parameters
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = await generateCodeChallenge(codeVerifier);

    // With a returnTo, `state` becomes a base64 JSON envelope — the shape
    // CallbackPage decodes for cross-app handoff. handleCallback compares
    // state by string equality, so store exactly what we send.
    const csrf = generateState();
    const target = returnTo ?? this.config.defaultReturnTo;
    const state = target ? btoa(JSON.stringify({ csrf, returnTo: target })) : csrf;

    // Store PKCE values in sessionStorage (tab-scoped, not shared)
    setPkce(PKCE_KEYS.CODE_VERIFIER, codeVerifier);
    setPkce(PKCE_KEYS.STATE, state);

    // Build authorization URL
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      scope: this.config.scope,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    // Provider-specific extras (e.g. Google's access_type=offline)
    if (this.config.extraAuthParams) {
      for (const [key, value] of new URLSearchParams(this.config.extraAuthParams)) {
        params.set(key, value);
      }
    }

    const authorizeUrl = `${this.config.authorizeUrl}?${params.toString()}`;

    // Redirect to OAuth provider
    console.log('Redirecting to OAuth provider:', authorizeUrl);
    window.location.href = authorizeUrl;
  }

  /**
   * Handle OAuth callback and exchange authorization code for tokens
   * @param code Authorization code from OAuth provider
   * @param state State parameter from OAuth provider
   * @returns Token response
   */
  async handleCallback(code: string, state: string): Promise<TokenResponse> {
    // Verify state parameter
    console.log('Received OAuth callback with code:', code, 'and state:', state);
    const storedState = getPkce(PKCE_KEYS.STATE);
    if (!storedState || storedState !== state) {
      throw new Error('Invalid state parameter');
    }

    // Get code verifier from storage
    const codeVerifier = getPkce(PKCE_KEYS.CODE_VERIFIER);
    if (!codeVerifier) {
      throw new Error('Code verifier not found');
    }

    // Exchange code for tokens
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.config.redirectUri,
      ...this.clientParams(),
      code_verifier: codeVerifier,
    });

    console.log('Exchanging code for tokens with params:', params.toString());
    const response = await fetch(this.config.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const error = await response.text();
      console.log('Token exchange error:', error);
      throw new Error(`Token exchange failed: ${error}`);
    }

    const tokenResponse: TokenResponse = await response.json();
    console.log('Token exchange successful:', tokenResponse);

    // Clean up PKCE values
    removePkce(PKCE_KEYS.CODE_VERIFIER);
    removePkce(PKCE_KEYS.STATE);

    return tokenResponse;
  }

  /**
   * Refresh access token using refresh token
   * @param refreshToken Refresh token
   * @returns New token response
   * @throws {TokenRefreshError} on any non-2xx response from the provider
   */
  async refreshToken(refreshToken: string): Promise<TokenResponse> {
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      ...this.clientParams(),
    });

    const response = await fetch(this.config.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new TokenRefreshError(
        `Token refresh failed: ${error}`,
        response.status,
        parseOAuthError(error)
      );
    }

    return await response.json();
  }
}

/**
 * Where this app is mounted. Also the router basename. A lone "/" is the same
 * as no base; normalising it keeps the path maths below from doubling a slash.
 */
const appBasePath = (): string => (import.meta.env.VITE_APP_BASE || '').replace(/\/$/, '');

/**
 * The callback path, origin-relative and complete — it is NOT prefixed with
 * `VITE_APP_BASE`. The IdP registers one absolute URI, and an app deployed
 * under a sub-path often has to point at a *sibling's* callback rather than one
 * beneath its own base, so deriving this from the base cannot work.
 */
const callbackPath = (): string => import.meta.env.VITE_OAUTH_REDIRECT_URI_PATH || '';

/**
 * Whether the callback lands back inside this app, or in a sibling that owns
 * the one URI registered with the IdP. Inferred rather than configured, so an
 * app gets it right from the two vars it already has to set.
 */
const ownsCallback = (): boolean => {
  const base = appBasePath();
  const path = callbackPath();
  return base === '' || path === base || path.startsWith(`${base}/`);
};

/**
 * The route path at which this app should render its callback page.
 *
 * The redirect URI is origin-relative, but the router matches against paths
 * relative to its basename, so the base has to come back off. When a sibling
 * app owns the callback this route is never reached; it stays registered as the
 * dev fallback.
 */
export function getCallbackRoutePath(): string {
  if (!ownsCallback()) return '/callback';
  const base = appBasePath();
  const path = callbackPath();
  return (base ? path.slice(base.length) : path) || '/callback';
}

/**
 * Create OAuth2Client instance from environment variables
 */
export function createOAuthClient(): OAuth2Client {
  // Guard each part: an unset env var would otherwise stringify as "undefined"
  // and silently produce a redirect_uri the provider has never seen.
  const appBase = appBasePath();
  const redirectUri = `${window.location.origin}${callbackPath()}`;

  const config: OAuthConfig = {
    authorizeUrl: import.meta.env.VITE_OAUTH_AUTHORIZE_URL || '',
    tokenUrl: import.meta.env.VITE_OAUTH_TOKEN_URL || '',
    clientId: import.meta.env.VITE_OAUTH_CLIENT_ID || '',
    redirectUri,
    clientSecret: import.meta.env.VITE_OAUTH_CLIENT_SECRET || '',
    scope: import.meta.env.VITE_OAUTH_SCOPE || 'openid profile email',
    extraAuthParams: import.meta.env.VITE_OAUTH_EXTRA_AUTH_PARAMS || '',
    defaultReturnTo: ownsCallback() ? undefined : `${window.location.origin}${appBase}`,
  };

  // Warn rather than throw: an incomplete OAuth config must not break guest
  // mode, which needs none of it. The login button is what will fail.
  if (!config.authorizeUrl || !config.tokenUrl || !config.clientId) {
    console.error(
      '[Auth] OAuth configuration is incomplete — SSO login will not work. ' +
        'Check VITE_OAUTH_AUTHORIZE_URL, VITE_OAUTH_TOKEN_URL and VITE_OAUTH_CLIENT_ID.'
    );
  }

  return new OAuth2Client(config);
}
