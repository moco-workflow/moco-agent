import { OwnershipBadge } from '@/components/ui/field';
import { SettingsCard } from '@/components/ui/settings-card';
import { MODEL_ROLES } from '@/lib/model-roles';
import { ModelRoleEditor } from './model-role-editor';
import type { CatalogProvider, GetConfigResult } from '@/types/admin';

/**
 * The user tier's model roles, one row each. Same editor as the agent tier
 * (ModelRoleEditor); Save writes the role to your settings, "Use the agent's
 * setting" drops it again.
 */
export function UserModels({
  data,
  providers,
  secretOptions,
  locked,
}: {
  data: GetConfigResult;
  providers: CatalogProvider[];
  secretOptions: string[];
  locked: boolean;
}) {
  const settable = new Set(data.user_settable);
  const roles = MODEL_ROLES.filter((r) => settable.has(`models.${r.role}.${r.key}`));
  if (roles.length === 0) return null;
  const anyOwn = roles.some((r) => r.role in (data.tiers.user.models ?? {}));

  return (
    <SettingsCard
      title="Models"
      description="Which model does each job for you. A role you have not changed follows the agent."
      badge={<OwnershipBadge isOwn={anyOwn} />}
      flush
    >
      <div className="divide-y divide-gray-800">
        {roles.map((meta) => (
          <ModelRoleEditor
            key={meta.role}
            tier="user"
            meta={meta}
            data={data}
            providers={providers}
            secretOptions={secretOptions}
            locked={locked}
          />
        ))}
      </div>
    </SettingsCard>
  );
}
