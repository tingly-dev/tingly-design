import { useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import type { MotionJson } from '@dc/core';
import { download } from '@dc/export';
import type { ExportReport } from '@dc/export/timing';
import { api } from '../../api';
import { toast } from '../../store';
import { fileStem, saveImage } from '../../imageExport';
import { slowestStage } from '../../exportReport';
import { frameFonts } from './motionImage';
import { exactScenes, exportInputs } from './motionExport';
import { MotionExportError, type MotionControl, type MotionInfo } from './MotionFrame';
import type { VideoExportOptions } from './VideoExportDialog';

export type Exporting = { done: number; total: number; route: 'browser' | 'server'; startedAt: number };

/**
 * Saving the piece: a video or GIF (in the browser, or by the server's Chrome
 * when the piece holds an embed or a video layer), or the frame at the playhead.
 */
export function useMotionExport(p: {
  motion: MotionJson;
  fmt: string;
  info: MotionInfo | null;
  playScenes: Record<string, string>;
  base: string;
  project: string | null;
  control: RefObject<MotionControl | null>;
  /** where the playhead is now, in played ms */
  at: RefObject<number>;
  pause: () => void;
  /** the scene a stretch starting at `from` (played ms) begins in */
  sceneName: (from: number) => string;
}) {
  const { t } = useTranslation();
  const { motion, fmt, info, playScenes, base, project, control } = p;
  const [exporting, setExporting] = useState<Exporting | null>(null);
  const exportCtl = useRef<AbortController | null>(null);
  // the export dialog, and whether the server's Chrome will draw this piece (it holds an embed or a video layer)
  const [exportDialog, setExportDialog] = useState<{ viaServer: string[] | null; format?: 'gif' } | null>(null);

  /** Asked before the dialog: a piece with an embed or a video layer is drawn by the server's Chrome when it has one, which the browser cannot do. */
  const openExportDialog = async (format?: 'gif') => {
    if (exportCtl.current || !info) return;
    const exact = exactScenes(playScenes);
    const caps = exact.length && project ? await api.renderCapabilities().catch(() => null) : null;
    setExportDialog({ viaServer: caps?.chrome && caps.ffmpeg ? exact : null, format });
  };

  const where = (route: 'browser' | 'server') => (route === 'server' ? t('motion.export.where.server') : t('motion.export.where.browser'));
  const stepName = (id: string) => {
    const names: Record<string, string> = {
      audio: t('motion.export.steps.audio'),
      launch: t('motion.export.steps.launch'),
      seek: t('motion.export.steps.seek'),
      embeds: t('motion.export.steps.embeds'),
      snapshot: t('motion.export.steps.snapshot'),
      decode: t('motion.export.steps.decode'),
      paint: t('motion.export.steps.paint'),
      capture: t('motion.export.steps.capture'),
      write: t('motion.export.steps.write'),
      encode: t('motion.export.steps.encode'),
      finish: t('motion.export.steps.finish'),
    };
    return names[id] ?? id;
  };
  /** "Saved x.mp4", then which route made it, how long it took and what took longest: the answer to "why is this slow". */
  const doneMessage = (file: string, r: ExportReport) => {
    const top = slowestStage(r);
    return t('motion.export.doneDetail', {
      name: file,
      where: where(r.route),
      seconds: Math.max(1, Math.round(r.wallMs / 1000)),
      fps: r.fps,
      step: top ? stepName(top.id) : '',
      percent: top?.percent ?? 0,
    });
  };

  const exportVideo = async (o: VideoExportOptions, viaServer: string[] | null) => {
    if (exportCtl.current || !info) return;
    const ctl = new AbortController();
    exportCtl.current = ctl;
    const back = p.at.current;
    p.pause();
    const route = project && viaServer ? 'server' : 'browser';
    const startedAt = performance.now();
    const progress = (done: number, total: number) => setExporting({ done, total, route, startedAt });
    progress(0, 1);
    try {
      const [W0, H0] = motion.formats[fmt]?.size ?? [info.width, info.height];
      const name = (ext: string) =>
        `${(motion.title || 'motion').replace(/[\\/:*?"<>|]+/g, '-')}-${fmt}${o.height !== H0 ? `-${o.height}p` : ''}${o.from !== undefined ? `-${p.sceneName(o.from)}` : ''}.${ext}`;
      if (project && viaServer) {
        toast(t('motion.export.viaServer', { scenes: viaServer.join(', ') }));
        const ext = o.format === 'gif' ? 'gif' : 'mp4';
        const { file, report } = await api.renderMotion(project, fmt, { container: ext, width: o.width === W0 ? undefined : o.width, height: o.height === H0 ? undefined : o.height, fps: o.fps === info.fps ? undefined : o.fps, quality: o.quality, from: o.from, to: o.to }, progress, ctl.signal);
        download(name(ext), await (await fetch(api.renderedUrl(project, file), { signal: ctl.signal })).blob());
        toast(doneMessage(name(ext), report));
      } else {
        const inputs = await exportInputs(motion, playScenes, base);
        const r = await control.current!.exportVideo({ format: o.format, width: o.width === W0 ? undefined : o.width, height: o.height === H0 ? undefined : o.height, fps: o.fps === info.fps ? undefined : o.fps, quality: o.quality, from: o.from, to: o.to, ...inputs }, progress, ctl.signal);
        download(name(r.ext), r.blob);
        toast(doneMessage(name(r.ext), r.report));
        if (project) api.logExport(project, r.report, exactScenes(playScenes).length ? 'no-server-renderer' : undefined);
        if (r.note) toast(t(r.note === 'no-aac' ? 'motion.export.noAac' : 'motion.export.noH264'), 'info');
        if (r.embeds.length) toast(t('motion.export.embeds', { scenes: r.embeds.join(', ') }), 'info');
      }
    } catch (e) {
      const code = e instanceof MotionExportError ? e.code : (e as { name?: string }).name === 'AbortError' ? 'aborted' : (e as { code?: string }).code === 'aborted' ? 'aborted' : 'failed';
      toast(code === 'aborted' ? t('motion.export.cancelled') : code === 'no-encoder' ? t('motion.export.noEncoder') : t('motion.export.failed', { message: (e as Error).message }), code === 'aborted' ? 'info' : 'error');
    } finally {
      exportCtl.current = null;
      setExporting(null);
      control.current?.seek(back);
    }
  };

  const saveFrame = async () => {
    const at = p.at.current;
    p.pause();
    await saveImage(`${fileStem(motion.title, 'motion')}-${fmt}-${Math.round(at)}ms.png`, async () => control.current!.snapshot({ t: at, scale: 1, fontCss: await frameFonts(motion, playScenes, base) }));
    control.current?.seek(at);
  };

  return { exporting, cancel: () => exportCtl.current?.abort(), where, exportDialog, setExportDialog, openExportDialog, exportVideo, saveFrame };
}
