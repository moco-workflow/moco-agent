import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Settings } from 'lucide-react';
import { useAgent } from '@/lib/agent-context';
import { secondaryButton } from '@/components/ui/settings-card';
import { SecretUploadForm } from './secret-upload-form';

/**
 * What the caller can do about one model role that is not set up: store the
 * missing key (a user their own, an admin a shared one) and/or open the settings
 * tab where the role's fields are. Guests get neither -- they share one identity.
 */
export function SetupActions({
  secretName,
  secretMissing,
  fields,
  onFixed,
}: {
  /** The key the role names, when that key is not stored. */
  secretName: string | null;
  secretMissing: boolean;
  /** The dotted config paths that would fix the role (models.inference.model, ...). */
  fields: string[];
  onFixed?: () => void;
}) {
  const { role, readOnly, agentConfig, reloadReadiness } = useAgent();
  const [uploading, setUploading] = useState(false);

  if (readOnly !== false) {
    return <p className="mt-2 text-xs text-gray-500">Ask an admin of this agent to set it up.</p>;
  }
  const isAdmin = role === 'admin';
  const canUpload = secretMissing && !!secretName && (isAdmin || !secretName.startsWith('global/'));
  const userSettable = new Set(agentConfig?.user_settable ?? []);
  const settingsTab = isAdmin ? 'agent' : fields.some((f) => userSettable.has(f)) ? 'mine' : null;

  return (
    <div className="mt-2">
      <div className="flex flex-wrap gap-2">
        {canUpload && !uploading && (
          <button type="button" onClick={() => setUploading(true)} className={secondaryButton + ' border border-gray-700'}>
            Set key
          </button>
        )}
        {settingsTab && (
          <Link to={`/settings?tab=${settingsTab}`} className={secondaryButton + ' inline-flex items-center gap-1 border border-gray-700'}>
            <Settings className="h-3.5 w-3.5" /> {isAdmin ? 'Agent model settings' : 'Your model settings'}
          </Link>
        )}
        {secretMissing && !canUpload && !settingsTab && (
          <p className="text-xs text-gray-500">Ask an admin to store the shared key {secretName}.</p>
        )}
      </div>
      {uploading && secretName && (
        <SecretUploadForm
          secretKey={secretName}
          onCancel={() => setUploading(false)}
          onDone={() => {
            setUploading(false);
            void reloadReadiness();
            onFixed?.();
          }}
        />
      )}
    </div>
  );
}
