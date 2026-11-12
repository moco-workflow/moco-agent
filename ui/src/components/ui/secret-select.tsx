import { useId } from 'react';
import { inputClass } from './field';

/**
 * A combobox over the caller's uploaded secret NAMES that also accepts free text.
 *
 * Free text matters: the natural order of operations is to configure the agent
 * and then upload the key, so refusing a name that does not exist yet would
 * block the obvious workflow. The value stored is only ever a name -- the secret
 * itself is resolved server-side at activity execution time.
 */
export function SecretSelect({
  value,
  onChange,
  options,
  disabled,
  placeholder = 'MY_LLM_TOKEN',
}: {
  value: string;
  onChange: (next: string) => void;
  options: string[];
  disabled?: boolean;
  placeholder?: string;
}) {
  const listId = useId();
  return (
    <>
      <input
        type="text"
        list={listId}
        value={value ?? ''}
        disabled={disabled}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
        className={inputClass}
      />
      <datalist id={listId}>
        {options.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
    </>
  );
}
