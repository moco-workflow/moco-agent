import { createContext, useContext, useState, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { jwtDecode } from 'jwt-decode';
import { createOAuthClient, TokenRefreshError } from './oauth-client';
import type { TokenResponse } from './oauth-client';
import {
  STORAGE_KEYS,
  PKCE_KEYS,
  getToken,
  setToken,
  removeToken,
  removeAllTokens,
  getPkce,
  setPkce,
  removePkce,
  migrateFromSessionStorage,
} from './token-storage';

interface User {
  email?: string;
  name?: string;
  sub?: string;
  [key: string]: unknown;
}

type TokenType = 'access_token' | 'id_token';

interface AuthContextType {
  accessToken: string | null;
  refreshToken: string | null;
  idToken: string | null;
  user: User | null;
  /** Human-readable label for the signed-in user; see `displayNameOf`. */
  displayName: string | null;
  isAuthenticated: boolean;
  isGuest: boolean;
  /**
   * The server runs with auth disabled (`MOCO_AUTH_ENABLED=false`): every
   * request runs as one fixed user, so there is no login and no logout.
   */
  isAuthDisabled: boolean;
  /** Signed in with an API key rather than OAuth; see `loginWithApiKey`. */
  isApiKeySession: boolean;
  isLoading: boolean;
  login: () => Promise<void>;
  loginAsGuest: () => Promise<void>;
  /** Sign in with an API key. Rejects, storing nothing, if the key is not accepted. */
  loginWithApiKey: (apiKey: string) => Promise<void>;
  logout: () => void;
  getAccessToken: () => Promise<string | null>;
  getAuthToken: () => Promise<string | null>;
  handleCallback: (code: string, state: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

/**
 * Which token this build puts on the wire, from VITE_AUTH_TOKEN_TYPE.
 *
 * The right answer is provider-specific: bsso issues a JWT access token, so it
 * sends that; Google's access token is an opaque string the server cannot
 * validate, so a Google build sends the ID token instead and skips the extra
 * round trip to Google's userinfo endpoint.
 *
 * An unrecognised value is a configuration bug, not a preference — say so
 * rather than silently defaulting (a `accesss_token` typo shipped unnoticed
 * exactly this way).
 */
const getConfiguredTokenType = (): TokenType => {
  const tokenType = import.meta.env.VITE_AUTH_TOKEN_TYPE;
  if (tokenType === 'id_token' || tokenType === 'access_token') {
    return tokenType;
  }
  if (tokenType) {
    console.error(
      `[Auth] VITE_AUTH_TOKEN_TYPE="${tokenType}" is not recognised ` +
        '(expected "access_token" or "id_token"); falling back to access_token.'
    );
  }
  return 'access_token';
};

// Guest mode has no OAuth tokens, so it authenticates with a pre-provisioned
// API key instead. The server accepts it on the same Authorization: Bearer
// header. Unset means guest requests go out unauthenticated, as before.
const getGuestApiKey = (): string | null => {
  const apiKey = import.meta.env.VITE_GUEST_APIKEY;
  return typeof apiKey === 'string' && apiKey.length > 0 ? apiKey : null;
};

// How long before expiry we consider the selected token stale. Refresh is
// reactive: a request made inside this window refreshes first rather than
// sending a token that may die in flight. Nothing refreshes on a timer, so an
// idle tab makes no network calls at all.
const REFRESH_LEEWAY_MS = 30_000;

// If a re-authentication round trip does not produce a working session within
// this window, stop bouncing to the provider and let the user land on /login.
const REAUTH_LOOP_GUARD_MS = 30_000;

/** Epoch ms of a JWT's `exp`, or null if the token is opaque or unparseable. */
const decodeExpiry = (token: string | null): number | null => {
  if (!token) return null;
  try {
    const { exp } = jwtDecode<{ exp?: number }>(token);
    return typeof exp === 'number' ? exp * 1000 : null;
  } catch {
    return null;
  }
};

/**
 * User identity, preferring the ID token.
 *
 * The ID token is the one OIDC actually defines as carrying identity claims,
 * and unlike the access token it is a JWT for every provider we support —
 * decoding the access token first would yield nothing at all on Google.
 */
const decodeIdentity = (idToken: string | null, accessToken: string | null): User | null => {
  for (const candidate of [idToken, accessToken]) {
    if (!candidate) continue;
    try {
      return jwtDecode<User>(candidate);
    } catch {
      // Opaque or malformed — try the next one.
    }
  }
  return null;
};

/**
 * A label for the signed-in user, or null if there is nothing to show.
 *
 * Providers disagree on what an ID token carries: Google sends `name` and
 * `email`, bsso sends neither — only `sub`. Falling back to `sub` keeps the UI
 * from rendering an empty element, and what it shows is exactly the identity
 * the server resolved the caller to, since `MOCO_JWT_USER_ID_CLAIM` is `sub`
 * for an id_token build.
 */
const displayNameOf = (user: User | null): string | null => {
  if (!user) return null;
  const label = user.email || user.name || user.sub;
  return typeof label === 'string' && label.length > 0 ? label : null;
};

/** The identity stored with an API-key session, or null if there is none. */
const readApiKeyUser = (): User | null => {
  const raw = getToken(STORAGE_KEYS.API_KEY_USER);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
};

/**
 * The user every request runs as if the server has auth disabled, else null.
 *
 * Any failure — unreachable, an older server without the endpoint, an
 * unexpected body — reads as "auth is on", which only costs a login page.
 */
const fetchAuthDisabledUser = async (url: string): Promise<string | null> => {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const body = (await response.json()) as { enabled?: unknown; user_id?: unknown };
    return body.enabled === false && typeof body.user_id === 'string' && body.user_id
      ? body.user_id
      : null;
  } catch (error) {
    console.warn('[Auth] Could not read the server auth config; assuming auth is on:', error);
    return null;
  }
};

const storageKeysFor = (tokenType: TokenType) =>
  tokenType === 'id_token'
    ? { token: STORAGE_KEYS.ID_TOKEN, expiry: STORAGE_KEYS.ID_TOKEN_EXPIRY }
    : { token: STORAGE_KEYS.ACCESS_TOKEN, expiry: STORAGE_KEYS.ACCESS_TOKEN_EXPIRY };

const readExpiry = (key: string): number | null => {
  const raw = getToken(key);
  if (!raw) return null;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * The token of a given kind and the deadline it must be refreshed by.
 *
 * Always reads storage rather than React state so a caller holding a stale
 * closure — or a tab that has not yet processed a cross-tab storage event —
 * still sees the current values.
 *
 * Falls back to the access token's expiry when the selected token has none of
 * its own, so a provider that omits `exp` cannot disable refresh entirely, and
 * then to the legacy single-expiry key so sessions already in a user's browser
 * at deploy time are not treated as never expiring.
 */
const readToken = (tokenType: TokenType): { token: string | null; expiry: number | null } => {
  const keys = storageKeysFor(tokenType);
  return {
    token: getToken(keys.token),
    expiry:
      readExpiry(keys.expiry) ??
      readExpiry(STORAGE_KEYS.ACCESS_TOKEN_EXPIRY) ??
      readExpiry(STORAGE_KEYS.TOKEN_EXPIRY),
  };
};

interface AuthProviderProps {
  children: ReactNode;
  /**
   * Called once a sign-in completes — after an OAuth callback or on entering
   * guest mode — with the credential this build puts on the wire.
   *
   * This is the hook for bootstrapping server-side session state. It lives
   * here as a prop rather than as a direct call so this module stays free of
   * any one app's API layer and can be shared verbatim across the Moco SPAs.
   * A rejection is logged, never fatal: failing to register a session must not
   * fail the sign-in.
   */
  onSessionStart?: (token: string | null) => void | Promise<void>;
  /**
   * Verifies an API key for `loginWithApiKey` and returns the identity it
   * resolves to, or rejects if the server does not accept it. Like
   * `onSessionStart` it is a prop so this module stays free of any one app's
   * API layer; without it, API-key sign-in is unavailable. A verifier that
   * registers the session itself means `onSessionStart` is not called again.
   */
  verifyApiKey?: (apiKey: string) => Promise<User>;
  /**
   * The server's `/api/auth/config` URL. Asked once at startup: a server with
   * auth disabled runs every request as one user, so the app skips login and
   * shows that user. Without it the app assumes auth is on.
   */
  authConfigUrl?: string;
}

export function AuthProvider({
  children,
  onSessionStart,
  verifyApiKey,
  authConfigUrl,
}: AuthProviderProps) {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);
  const [idToken, setIdToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [isGuest, setIsGuest] = useState<boolean>(false);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [isAuthDisabled, setIsAuthDisabled] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState(true);

  // Holds the in-flight refresh, if any, so concurrent callers share one
  // request instead of each redeeming the refresh token separately.
  const refreshPromiseRef = useRef<Promise<boolean> | null>(null);

  const oauthClient = createOAuthClient();

  const storeTokens = (tokenResponse: TokenResponse) => {
    // Clear guest mode and any API-key session when storing OAuth tokens — the
    // user has a real session now
    removeToken(STORAGE_KEYS.GUEST_MODE);
    setIsGuest(false);
    removeToken(STORAGE_KEYS.API_KEY);
    removeToken(STORAGE_KEYS.API_KEY_USER);
    setApiKey(null);

    // `expires_in` describes the access token. Prefer it, but fall back to the
    // token's own `exp` for providers that omit it.
    const accessExpiry =
      typeof tokenResponse.expires_in === 'number'
        ? Date.now() + tokenResponse.expires_in * 1000
        : decodeExpiry(tokenResponse.access_token);

    setToken(STORAGE_KEYS.ACCESS_TOKEN, tokenResponse.access_token);
    if (accessExpiry !== null) {
      setToken(STORAGE_KEYS.ACCESS_TOKEN_EXPIRY, accessExpiry.toString());
    }

    if (tokenResponse.refresh_token) {
      setToken(STORAGE_KEYS.REFRESH_TOKEN, tokenResponse.refresh_token);
    }

    if (tokenResponse.id_token) {
      setToken(STORAGE_KEYS.ID_TOKEN, tokenResponse.id_token);
      // The ID token carries its own lifetime, which need not match the access
      // token's — and it is the deadline that matters when we send the ID token.
      const idExpiry = decodeExpiry(tokenResponse.id_token);
      if (idExpiry !== null) {
        setToken(STORAGE_KEYS.ID_TOKEN_EXPIRY, idExpiry.toString());
      }
    }

    // A refresh response may legitimately omit these; when it does the previous
    // values are still the live ones, so don't null out what we kept on disk.
    const effectiveIdToken = tokenResponse.id_token ?? getToken(STORAGE_KEYS.ID_TOKEN);
    setAccessToken(tokenResponse.access_token);
    setRefreshToken(tokenResponse.refresh_token ?? getToken(STORAGE_KEYS.REFRESH_TOKEN));
    setIdToken(effectiveIdToken);

    const identity = decodeIdentity(effectiveIdToken, tokenResponse.access_token);
    if (identity) {
      setUser(identity);
    } else {
      console.warn('[Auth] No decodable identity claims in the token response');
    }
  };

  const clearTokens = () => {
    removeAllTokens();
    setAccessToken(null);
    setRefreshToken(null);
    setIdToken(null);
    setUser(null);
    setIsGuest(false);
    setApiKey(null);
  };

  /**
   * Send the user back to the provider to establish a new session, returning
   * them to the page they were on.
   *
   * Guarded against a redirect loop: if the provider hands back a session that
   * immediately fails again, the second attempt stops here and lets
   * ProtectedRoute fall through to /login instead of ping-ponging.
   */
  const reauthenticate = () => {
    const lastAttempt = getPkce(PKCE_KEYS.REAUTH_AT);
    const now = Date.now();

    clearTokens();

    if (lastAttempt && now - parseInt(lastAttempt, 10) < REAUTH_LOOP_GUARD_MS) {
      console.error('[Auth] Re-authentication just failed; falling back to the login page');
      removePkce(PKCE_KEYS.REAUTH_AT);
      return;
    }

    console.log('[Auth] Re-authenticating with the OAuth provider');
    setPkce(PKCE_KEYS.REAUTH_AT, now.toString());
    void oauthClient.initiateLogin(window.location.href);
  };

  /**
   * Exchange the stored refresh token for a new set of tokens.
   *
   * Single-flight: if a refresh is already running, every other caller awaits
   * that same promise. Providers that rotate refresh tokens invalidate the old
   * value on first use, so firing N parallel refreshes would fail N-1 of them
   * and log the user out.
   *
   * Always reads the refresh token from storage rather than React state, so a
   * caller holding a stale closure still redeems the current value.
   *
   * Resolves true when storage now holds fresh tokens. Callers re-read the
   * token they need rather than taking it as a return value, since which token
   * matters depends on VITE_AUTH_TOKEN_TYPE.
   *
   * @param interactive Whether an unrecoverable failure should bounce the user
   *   straight to the provider. False during startup, where landing on /login
   *   is friendlier and keeps guest mode reachable.
   */
  const performRefresh = ({ interactive }: { interactive: boolean }): Promise<boolean> => {
    if (refreshPromiseRef.current) {
      console.log('[Auth] Joining in-flight token refresh');
      return refreshPromiseRef.current;
    }

    const storedRefreshToken = getToken(STORAGE_KEYS.REFRESH_TOKEN);
    if (!storedRefreshToken) {
      console.log('[Auth] No refresh token available');
      if (interactive) {
        reauthenticate();
      } else {
        clearTokens();
      }
      return Promise.resolve(false);
    }

    const promise = (async (): Promise<boolean> => {
      try {
        console.log('[Auth] Attempting token refresh');
        const tokenResponse = await oauthClient.refreshToken(storedRefreshToken);
        storeTokens(tokenResponse);
        console.log('[Auth] Token refresh successful');
        return true;
      } catch (error) {
        // A provider that could not be reached is not a dead session. Wiping
        // tokens here would turn a network blip into a forced sign-in for a
        // session the refresh token can still redeem. Anything that is not a
        // provider rejection — a network error, a 5xx — is treated that way.
        if (!(error instanceof TokenRefreshError) || !error.isUnrecoverable) {
          console.error('[Auth] Token refresh failed, session kept:', error);
          return false;
        }

        console.error('[Auth] Refresh token rejected by the provider:', error);
        if (interactive) {
          reauthenticate();
        } else {
          clearTokens();
        }
        return false;
      }
    })();

    refreshPromiseRef.current = promise;
    void promise.finally(() => {
      if (refreshPromiseRef.current === promise) {
        refreshPromiseRef.current = null;
      }
    });

    return promise;
  };

  // Run the host app's post-sign-in hook, if it supplied one. Never throws:
  // a failed session bootstrap must not undo a successful sign-in.
  const notifySessionStart = async (token: string | null) => {
    if (!onSessionStart) return;
    try {
      await onSessionStart(token);
    } catch (error) {
      console.error('[Auth] onSessionStart hook failed:', error);
    }
  };

  // Stable handles on the latest performRefresh and notifySessionStart, so the
  // effects below can call them without listing values rebuilt on every render.
  const performRefreshRef = useRef(performRefresh);
  const notifySessionStartRef = useRef(notifySessionStart);
  useEffect(() => {
    performRefreshRef.current = performRefresh;
    notifySessionStartRef.current = notifySessionStart;
  });

  // Initialize auth state from localStorage
  useEffect(() => {
    const initAuth = async () => {
      migrateFromSessionStorage();

      // A server with auth disabled ignores credentials, so whatever is stored
      // is irrelevant: there is one user and nothing to sign in to.
      const disabledUser = authConfigUrl ? await fetchAuthDisabledUser(authConfigUrl) : null;
      if (disabledUser) {
        setIsAuthDisabled(true);
        setUser({ name: disabledUser, sub: disabledUser });
        setIsLoading(false);
        await notifySessionStartRef.current(null);
        return;
      }

      // Check for guest mode first
      const guestMode = getToken(STORAGE_KEYS.GUEST_MODE);
      if (guestMode === 'true') {
        setIsGuest(true);
        setUser({ name: 'Guest', email: 'guest@moco.local' });
        setIsLoading(false);
        return;
      }

      // Then for an API-key session: no expiry, nothing to refresh
      const storedApiKey = getToken(STORAGE_KEYS.API_KEY);
      if (storedApiKey) {
        setApiKey(storedApiKey);
        setUser(readApiKeyUser());
        setIsLoading(false);
        return;
      }

      const storedAccessToken = getToken(STORAGE_KEYS.ACCESS_TOKEN);
      const storedRefreshToken = getToken(STORAGE_KEYS.REFRESH_TOKEN);
      const storedIdToken = getToken(STORAGE_KEYS.ID_TOKEN);
      const { token: selectedToken, expiry } = readToken(getConfiguredTokenType());

      if (selectedToken) {
        const now = Date.now();

        // Check if the token we would actually send is still usable
        if (expiry === null || now + REFRESH_LEEWAY_MS < expiry) {
          setAccessToken(storedAccessToken);
          setRefreshToken(storedRefreshToken);
          setIdToken(storedIdToken);
          setUser(decodeIdentity(storedIdToken, storedAccessToken));
        } else if (storedRefreshToken) {
          // Stale, but we can recover the session without bouncing the user
          // through the provider.
          console.log('[Auth] Stored token is stale, refreshing on startup');
          await performRefreshRef.current({ interactive: false });
        } else {
          // Expired with no way back — clear storage. Deliberately not a
          // provider redirect: /login also offers guest mode.
          clearTokens();
        }
      }

      setIsLoading(false);
    };

    void initAuth();
  }, [authConfigUrl]);

  // Cross-tab sync: detect login/logout from other tabs via localStorage storage event
  useEffect(() => {
    const handleStorageChange = (event: StorageEvent) => {
      if (event.storageArea !== localStorage) return;

      if (event.key === STORAGE_KEYS.ACCESS_TOKEN) {
        if (event.newValue === null) {
          // Another tab logged out
          setAccessToken(null);
          setRefreshToken(null);
          setIdToken(null);
          setUser(null);
          setIsGuest(false);
        } else {
          // Another tab logged in or refreshed tokens
          const { token: selectedToken, expiry } = readToken(getConfiguredTokenType());
          if (selectedToken && (expiry === null || Date.now() < expiry)) {
            const freshIdToken = getToken(STORAGE_KEYS.ID_TOKEN);
            setAccessToken(event.newValue);
            setRefreshToken(getToken(STORAGE_KEYS.REFRESH_TOKEN));
            setIdToken(freshIdToken);
            setUser(decodeIdentity(freshIdToken, event.newValue));
          }
        }
      }

      if (event.key === STORAGE_KEYS.GUEST_MODE) {
        if (event.newValue === 'true') {
          setIsGuest(true);
          setUser({ name: 'Guest', email: 'guest@moco.local' });
        } else if (event.newValue === null) {
          setIsGuest(false);
        }
      }

      if (event.key === STORAGE_KEYS.API_KEY) {
        setApiKey(event.newValue);
        setUser(event.newValue === null ? null : readApiKeyUser());
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  // No proactive refresh timer. An idle tab holds a stale token and recovers on
  // its next request: ensureFreshToken() refreshes inside the leeway window
  // before the call goes out, so the user is never bounced to /login for a
  // session the refresh token can still redeem. A timer here only burned
  // refreshes — and any token whose lifetime fell inside the leeway would
  // reschedule itself on the floor delay, refreshing every few seconds forever.

  const login = async () => {
    await oauthClient.initiateLogin();
  };

  const loginAsGuest = async () => {
    setToken(STORAGE_KEYS.GUEST_MODE, 'true');
    setIsGuest(true);
    setUser({ name: 'Guest', email: 'guest@moco.local' });

    // Initialize user session for guest
    await notifySessionStart(getGuestApiKey());
  };

  const loginWithApiKey = async (key: string) => {
    if (!verifyApiKey) {
      throw new Error('API key sign-in is not available in this app');
    }
    const trimmed = key.trim();
    // Throws on a rejected key, before anything is stored
    const identity = await verifyApiKey(trimmed);

    removeToken(STORAGE_KEYS.GUEST_MODE);
    setIsGuest(false);
    // The identity first: other tabs read it when they see the key change
    setToken(STORAGE_KEYS.API_KEY_USER, JSON.stringify(identity));
    setToken(STORAGE_KEYS.API_KEY, trimmed);
    setApiKey(trimmed);
    setUser(identity);
  };

  const logout = () => {
    if (isAuthDisabled) {
      // Nothing to sign out of; clearing state would only strand the user on /login.
      console.log('[Auth] Logout ignored: the server has auth disabled');
      return;
    }
    console.log('[Auth] Logout called');
    clearTokens();
    // Note: Navigation will happen automatically via ProtectedRoute when isAuthenticated becomes false
  };

  const handleCallback = async (code: string, state: string) => {
    try {
      const tokenResponse = await oauthClient.handleCallback(code, state);
      storeTokens(tokenResponse);

      // Initialize user session using the token this build puts on the wire.
      const tokenType = getConfiguredTokenType();
      const authToken =
        tokenType === 'id_token' ? (tokenResponse.id_token ?? null) : tokenResponse.access_token;
      if (!authToken) {
        console.error(
          '[Auth] VITE_AUTH_TOKEN_TYPE=id_token but the provider returned no id_token. ' +
            'Check that "openid" is in VITE_OAUTH_SCOPE.'
        );
      }
      await notifySessionStart(authToken);
    } catch (error) {
      console.error('Callback error:', error);
      clearTokens();
      throw error;
    }
  };

  /**
   * Refresh, then re-read the token we were actually after.
   *
   * A refresh can succeed and still not renew the selected token: a provider
   * that omits `id_token` from the refresh response leaves an id_token build
   * holding the same expired token, which would 401 and then refresh again on
   * every subsequent request. Catch that here rather than in a loop.
   */
  const refreshAndReread = async (tokenType: TokenType): Promise<string | null> => {
    if (!(await performRefresh({ interactive: true }))) return null;

    const { token, expiry } = readToken(tokenType);
    if (token && expiry !== null && Date.now() + REFRESH_LEEWAY_MS >= expiry) {
      console.error(
        `[Auth] Refresh succeeded but the ${tokenType} is still expired — ` +
          'the provider did not return a new one. Re-authenticating.'
      );
      reauthenticate();
      return null;
    }
    return token;
  };

  /**
   * The freshest token of the requested kind, refreshing first if it dies
   * within the leeway window. This is the only place a refresh is triggered
   * while the app is running: the caller needs a token now.
   */
  const ensureFreshToken = async (tokenType: TokenType): Promise<string | null> => {
    const { token, expiry } = readToken(tokenType);

    if (!token) {
      // A refresh token means this is recoverable — the selected token may
      // simply never have been stored (e.g. an id_token build whose last
      // refresh response omitted it).
      if (getToken(STORAGE_KEYS.REFRESH_TOKEN)) {
        console.log(`[Auth] No ${tokenType} stored, refreshing`);
        return refreshAndReread(tokenType);
      }
      console.warn(`[Auth] No ${tokenType} available and nothing to refresh with`);
      return null;
    }

    if (expiry !== null && Date.now() + REFRESH_LEEWAY_MS >= expiry) {
      console.log(`[Auth] ${tokenType} expiring within the leeway window, refreshing`);
      return refreshAndReread(tokenType);
    }

    return token;
  };

  const getAccessToken = async (): Promise<string | null> => ensureFreshToken('access_token');

  /**
   * The credential to put on the Authorization header.
   *
   * Never falls back to the other token kind: sending an access token where the
   * server expects an ID token (or, on Google, sending an opaque string at all)
   * fails as an indistinguishable 401 rather than as the configuration error it
   * is.
   */
  const getAuthToken = async (): Promise<string | null> => {
    // The server ignores credentials when auth is disabled; send none.
    if (isAuthDisabled) {
      return null;
    }

    // Guests hold an API key, not OAuth tokens — nothing to refresh.
    if (isGuest) {
      const guestApiKey = getGuestApiKey();
      console.log('[Auth] Guest mode, guest API key:', guestApiKey ? 'present' : 'not configured');
      return guestApiKey;
    }

    // An API key does not expire on a clock — nothing to refresh. Read from
    // storage so a stale closure still sends the current key.
    const storedApiKey = getToken(STORAGE_KEYS.API_KEY);
    if (storedApiKey) {
      return storedApiKey;
    }

    const tokenType = getConfiguredTokenType();
    const token = await ensureFreshToken(tokenType);
    if (!token) {
      console.warn(`[Auth] No usable ${tokenType} for this request`);
      return null;
    }

    // Producing a credential is what retires the loop guard. Doing it any
    // earlier — on a successful refresh, or on the callback — would re-arm a
    // redirect loop in exactly the case the guard exists for: a provider that
    // keeps handing back a session which still yields no usable token.
    removePkce(PKCE_KEYS.REAUTH_AT);
    return token;
  };

  // Track the token this build actually sends, not always the access token: an
  // id_token build with no ID token has no usable credential, however healthy
  // its access token looks. Deliberately ignores expiry — a stale token whose
  // refresh token is still good must not bounce an idle tab to /login.
  const selectedToken = getConfiguredTokenType() === 'id_token' ? idToken : accessToken;

  const value: AuthContextType = {
    accessToken,
    refreshToken,
    idToken,
    user,
    displayName: displayNameOf(user),
    isAuthenticated: isAuthDisabled || !!selectedToken || isGuest || !!apiKey,
    isGuest,
    isAuthDisabled,
    isApiKeySession: !!apiKey,
    isLoading,
    login,
    loginAsGuest,
    loginWithApiKey,
    logout,
    getAccessToken,
    getAuthToken,
    handleCallback,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
