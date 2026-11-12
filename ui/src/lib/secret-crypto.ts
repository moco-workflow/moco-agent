/**
 * Ported from moco-ui (src/lib/crypto/secret-crypto.ts); keep the two in step.
 *
 * Client-side RSA-OAEP + Fernet hybrid encryption for secrets using the WebCrypto API.
 * Uses hybrid approach: generate a random Fernet key, encrypt data with it (symmetric),
 * then RSA-encrypt only the key. This avoids RSA payload size limits.
 *
 * Produces the EncryptedClientData format expected by builtin.secret.upload:
 *   { encrypted_client_key: { encrypted_data, encrypt_key_name }, encrypted_client_data }
 *
 * The RSA public key is served statically at /public/rsa_encrypt_public_key.pem.
 */

export interface EncryptedData {
  encrypted_data: string;   // base64-encoded RSA-OAEP ciphertext
  encrypt_key_name: string; // env-var key name on the server (e.g. RSA_PRIVATE_KEY_<sha1>)
}

export interface EncryptedSecret {
  encrypted_client_key: EncryptedData;
  encrypted_client_data: string;
}

async function buildKeyName(publicKeyPem: string): Promise<string> {
  const data = new TextEncoder().encode(publicKeyPem);
  const hashBuffer = await crypto.subtle.digest('SHA-1', data);
  const hex = Array.from(new Uint8Array(hashBuffer), (b) =>
    b.toString(16).padStart(2, '0')
  ).join('');
  return `RSA_PRIVATE_KEY_${hex}`;
}

/**
 * Fetch the server's RSA public key PEM from /public/rsa_encrypt_public_key.pem.
 */
export async function fetchPublicKeyPem(): Promise<string> {
  const response = await fetch('/public/rsa_encrypt_public_key.pem');
  if (!response.ok) {
    throw new Error(`Failed to fetch RSA public key: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

/**
 * URL-safe base64 encode (matches Python's base64.urlsafe_b64encode, with padding).
 */
function toUrlSafeBase64(buffer: Uint8Array): string {
  const standard = btoa(Array.from(buffer, (b) => String.fromCharCode(b)).join(''));
  return standard.replace(/\+/g, '-').replace(/\//g, '_');
}

/**
 * Standard base64 encode a string's UTF-8 bytes.
 */
function toBase64(str: string): string {
  return btoa(str);
}

/**
 * Generate a 32-byte random Fernet-compatible key as URL-safe base64 with padding.
 */
function generateFernetKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return toUrlSafeBase64(bytes);
}

/**
 * Fernet-encrypt data with a Fernet-compatible scheme (AES-128-CBC + HMAC-SHA256).
 * Matches Python's cryptography.fernet.Fernet format:
 *   Version (1) || Time (8) || IV (16) || Ciphertext || HMAC-SHA256 (32)
 * Returns standard-base64-encoded Fernet token (matching Python's to_b64str wrapping).
 */
async function fernetEncrypt(data: string, keyBase64: string): Promise<string> {
  // Decode URL-safe base64 key → 32 bytes (16 signing + 16 encryption)
  const standardB64 = keyBase64.replace(/-/g, '+').replace(/_/g, '/');
  const keyBytes = Uint8Array.from(atob(standardB64), (c) => c.charCodeAt(0));
  const signingKey = keyBytes.slice(0, 16);
  const encryptionKey = keyBytes.slice(16, 32);

  const iv = crypto.getRandomValues(new Uint8Array(16));
  const timestamp = BigInt(Math.floor(Date.now() / 1000));

  // AES-128-CBC encrypt
  const aesKey = await crypto.subtle.importKey(
    'raw', encryptionKey, { name: 'AES-CBC' }, false, ['encrypt']
  );
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, aesKey, new TextEncoder().encode(data))
  );

  // Build token payload: version || timestamp || iv || ciphertext
  const versionByte = new Uint8Array([0x80]);
  const timeBuf = new Uint8Array(8);
  const view = new DataView(timeBuf.buffer);
  view.setBigUint64(0, timestamp, false);

  const payload = new Uint8Array(1 + 8 + 16 + ciphertext.length);
  payload.set(versionByte, 0);
  payload.set(timeBuf, 1);
  payload.set(iv, 9);
  payload.set(ciphertext, 25);

  // HMAC-SHA256 over the payload
  const hmacKey = await crypto.subtle.importKey(
    'raw', signingKey, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const hmac = new Uint8Array(await crypto.subtle.sign('HMAC', hmacKey, payload));

  // Fernet token: payload || hmac → URL-safe base64 with padding
  const token = new Uint8Array(payload.length + hmac.length);
  token.set(payload, 0);
  token.set(hmac, payload.length);
  const fernetToken = toUrlSafeBase64(token);

  // Standard base64 wrapping (matches Python's encrypt_util.to_b64str)
  return toBase64(fernetToken);
}

/**
 * RSA-OAEP encrypt a small payload (the Fernet key) with the server's public key.
 */
async function rsaEncrypt(data: string, publicKeyPem: string): Promise<EncryptedData> {
  const pemBody = publicKeyPem
    .replace(/-----BEGIN PUBLIC KEY-----/, '')
    .replace(/-----END PUBLIC KEY-----/, '')
    .replace(/\s+/g, '');
  const derBytes = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    'spki',
    derBytes,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['encrypt']
  );

  const expiresAt = new Date(Date.now() + 30_000).toISOString();
  const payload = JSON.stringify({ data, expires_at: expiresAt });

  const encrypted = await crypto.subtle.encrypt(
    { name: 'RSA-OAEP' },
    cryptoKey,
    new TextEncoder().encode(payload)
  );

  const base64 = btoa(
    Array.from(new Uint8Array(encrypted), (b) => String.fromCharCode(b)).join('')
  );

  const keyName = await buildKeyName(publicKeyPem);
  return { encrypted_data: base64, encrypt_key_name: keyName };
}

/**
 * Hybrid-encrypt a secret value of any size.
 * 1. Generate random Fernet key
 * 2. Encrypt the secret value with Fernet (symmetric, no size limit)
 * 3. RSA-encrypt only the Fernet key (small, fits in RSA)
 */
export async function encryptSecret(value: string, publicKeyPem: string): Promise<EncryptedSecret> {
  const clientKey = generateFernetKey();
  const encryptedClientData = await fernetEncrypt(value, clientKey);
  const encryptedClientKey = await rsaEncrypt(clientKey, publicKeyPem);

  return {
    encrypted_client_key: encryptedClientKey,
    encrypted_client_data: encryptedClientData,
  };
}
