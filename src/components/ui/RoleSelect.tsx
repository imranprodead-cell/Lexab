import { useState } from 'react';
import { SelectMenu } from '@/components/ui/SelectMenu';
import { TextField } from '@/components/ui/TextField';
import { useI18n } from '@/i18n/I18nProvider';

/** Preset job titles offered everywhere a person is added to a process. */
export type RolePresetKey = 'editor' | 'lawyer' | 'admin' | 'owner' | 'viewer';
const ROLE_PRESETS: RolePresetKey[] = ['editor', 'lawyer', 'admin', 'owner', 'viewer'];

const CUSTOM = '__custom';

interface RoleSelectProps {
  /** The chosen title as plain text ('' = nothing picked yet). */
  value: string;
  /** presetKey is null when the user typed their own title. */
  onChange: (value: string, presetKey: RolePresetKey | null) => void;
  ariaLabel: string;
}

/**
 * Job-title dropdown: Редактор / Юрист / Админ / Владелец / Наблюдатель +
 * «Другая должность…» which reveals a free-text field.
 */
export function RoleSelect({ value, onChange, ariaLabel }: RoleSelectProps) {
  const { t } = useI18n();
  const labelOf = (key: RolePresetKey) => t(`roles.${key}`);
  const presetOf = (v: string): RolePresetKey | undefined =>
    ROLE_PRESETS.find((k) => labelOf(k) === v);

  // Custom mode survives while the typed text accidentally matches nothing.
  const [custom, setCustom] = useState(() => value !== '' && !presetOf(value));

  const selectValue = custom ? CUSTOM : (presetOf(value) ?? '');
  const options = [
    { value: '', label: t('roles.placeholder') },
    ...ROLE_PRESETS.map((k) => ({ value: k, label: labelOf(k) })),
    { value: CUSTOM, label: t('roles.custom') },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <SelectMenu
        ariaLabel={ariaLabel}
        value={selectValue}
        options={options}
        onChange={(v) => {
          if (v === CUSTOM) {
            setCustom(true);
            onChange('', null);
          } else if (v === '') {
            setCustom(false);
            onChange('', null);
          } else {
            setCustom(false);
            onChange(labelOf(v as RolePresetKey), v as RolePresetKey);
          }
        }}
      />
      {custom ? (
        <TextField
          placeholder={t('roles.customPh')}
          value={value}
          autoFocus
          onChange={(e) => onChange(e.target.value, null)}
        />
      ) : null}
    </div>
  );
}
