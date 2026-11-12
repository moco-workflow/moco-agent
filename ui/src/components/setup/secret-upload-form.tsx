import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { useAuth } from '@/lib/auth/auth-context';
import { parseSecretKey, uploadSecret } from '@/lib/secret-api';
import { inputClass } from '@/components/ui/field';
import { primaryButton, secondaryButton } from '@/components/ui/settings-card';

/**
 * Store the VALUE of a key the agent already names (F70): the setup guide's
 * "Set key". The value is encrypted in the browser before it leaves; the field is
 * cleared on success and never echoed back.
 */
export function SecretUploadForm({
  secretKey,
  onDone,
  onCancel,
}: {
  /** As written in the config: `NAME` (the caller's own) or `global/NAME` (shared). */
  secretKey: string;
  onDone: () => void;
  onCancel?: () => void;
}) {
  const { getAuthToken } = useAuth();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { name, scope } = parseSecretKey(secretKey);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await uploadSecret(name, value.trim(), scope, await getAuthToken());
      setValue('');
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not store the key');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 space-y-2">
      <label className="block text-xs text-gray-400">
        <span className="mb-1 flex items-center gap-1.5">
          <KeyRound className="h-3.5 w-3.5" />
          Value for <span className="font-mono text-gray-200">{secretKey}</span>
          {scope === 'global' ? ' (shared by every user)' : ' (yours only)'}
        </span>
        <input
          type="password"
          value={value}
          autoComplete="off"
          spellCheck={false}
          placeholder="Paste the API key"
          aria-label={`Value for ${secretKey}`}
          onChange={(e) => setValue(e.target.value)}
          className={inputClass}
        />
      </label>
      {error && <p className="text-xs text-red-300">{error}</p>}
      <div className="flex gap-2">
        <button type="button" disabled={busy || !value.trim()} onClick={() => void save()} className={primaryButton}>
          {busy ? 'Storing…' : 'Store key'}
        </button>
        {onCancel && (
          <button type="button" disabled={busy} onClick={onCancel} className={secondaryButton}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
