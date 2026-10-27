/**
 * The runtime's shared state: what the frame is showing and how it is being
 * touched. Every other runtime module reads or mutates `current`; it is one
 * object on purpose, so a field set here is visible everywhere at once.
 */
import { host, type Ctx } from './template';
import type { Mode, MotionStageInfo, ToRuntime } from '@dc/core';

interface State {
  file: string;
  source: string;
  files: Record<string, string>;
  props: Record<string, unknown>;
  mode: Mode;
  selected: number | null;
  hover: number | null;
  editing: HTMLElement | null;
  pending: Extract<ToRuntime, { dc: 'render' }> | null;
  slide: { head: string; base: string; still?: boolean; size?: [number, number] } | null;
  base: string;
  /** present mode: how far a slide's builds have played */
  step: number;
  /** a motion scene on the editor stage */
  motion: MotionStageInfo | null;
  /** an artboard that moves with time, drawn inside an embed: the time its host last sought (null = its still) */
  time: number | null;
  ctx(): Ctx;
}

export const current: State = {
  file: '',
  source: '',
  files: {},
  props: {},
  mode: 'edit',
  selected: null,
  hover: null,
  editing: null,
  pending: null,
  slide: null,
  base: '',
  step: 0,
  motion: null,
  time: null,
  ctx() {
    return {
      tagged: true,
      files: this.files,
      file: this.file,
      mode: this.mode,
      slide: this.slide ? { base: this.slide.base, source: this.source, still: this.slide.still } : undefined,
      base: this.slide ? undefined : this.base || undefined,
      motion: this.slide && this.motion ? { format: this.motion.format, formats: this.motion.formats } : undefined,
    };
  },
};

host.mode = () => current.mode;
host.ctx = () => current.ctx();

export const mount = document.getElementById('dc-app')!;

export const inEdit = () => current.mode === 'edit';
