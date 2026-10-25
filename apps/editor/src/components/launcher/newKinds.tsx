import type { ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import { DEFAULT_BOARD_SIZE, type ProjectKind } from '@dc/core';
import type { DesignSystemChoice } from '../../api';
import { checkDataFile, type NewOptions } from '../../newProject';
import { SizePicker } from '../motion/SizePicker';
import { rememberSize, sameSize, type Size } from '../motion/motionSizes';
import { DesignSystemPicker } from '../DesignSystemPicker';
import { BoardSizePicker } from './BoardSizePicker';
import { LookPicker } from './LookPicker';

/** What the New dialog holds for every kind at once, so a person who switches kind and back finds their choices where they left them. */
export interface NewState {
  size: Size | null;
  setSize: (v: Size | null) => void;
  board: Size | null;
  setBoard: (v: Size | null) => void;
  slideSize: Size | null;
  setSlideSize: (v: Size | null) => void;
  look: string;
  setLook: (v: string) => void;
  designSystem: DesignSystemChoice;
  setDesignSystem: (v: DesignSystemChoice) => void;
  systems: { name: string; title: string }[];
  dataFile: { file: File; rows: number } | null;
  setDataFile: (v: { file: File; rows: number } | null) => void;
  dataError: string;
  setDataError: (v: string) => void;
}

interface KindNew {
  /** The pickers right under the title. */
  Fields?: ComponentType<{ s: NewState }>;
  /** The rows of the options box (the repository row follows them). */
  Options?: ComponentType<{ s: NewState }>;
  /** Not ready to create: a size the picker has not settled on. */
  bad(s: NewState): boolean;
  /** The size the project starts with; none keeps the kind's default. */
  size(s: NewState): Size | undefined;
  /** The starting look of a design system. */
  look(s: NewState): string | undefined;
  /** What is applied to the project once it exists. */
  after(s: NewState): NewOptions;
  /** What the dialog remembers for next time. */
  remember?(s: NewState): void;
}

const DsRow = ({ s }: { s: NewState }) => {
  const { t } = useTranslation();
  return (
    <div className="nopt">
      <span>{t('launcher.new.ds')}</span>
      <DesignSystemPicker value={s.designSystem} onChange={s.setDesignSystem} systems={s.systems} label={t('launcher.new.ds')} placeholder={t('launcher.new.dsNone')} />
    </div>
  );
};

const DataRow = ({ s }: { s: NewState }) => {
  const { t } = useTranslation();
  const { dataFile, dataError } = s;
  return (
    <div className="nopt">
      <span>{t('launcher.new.dataFile')}</span>
      <span className="nopt-file">
        <label className="btn ghost">
          {dataFile ? dataFile.file.name : t('launcher.new.dataPick')}
          <input
            type="file"
            hidden
            accept=".csv,.tsv,.json"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              const r = await checkDataFile(f);
              if ('error' in r) return s.setDataError(r.error), s.setDataFile(null);
              s.setDataError('');
              s.setDataFile({ file: f, rows: r.rows });
            }}
          />
        </label>
        {dataFile && (
          <>
            <span className="hint">{t('launcher.new.dataRows', { count: dataFile.rows })}</span>
            <button type="button" className="linkish" onClick={() => s.setDataFile(null)}>
              {t('launcher.new.dataClear')}
            </button>
          </>
        )}
      </span>
      {dataError && <span className="nopt-err">{dataError}</span>}
    </div>
  );
};

const none = () => undefined;
const plain: Pick<KindNew, 'bad' | 'size' | 'look' | 'after'> = { bad: () => false, size: none, look: none, after: () => ({}) };

/** What each kind asks for in the New dialog: one entry per kind, so a kind added later fails to compile until it says. */
export const KIND_NEW: Record<ProjectKind, KindNew> = {
  design: {
    ...plain,
    Fields: ({ s }) => <BoardSizePicker value={s.board} onChange={s.setBoard} />,
    Options: DsRow,
    bad: (s) => !s.board,
    size: (s) => (s.board && !sameSize(s.board, DEFAULT_BOARD_SIZE) ? s.board : undefined),
    after: (s) => ({ designSystem: s.designSystem || undefined }),
    remember: (s) => {
      if (s.board) rememberSize(s.board);
    },
  },
  slides: {
    ...plain,
    Fields: ({ s }) => <BoardSizePicker kind="slides" value={s.slideSize} onChange={s.setSlideSize} />,
    Options: DsRow,
    bad: (s) => !s.slideSize,
    size: (s) => s.slideSize ?? undefined,
    after: (s) => ({ designSystem: s.designSystem || undefined }),
    remember: (s) => {
      if (s.slideSize) rememberSize(s.slideSize);
    },
  },
  motion: {
    ...plain,
    Fields: ({ s }) => <SizePicker value={s.size} onChange={s.setSize} />,
    bad: (s) => !s.size,
    size: (s) => s.size ?? undefined,
    remember: (s) => {
      if (s.size) rememberSize(s.size, true);
    },
  },
  'design-system': { ...plain, Fields: ({ s }) => <LookPicker value={s.look} onChange={s.setLook} />, look: (s) => s.look || undefined },
  dashboard: { ...plain, Options: DataRow, after: (s) => ({ dataFile: s.dataFile?.file }) },
  docs: plain,
};
