import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { importErrorText } from '@dc/import';
import { IconFile, IconFileImport, IconFolder } from '@tabler/icons-react';
import { toast } from '../store';
import { NAME_RE, freeName, slugOf } from '../projectName';
import { droppedFiles, importPicked, pickedFromText, readPicked, type ImportStep, type Picked } from '../importer';

/** in order; each one's words are importer.dialog.step.<step> */
const STEPS: ImportStep[] = ['layout', 'assets', 'write'];

/**
 * Turn an HTML page (one file, or its folder with the css and images beside
 * it) or an SVG drawing into a new canvas. Opened from the launcher's 新建
 * strip, or by dropping files or pasting SVG anywhere on the launcher, in
 * which case `initial` already holds them.
 */
export function ImportDialog({
  initial,
  taken,
  onClose,
  onDone,
}: {
  initial?: Picked;
  taken: Set<string>;
  onClose: () => void;
  onDone: (name: string) => void;
}) {
  const { t } = useTranslation();
  const [picked, setPicked] = useState<Picked | null>(initial ?? null);
  const [entry, setEntry] = useState(initial?.entry ?? '');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [folder, setFolder] = useState('');
  const [touched, setTouched] = useState(false);
  const [step, setStep] = useState<ImportStep | null>(null);
  const [over, setOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const dirRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && !step && onClose();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose, step]);
  // folder inputs need a non-standard attribute React does not know
  useEffect(() => dirRef.current?.setAttribute('webkitdirectory', ''), []);
  // SVG copied from a design tool (Figma: Copy as SVG) pastes straight in
  useEffect(() => {
    const paste = (e: ClipboardEvent) => {
      if (step || (e.target instanceof HTMLInputElement && e.target.type !== 'file')) return;
      const p = pickedFromText(e.clipboardData?.getData('text/plain') ?? '');
      if (!p) return;
      e.preventDefault();
      setPicked(p);
      setEntry(p.entry);
      setTitle(p.title);
    };
    window.addEventListener('paste', paste);
    return () => window.removeEventListener('paste', paste);
  }, [step]);

  const take = async (list: { file: File; path: string }[]) => {
    if (!list.length) return;
    const p = await readPicked(list);
    if (!p.entry) {
      toast(t('importer.dialog.noEntry'), 'error');
      return;
    }
    setPicked(p);
    setEntry(p.entry);
    setTitle(p.title);
  };
  const fromInput = (input: HTMLInputElement) => {
    const list = [...(input.files ?? [])].map((file) => ({ file, path: file.webkitRelativePath || file.name }));
    input.value = '';
    void take(list);
  };

  const base = slugOf(title) || slugOf(entry.replace(/(^|\/)index\.html?$/i, '').replace(/\.(html?|svg)$/i, '').split('/').pop() ?? '') || 'imported';
  const name = touched ? folder : freeName(base, taken);
  const problem = !picked
    ? ''
    : !name
      ? t('importer.dialog.folderMissing')
      : !NAME_RE.test(name)
        ? t('importer.dialog.folderInvalid')
        : taken.has(name)
          ? t('importer.dialog.folderTaken', { name })
          : '';
  const submit = async () => {
    if (!picked || problem || step) return;
    setStep('layout');
    try {
      await importPicked({ ...picked, entry }, name, title.trim(), setStep);
      onDone(name);
    } catch (err) {
      setStep(null);
      toast(importErrorText(err, t), 'error');
    }
  };
  const at = step ? STEPS.indexOf(step) : -1;

  return (
    <div className="lmodal" onMouseDown={(e) => e.target === e.currentTarget && !step && onClose()}>
      <form
        className="ldialog limport"
        role="dialog"
        aria-label={t('importer.dialog.title')}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <header>
          <h2>{t('importer.dialog.title')}</h2>
          <button type="button" className="tb" aria-label={t('common.close')} onClick={onClose} disabled={!!step}>
            ×
          </button>
        </header>
        {!picked ? (
          <div
            className={`ldrop${over ? ' over' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              void droppedFiles(e.dataTransfer).then(take);
            }}
          >
            <IconFileImport size={28} stroke={1.5} aria-hidden="true" />
            <div className="what">{t('importer.dialog.dropWhat')}</div>
            <div className="why">{t('importer.dialog.dropWhy')}</div>
            <div className="pick">
              <button type="button" className="btn" onClick={() => dirRef.current?.click()}>
                <IconFolder size={15} stroke={1.7} aria-hidden="true" /> {t('importer.dialog.chooseFolder')}
              </button>
              <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
                <IconFile size={15} stroke={1.7} aria-hidden="true" /> {t('importer.dialog.chooseFiles')}
              </button>
            </div>
            <input ref={fileRef} type="file" multiple accept=".html,.htm,.svg,.css,image/*,font/*,.woff,.woff2,.ttf,.otf" hidden onChange={(e) => fromInput(e.currentTarget)} />
            <input ref={dirRef} type="file" hidden onChange={(e) => fromInput(e.currentTarget)} />
          </div>
        ) : (
          <>
            <label className="field">
              <span>{t('importer.dialog.page')}</span>
              <span className="source">
                {picked.pages.length > 1 ? (
                  <select className="input" aria-label={t('importer.dialog.pageLabel')} value={entry} disabled={!!step} onChange={(e) => setEntry(e.target.value)}>
                    {picked.pages.map((p) => (
                      <option key={p}>{p}</option>
                    ))}
                  </select>
                ) : (
                  <code>{entry === 'pasted.svg' ? t('importer.dialog.pastedSvg') : entry}</code>
                )}
                {entry !== 'pasted.svg' && <span className="n">{t('importer.here.files', { count: picked.files.length })}</span>}
                {!step && (
                  <button type="button" className="linkish" onClick={() => setPicked(null)}>
                    {t('importer.dialog.change')}
                  </button>
                )}
              </span>
            </label>
            <label className="field">
              <span>{t('importer.dialog.titleField')}</span>
              <input className="input" aria-label={t('importer.dialog.titleField')} value={title} disabled={!!step} onChange={(e) => setTitle(e.target.value)} placeholder={t('importer.dialog.titlePlaceholder')} />
            </label>
            <label className="field">
              <span>{t('importer.dialog.folder')}</span>
              <span className="folder">
                <span className="pre">projects/</span>
                <input
                  className="input"
                  aria-label={t('importer.dialog.folderLabel')}
                  value={name}
                  disabled={!!step}
                  onChange={(e) => {
                    setTouched(true);
                    setFolder(e.target.value.trim());
                  }}
                />
              </span>
            </label>
            {step ? (
              <ol className="lsteps" aria-live="polite">
                {STEPS.map((s, i) => (
                  <li key={s} className={i < at ? 'done' : i === at ? 'on' : ''}>
                    {t(`importer.dialog.step.${s}`)}
                  </li>
                ))}
              </ol>
            ) : (
              <div className={`problem${problem ? ' on' : ''}`} role="alert">
                {problem}
              </div>
            )}
          </>
        )}
        <footer>
          <button type="button" className="btn" onClick={onClose} disabled={!!step}>
            {t('common.cancel')}
          </button>
          <button className="btn primary" type="submit" disabled={!picked || !!problem || !!step}>
            {step ? t('importer.dialog.importing') : t('importer.dialog.submit')}
          </button>
        </footer>
      </form>
    </div>
  );
}
