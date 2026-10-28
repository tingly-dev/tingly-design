import { useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Menu, MenuItem } from './Menu';

/**
 * "Preview as…": which look of the work's own palette the stage draws it in (a dashboard's light or
 * dark page, a design system's theme). It lives in the top bar with the kind's other actions and says
 * what it is in one wording everywhere; the editor's own appearance is a different thing and stays under
 * "more". The choice changes what is shown, never the work.
 */
export function PreviewAs({ icon, options, value, onChange }: { icon: ReactNode; options: { id: string; label: string }[]; value: string; onChange: (id: string) => void }) {
  const { t } = useTranslation();
  const btn = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const name = options.find((o) => o.id === value)?.label ?? value;
  const label = t('common.preview.current', { name });
  return (
    <>
      <button
        ref={btn}
        className="tb"
        aria-haspopup="menu"
        aria-expanded={!!pos}
        aria-label={label}
        title={label}
        data-preview=""
        onClick={() => {
          const r = btn.current!.getBoundingClientRect();
          setPos(pos ? null : { x: r.right, y: r.bottom + 8 });
        }}
      >
        {icon}
      </button>
      {pos && (
        <Menu x={pos.x} y={pos.y} align="right" label={t('common.preview.as')} onClose={() => setPos(null)}>
          <div className="head">{t('common.preview.as')}</div>
          {options.map((o) => (
            <MenuItem
              key={o.id}
              label={o.label}
              checked={o.id === value}
              onSelect={() => {
                onChange(o.id);
                setPos(null);
              }}
            />
          ))}
        </Menu>
      )}
    </>
  );
}
