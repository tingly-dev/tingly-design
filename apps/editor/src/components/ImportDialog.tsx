import { useEffect, useRef, useState } from 'react';
import { IconFile, IconFileImport, IconFolder } from '@tabler/icons-react';
import { toast } from '../store';
import { NAME_RE, freeName, slugOf } from '../projectName';
import { droppedFiles, importPicked, pickedFromText, readPicked, type ImportStep, type Picked } from '../importer';

const STEPS: { step: ImportStep; zh: string }[] = [
  { step: 'layout', zh: '读出每个元素和它的样式' },
  { step: 'assets', zh: '保存原文件，把图片和字体放进项目' },
  { step: 'write', zh: '写入画板' },
];

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
      toast('这些文件里没有 .html 页面或 .svg 图形。', 'error');
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
      ? '请填写文件夹名。'
      : !NAME_RE.test(name)
        ? '文件夹名只能用字母、数字、- 和 _，并以字母或数字开头。'
        : taken.has(name)
          ? `projects/${name} 已经存在。`
          : '';
  const submit = async () => {
    if (!picked || problem || step) return;
    setStep('layout');
    try {
      await importPicked({ ...picked, entry }, name, title.trim(), setStep);
      onDone(name);
    } catch (err) {
      setStep(null);
      toast((err as Error).message, 'error');
    }
  };
  const at = step ? STEPS.findIndex((s) => s.step === step) : -1;

  return (
    <div className="lmodal" onMouseDown={(e) => e.target === e.currentTarget && !step && onClose()}>
      <form
        className="ldialog limport"
        role="dialog"
        aria-label="导入 HTML 或 SVG"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <header>
          <h2>导入 HTML 或 SVG</h2>
          <button type="button" className="tb" aria-label="关闭" onClick={onClose} disabled={!!step}>
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
            <div className="what">把 HTML 或 SVG 文件，或它所在的文件夹拖到这里</div>
            <div className="why">网页连同旁边的 CSS、图片和字体一起选，样式和图片才完整。从 Figma 复制的 SVG 可以直接粘贴（⌘V）。</div>
            <div className="pick">
              <button type="button" className="btn" onClick={() => dirRef.current?.click()}>
                <IconFolder size={15} stroke={1.7} aria-hidden="true" /> 选择文件夹
              </button>
              <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
                <IconFile size={15} stroke={1.7} aria-hidden="true" /> 选择文件
              </button>
            </div>
            <input ref={fileRef} type="file" multiple accept=".html,.htm,.svg,.css,image/*,font/*,.woff,.woff2,.ttf,.otf" hidden onChange={(e) => fromInput(e.currentTarget)} />
            <input ref={dirRef} type="file" hidden onChange={(e) => fromInput(e.currentTarget)} />
          </div>
        ) : (
          <>
            <label className="field">
              <span>页面</span>
              <span className="source">
                {picked.pages.length > 1 ? (
                  <select className="input" aria-label="要导入的页面" value={entry} disabled={!!step} onChange={(e) => setEntry(e.target.value)}>
                    {picked.pages.map((p) => (
                      <option key={p}>{p}</option>
                    ))}
                  </select>
                ) : (
                  <code>{entry === 'pasted.svg' ? '粘贴的 SVG' : entry}</code>
                )}
                {entry !== 'pasted.svg' && <span className="n">{picked.files.length} 个文件</span>}
                {!step && (
                  <button type="button" className="linkish" onClick={() => setPicked(null)}>
                    换一个
                  </button>
                )}
              </span>
            </label>
            <label className="field">
              <span>标题</span>
              <input className="input" aria-label="标题" value={title} disabled={!!step} onChange={(e) => setTitle(e.target.value)} placeholder="导入的页面" />
            </label>
            <label className="field">
              <span>文件夹</span>
              <span className="folder">
                <span className="pre">projects/</span>
                <input
                  className="input"
                  aria-label="新项目名称"
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
                  <li key={s.step} className={i < at ? 'done' : i === at ? 'on' : ''}>
                    {s.zh}
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
            取消
          </button>
          <button className="btn primary" type="submit" disabled={!picked || !!problem || !!step}>
            {step ? '导入中…' : '导入为画布'}
          </button>
        </footer>
      </form>
    </div>
  );
}
