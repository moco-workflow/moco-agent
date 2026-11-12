import { OwnershipBadge } from '@/components/ui/field';
import { SettingsCard } from '@/components/ui/settings-card';
import { MODEL_ROLES } from '@/lib/model-roles';
import { ModelRoleEditor } from './model-role-editor';
import type { CatalogProvider, GetConfigResult } from '@/types/admin';

/**
 * The agent tier's model roles, for the agent's admins. Same editor as the user
 * tier (ModelRoleEditor); here it may also set decision to null and the
 * classifier's enabled / timeout.
 */
export function AgentModels({
  data,
  providers,
  secretOptions,
}: {
  data: GetConfigResult;
  providers: CatalogProvider[];
  secretOptions: string[];
}) {
  const anyOwn = MODEL_ROLES.some((r) => r.role in (data.tiers.agent.models ?? {}));
  return (
    <SettingsCard
      title="Models"
      description="The models every user gets unless they choose their own."
      badge={<OwnershipBadge isOwn={anyOwn} tier="agent" />}
      flush
    >
      <div className="divide-y divide-gray-800">
        {MODEL_ROLES.map((meta) => (
          <ModelRoleEditor
            key={meta.role}
            tier="agent"
            meta={meta}
            data={data}
            providers={providers}
            secretOptions={secretOptions}
            locked={false}
          />
        ))}
      </div>
    </SettingsCard>
  );
}
