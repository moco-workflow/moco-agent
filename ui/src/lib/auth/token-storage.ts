export const STORAGE_KEYS = {
  ACCESS_TOKEN: 'oauth_access_token',
  REFRESH_TOKEN: 'oauth_refresh_token',
  ID_TOKEN: 'oauth_id_token',
  // Expiry is tracked per token because the two do not share a clock and
  // either one may be the token we actually send. The access token's comes
  // from the response's `expires_in`; the ID token's from its own `exp` claim.
  ACCESS_TOKEN_EXPIRY: 'oauth_access_token_expiry',
  ID_TOKEN_EXPIRY: 'oauth_id_token_expiry',
  // Superseded by ACCESS_TOKEN_EXPIRY. Kept in the map so removeAllTokens()
  // still clears sessions written by an older build; never written again.
  TOKEN_EXPIRY: 'oauth_token_expiry',
  GUEST_MODE: 'moco_guest_mode',
  // API-key session (the hidden admin sign-in): the key itself, sent as the
  // Bearer credential, and the identity the server resolved it to (JSON).
  API_KEY: 'moco_apikey',
  API_KEY_USER: 'moco_apikey_user',
} as const;

export const PKCE_KEYS = {
  CODE_VERIFIER: 'oauth_code_verifier',
  STATE: 'oauth_state',
  // Epoch ms of the last re-authentication redirect, used to break a redirect
  // loop when the provider hands back a session that immediately fails again.
  REAUTH_AT: 'oauth_reauth_at',
} as const;

const MIGRATION_KEY = 'oauth_storage_migrated';

// Token storage (localStorage — shared across tabs and same-origin SPAs)

export function getToken(key: string): string | null {
  return localStorage.getItem(key);
}

export function setToken(key: string, value: string): void {
  localStorage.setItem(key, value);
}

export function removeToken(key: string): void {
  localStorage.removeItem(key);
}

export function removeAllTokens(): void {
  for (const key of Object.values(STORAGE_KEYS)) {
    localStorage.removeItem(key);
  }
}

// PKCE storage (sessionStorage — tab-scoped, not shared)

export function getPkce(key: string): string | null {
  return sessionStorage.getItem(key);
}

export function setPkce(key: string, value: string): void {
  sessionStorage.setItem(key, value);
}

export function removePkce(key: string): void {
  sessionStorage.removeItem(key);
}

// One-time migration from sessionStorage to localStorage for existing sessions
export function migrateFromSessionStorage(): void {
  if (localStorage.getItem(MIGRATION_KEY)) return;

  for (const key of Object.values(STORAGE_KEYS)) {
    const value = sessionStorage.getItem(key);
    if (value && !localStorage.getItem(key)) {
      localStorage.setItem(key, value);
    }
    sessionStorage.removeItem(key);
  }

  localStorage.setItem(MIGRATION_KEY, Date.now().toString());
}
