/**
 * The `verifyApiKey` for `AuthProvider`: registers a session with the key by
 * running `sys.user_session` (operator `login`). The server rejects an unknown,
 * revoked or expired key; on success the result names the account the key
 * belongs to.
 *
 * Plain fetch against `/api/workflow/execute` rather than an app's API client,
 * so this file is shared verbatim across the Moco SPAs like the rest of
 * `lib/auth`. `apiBaseUrl` is the app's API origin ('' for same-origin).
 */
export function createApiKeyVerifier(apiBaseUrl: string) {
  return async (apiKey: string) => {
    const res = await fetch(`${apiBaseUrl}/api/workflow/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        wfspec_info: { name: 'sys.user_session', version: '1.0.0' },
        input_data: { operator: 'login' },
      }),
    });

    if (res.status === 401 || res.status === 403) {
      throw new Error('The API key was not accepted');
    }
    if (!res.ok) {
      throw new Error(`Sign-in failed: HTTP ${res.status} ${res.statusText}`);
    }

    const result = (await res.json()) as {
      user_account_info?: { user_id?: string; display_name?: string; email?: string };
    } | null;
    const account = result?.user_account_info;
    if (!account?.user_id) {
      throw new Error('The server did not return the account for this API key');
    }
    return {
      sub: account.user_id,
      name: account.display_name || account.user_id,
      email: account.email || undefined,
    };
  };
}
