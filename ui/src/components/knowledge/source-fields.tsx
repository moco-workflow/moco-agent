import { Field, inputClass } from '@/components/ui/field';
import { SecretSelect } from '@/components/ui/secret-select';
import { specFor, type FieldSpec } from '@/lib/source-kinds';
import type { IndexSource } from '@/types/admin';

/**
 * Renders one source's fields from its kind's spec, so adding a source kind is a
 * table entry in source-kinds.ts rather than another branch here.
 */
export function SourceFields({
  source,
  onChange,
  secretOptions,
  disabled,
}: {
  source: IndexSource;
  onChange: (next: IndexSource) => void;
  secretOptions: string[];
  disabled?: boolean;
}) {
  const spec = specFor(source.kind);
  const record = source as unknown as Record<string, unknown>;

  const set = (name: string, value: unknown) =>
    onChange({ ...record, [name]: value } as unknown as IndexSource);

  return (
    <div className="space-y-3">
      {spec.fields.map((f) => (
        <SourceField
          key={f.name}
          spec={f}
          value={record[f.name]}
          onChange={(v) => set(f.name, v)}
          secretOptions={secretOptions}
          disabled={disabled}
        />
      ))}
    </div>
  );
}

function SourceField({
  spec,
  value,
  onChange,
  secretOptions,
  disabled,
}: {
  spec: FieldSpec;
  value: unknown;
  onChange: (v: unknown) => void;
  secretOptions: string[];
  disabled?: boolean;
}) {
  switch (spec.type) {
    case 'stringList':
      return (
        <Field label={spec.label} hint={spec.hint} required={spec.required}>
          <StringList
            values={Array.isArray(value) ? (value as string[]) : []}
            onChange={onChange}
            placeholder={spec.placeholder}
            disabled={disabled}
          />
        </Field>
      );

    case 'boolean':
      return (
        <Field label={spec.label} hint={spec.hint}>
          <label className="flex items-center gap-2 text-sm text-gray-300">
            <input
              type="checkbox"
              checked={Boolean(value)}
              disabled={disabled}
              onChange={(e) => onChange(e.target.checked)}
              className="h-4 w-4 rounded border-gray-700 bg-gray-900"
            />
            {spec.label}
          </label>
        </Field>
      );

    case 'number':
      return (
        <Field label={spec.label} hint={spec.hint} required={spec.required}>
          <input
            type="number"
            min={1}
            value={value === null || value === undefined ? '' : String(value)}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
            className={inputClass}
          />
        </Field>
      );

    case 'secret':
      return (
        <Field label={spec.label} hint={spec.hint} required={spec.required}>
          <SecretSelect
            value={typeof value === 'string' ? value : ''}
            onChange={onChange}
            options={secretOptions}
            disabled={disabled}
            placeholder="SECRET_NAME"
          />
        </Field>
      );

    case 'select':
      return (
        <Field label={spec.label} hint={spec.hint} required={spec.required}>
          <select
            value={typeof value === 'string' ? value : ''}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value || null)}
            className={inputClass}
          >
            {spec.options?.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
      );

    default:
      return (
        <Field label={spec.label} hint={spec.hint} required={spec.required}>
          <input
            type="text"
            value={typeof value === 'string' ? value : ''}
            disabled={disabled}
            placeholder={spec.placeholder}
            onChange={(e) => onChange(e.target.value)}
            className={inputClass}
          />
        </Field>
      );
  }
}

/** One input per entry, so a URL containing a comma is not silently split. */
function StringList({
  values,
  onChange,
  placeholder,
  disabled,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const rows = values.length > 0 ? values : [''];
  return (
    <div className="space-y-1.5">
      {rows.map((v, i) => (
        <div key={i} className="flex gap-1.5">
          <input
            type="text"
            value={v}
            disabled={disabled}
            placeholder={placeholder}
            onChange={(e) => {
              const next = [...rows];
              next[i] = e.target.value;
              onChange(next);
            }}
            className={inputClass}
          />
          <button
            type="button"
            disabled={disabled || rows.length === 1}
            onClick={() => onChange(rows.filter((_, j) => j !== i))}
            className="shrink-0 rounded-md px-2 text-xs text-gray-500 hover:bg-gray-800 hover:text-white disabled:opacity-30"
            aria-label="Remove"
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange([...rows, ''])}
        className="text-xs text-blue-400 hover:text-blue-300 disabled:opacity-50"
      >
        + Add
      </button>
    </div>
  );
}
