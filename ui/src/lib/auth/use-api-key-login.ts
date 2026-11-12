import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from './auth-context';

/**
 * State for the hidden admin sign-in on a login page.
 *
 * The form stays hidden until Ctrl+A (Cmd+A on macOS) toggles it; inside a
 * text field the shortcut keeps its usual select-all meaning. `submit` signs in
 * with `loginWithApiKey` and calls `onSuccess`, or leaves the message in
 * `error`. Only the state lives here, so each app renders the form in its own
 * style.
 */
export function useApiKeyLogin(onSuccess: () => void) {
  const { loginWithApiKey } = useAuth();
  const [shown, setShown] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'a') return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]')) return;
      event.preventDefault();
      setShown((s) => !s);
      setError(null);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!apiKey.trim()) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await loginWithApiKey(apiKey);
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The API key was not accepted');
    } finally {
      setIsSubmitting(false);
    }
  };

  return { shown, apiKey, setApiKey, error, isSubmitting, submit };
}
