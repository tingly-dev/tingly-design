import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DesignSystemChoice } from '../api';
import { LookPicker } from './launcher/LookPicker';

/** Project systems stay in the field; built-ins are disclosed by group only when asked for. */
export function DesignSystemPicker({ value, onChange, systems, label, placeholder, disabled = false }: {
  value: DesignSystemChoice;
  onChange: (value: DesignSystemChoice) => void;
  systems: { name: string; title: string }[];
  label: string;
  placeholder: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const details = useRef<HTMLDetailsElement>(null);
  const [expanded, setExpanded] = useState(false);
  const look = typeof value === 'string' ? '' : value.look;
  return (
    <div className="dspick">
      <select className="input" value={typeof value === 'string' ? value : `builtin:${look}`} onChange={(e) => onChange(e.target.value.startsWith('builtin:') ? { look: e.target.value.slice(8) } : e.target.value)} aria-label={label} disabled={disabled}>
        <option value="">{placeholder}</option>
        {look && <option value={`builtin:${look}`}>{t('ds.builtInPicked', { look: t(`ds.look.${look}`, { defaultValue: look }) })}</option>}
        {systems.map((s) => <option key={s.name} value={s.name}>{s.title}</option>)}
      </select>
      {!disabled && <details ref={details} className="dsbuiltins" onToggle={(e) => setExpanded(e.currentTarget.open)}>
        <summary>{t('ds.builtIn')}</summary>
        {expanded && <LookPicker key={look} value={look} allowBlank={false} onChange={(id) => {
          onChange({ look: id });
          if (details.current) {
            details.current.open = false;
            details.current.querySelector('summary')?.focus();
          }
        }} />}
      </details>}
    </div>
  );
}
