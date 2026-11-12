/**
 * Generate a random code verifier for PKCE
 * @returns base64url-encoded random string
 */
export function generateCodeVerifier(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return base64UrlEncode(array);
}

/**
 * Generate a code challenge from a code verifier
 * @param verifier The code verifier
 * @returns base64url-encoded SHA-256 hash of the verifier
 */
export async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(new Uint8Array(hash));
}

/**
 * Base64URL encode a byte array
 * @param buffer Uint8Array to encode
 * @returns base64url-encoded string
 */
export function base64UrlEncode(buffer: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...Array.from(buffer)));
  return base64
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/**
 * Generate a random state parameter for OAuth flow
 * @returns random string
 */
export function generateState(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return base64UrlEncode(array);
}
