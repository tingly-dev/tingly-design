import { create } from 'zustand';
import { useTranslation } from 'react-i18next';
import { Dialog } from './Dialog';

interface Ask {
  /** the question, as the dialog's title */
  label: string;
  /** what the button says; the delete wording by default */
  action?: string;
  resolve: (ok: boolean) => void;
}

const useAsk = create<{ ask: Ask | null }>(() => ({ ask: null }));

/**
 * Ask before something that cannot be brought back (a design system's binary assets: the editor
 * keeps no copy to restore them from). Anything Undo can restore is just done, with an Undo toast
 * (`undoRemove.ts`), so this is rare. Resolves true when confirmed; the window's `confirm()` is
 * not used, so the question has the editor's look, its keyboard and the language.
 */
export function askConfirm(label: string, action?: string): Promise<boolean> {
  useAsk.getState().ask?.resolve(false);
  return new Promise((resolve) => useAsk.setState({ ask: { label, action, resolve } }));
}

/** The one place a question from `askConfirm` is drawn; mounted once, next to the toasts. */
export function ConfirmHost() {
  const { t } = useTranslation();
  const ask = useAsk((s) => s.ask);
  if (!ask) return null;
  const done = (ok: boolean) => {
    useAsk.setState({ ask: null });
    ask.resolve(ok);
  };
  return (
    <Dialog label={ask.label} className="confirmdlg" onClose={() => done(false)} onSubmit={() => done(true)}>
      <p>{t('common.item.cannotUndo')}</p>
      <footer>
        <button type="button" className="btn outline" onClick={() => done(false)}>
          {t('common.cancel')}
        </button>
        <button type="submit" className="btn danger">
          {ask.action ?? t('common.delete')}
        </button>
      </footer>
    </Dialog>
  );
}
