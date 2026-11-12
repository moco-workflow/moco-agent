import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth/auth-context';
import { listSecretNames, secretKeyOptions } from '@/lib/secret-api';

/**
 * Secret names for typeahead. Fetched once per mount; the list changes rarely
 * and a stale entry costs nothing, since the field accepts free text anyway.
 */
export function useSecretNames(): { options: string[] } {
  const { getAuthToken, isGuest, isAuthDisabled } = useAuth();
  const [options, setOptions] = useState<string[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const token = await getAuthToken();
      // A null token for a signed-in user means a
      // redirect is imminent, so there is nobody left to show a list to.
      if (token === null && !isGuest && !isAuthDisabled) return;
      const names = await listSecretNames(token, controller.signal);
      if (!controller.signal.aborted) setOptions(secretKeyOptions(names));
    })();
    return () => controller.abort();
  }, [getAuthToken, isGuest, isAuthDisabled]);

  return { options };
}
