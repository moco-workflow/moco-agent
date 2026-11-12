import { executeWorkflow } from './api-client';
import { encryptSecret, fetchPublicKeyPem } from './secret-crypto';

/**
 * Secret NAMES, for typeahead on the four key-name fields (chat, embedding, web,
 * pgvector). Deliberately not routed through agent-admin: that workflow then has
 * no dependency on the secret store at all and cannot leak a VALUE, and
 * `sys.secret` is already a versioned system contract behind the same auth.
 *
 * builtin.secret.list returns a plain string[] of names.
 */

const SECRET_TIMEOUT_MS = 15_000;

export interface SecretNames {
  /** The caller's own secrets, referenced by bare NAME. */
  user: string[];
  /** Shared secrets, referenced as `global/NAME`. */
  global: string[];
}

async function listScope(
  inGlobalNs: boolean,
  token: string | null | undefined,
  signal?: AbortSignal
): Promise<string[]> {
  try {
    const result = await executeWorkflow(
      'sys.secret',
      { operator: 'list', in_global_ns: inGlobalNs },
      token,
      { timeoutMs: SECRET_TIMEOUT_MS, signal }
    );
    return Array.isArray(result) ? (result as string[]) : [];
  } catch {
    // Typeahead is a convenience. A user who cannot list secrets can still type
    // a name, so failing here must not block the settings form from loading.
    return [];
  }
}

export async function listSecretNames(
  token: string | null | undefined,
  signal?: AbortSignal
): Promise<SecretNames> {
  const [user, global] = await Promise.all([
    listScope(false, token, signal),
    listScope(true, token, signal),
  ]);
  return { user, global };
}

/**
 * How a name is written into a `*_secret_key` field. Matches parse_secret_key in
 * moco-core's secret_resolver: a bare name is user-scoped, `global/` prefixed is
 * shared.
 */
export function toSecretKey(name: string, scope: 'user' | 'global'): string {
  return scope === 'global' ? `global/${name}` : name;
}

/** All selectable options, already in `*_secret_key` form. */
export function secretKeyOptions(names: SecretNames): string[] {
  return [...names.user, ...names.global.map((n) => toSecretKey(n, 'global'))];
}

/**
 * Store a secret VALUE under a name, so a first-time user can fix a missing model
 * key where the setup guide shows it (F70). The value is encrypted in the browser
 * with the server's public key (as moco-ui does) and never passes through
 * agent-admin. `global` writes the shared store (admins).
 */
export async function uploadSecret(
  name: string,
  value: string,
  scope: 'user' | 'global',
  token: string | null | undefined
): Promise<void> {
  const publicKeyPem = await fetchPublicKeyPem();
  const encrypted = await encryptSecret(value, publicKeyPem);
  await executeWorkflow(
    'sys.secret',
    { operator: 'upload', secret_name: name, encrypted_secret: encrypted, in_global_ns: scope === 'global' },
    token,
    { timeoutMs: SECRET_TIMEOUT_MS }
  );
}

/** `global/NAME` -> {name: NAME, scope: global}; a bare name is the caller's own. */
export function parseSecretKey(key: string): { name: string; scope: 'user' | 'global' } {
  return key.startsWith('global/') ? { name: key.slice('global/'.length), scope: 'global' } : { name: key, scope: 'user' };
}
