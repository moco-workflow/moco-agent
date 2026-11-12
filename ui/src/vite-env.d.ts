/// <reference types="vite/client" />

/**
 * Build-time configuration. Every `VITE_*` the app reads is declared here so a
 * typo is a compile error rather than a silent `undefined` at runtime.
 *
 * The OAuth block is shared verbatim with the other Moco SPAs — keep it in step
 * with `moco-ui/src/vite-env.d.ts`.
 */
interface ImportMetaEnv {
  /** Base path the SPA is served under, e.g. `/apps/moco-agent`. */
  readonly VITE_APP_BASE?: string;

  /** OAuth2 authorization endpoint. */
  readonly VITE_OAUTH_AUTHORIZE_URL?: string;
  /** OAuth2 token endpoint, used for both the code exchange and refreshes. */
  readonly VITE_OAUTH_TOKEN_URL?: string;
  readonly VITE_OAUTH_CLIENT_ID?: string;
  /**
   * Only for providers that require it. Anything here ships in the browser
   * bundle and is therefore public — PKCE is what actually secures the flow.
   * Omitted from the token request entirely when unset.
   */
  readonly VITE_OAUTH_CLIENT_SECRET?: string;
  readonly VITE_OAUTH_SCOPE?: string;
  /**
   * Callback path, origin-relative and complete — NOT prefixed with
   * `VITE_APP_BASE`. Must match the URI registered with the provider.
   * The agent UI does not own that URI, so in a deployed build this
   * points at the console's callback, which completes the exchange and
   * bounces the browser back here.
   */
  readonly VITE_OAUTH_REDIRECT_URI_PATH?: string;
  /**
   * Extra query parameters for the authorize request, as a query-string
   * fragment. Google needs `access_type=offline&prompt=consent` to issue a
   * refresh token at all.
   */
  readonly VITE_OAUTH_EXTRA_AUTH_PARAMS?: string;

  /**
   * Which token goes on the Authorization header: `access_token` (bsso, whose
   * access token is a JWT) or `id_token` (Google, whose access token is
   * opaque). Must agree with the server's `MOCO_JWT_USER_ID_CLAIM`.
   */
  readonly VITE_AUTH_TOKEN_TYPE?: 'access_token' | 'id_token';

  /** API key used as the credential for guest mode. Unset = unauthenticated. */
  readonly VITE_GUEST_APIKEY?: string;

  /** Moco server base URL. Empty means same origin. */
  readonly VITE_API_BASE_URL?: string;

  /**
   * Default `execute_mode` for workflow calls outside the chat (Settings,
   * knowledge, lookups). Unset = the server's default (`workflow`). Chat always
   * runs as `workflow` regardless.
   */
  readonly VITE_EXECUTE_MODE?: 'in-memory' | 'standalone-activity' | 'workflow';
  /**
   * Default `enable_otel_trace` (`true` | `false`) for the same calls. Unset =
   * the server's default (off). Chat is always traced regardless.
   */
  readonly VITE_ENABLE_OTEL_TRACE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
