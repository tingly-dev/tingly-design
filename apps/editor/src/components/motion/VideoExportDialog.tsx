import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '../Dialog';
import { readPref, writePref } from '../../local';

export type VideoFormat = 'auto' | 'mp4' | 'webm' | 'gif';
export type VideoQuality = 'low' | 'medium' | 'high';

export interface VideoExportOptions {
  format: VideoFormat;
  /** the file's frame size, same aspect ratio as the piece */
  width: number;
  height: number;
  fps: number;
  quality: VideoQuality;
  /** a stretch of the piece in milliseconds on its timeline; absent: the whole piece */
  from?: number;
  to?: number;
  /** put the cover in the first frame too (only offered when the piece has a cover) */
  coverFirst?: boolean;
}

/** The scene under the playhead, as a range to offer: where it starts and ends on the played timeline. */
export interface ScenePick {
  name: string;
  from: number;
  to: number;
}

const PREF = 'dc.videoOptions';
type Remembered = Partial<Pick<VideoExportOptions, 'format' | 'height' | 'fps' | 'quality'>>;
/** The options of the last video made (not a GIF: that is asked for by name), or nothing. */
function remembered(): Remembered {
  try {
    const r = JSON.parse(readPref(PREF) || '{}') as Remembered;
    return r && typeof r === 'object' ? r : {};
  } catch {
    return {};
  }
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const evenDown = (n: number) => Math.max(2, Math.floor(n / 2) * 2);

/** Heights people know by name, offered when smaller than the piece. */
const HEIGHTS = [2160, 1440, 1080, 720, 480, 360];

/**
 * Export video: one summary line and one button for the common case (the file this piece should be, at
 * its own size and speed), and everything else behind "More options": format, size, frame rate,
 * quality, and a single scene instead of the whole piece. When the piece holds an embed or a video
 * layer the server's Chrome draws it: the same options, minus WebM (ffmpeg writes MP4 or GIF there) and
 * minus "automatic" (nothing to fall back from). The menu's "GIF…" opens the same dialog with GIF
 * chosen. See .design/export-menu.md.
 */
export function VideoExportDialog({
  size,
  fps,
  duration,
  scene,
  hasCover,
  coverFirst: coverFirstStart,
  viaServer,
  initialFormat,
  onStart,
  onClose,
}: {
  size: [number, number];
  fps: number;
  /** milliseconds of video, after speed */
  duration: number;
  scene: ScenePick | null;
  /** the piece has a cover (it is always embedded in the file; the box adds it as the first frame) */
  hasCover: boolean;
  /** the box's starting state: motion.json's `coverFirstFrame` */
  coverFirst: boolean;
  /** scenes with an embed or video layer when the server's Chrome will draw them, else null */
  viaServer: string[] | null;
  /** GIF when the dialog was opened from the menu's "GIF…" */
  initialFormat?: 'gif';
  onStart: (o: VideoExportOptions) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [W, H] = size;
  const gifFirst = initialFormat === 'gif';
  const heights = useMemo(() => [...new Set([H, ...HEIGHTS.filter((h) => h < H)])].sort((a, b) => b - a), [H]);
  const [more, setMore] = useState(gifFirst);
  // the last video's options come back as the starting point, as far as this piece and route still offer them
  const last = useMemo(() => (gifFirst ? {} : remembered()), [gifFirst]);
  const formats: VideoFormat[] = viaServer ? ['mp4'] : ['auto', 'mp4', 'webm'];
  const [format, setFormat] = useState<VideoFormat>(gifFirst ? 'gif' : last.format && formats.includes(last.format) ? last.format : viaServer ? 'mp4' : 'auto');
  const [height, setHeight] = useState(() => (gifFirst && H > 480 ? heights.find((x) => x <= 480) ?? H : last.height && heights.includes(last.height) ? last.height : H));
  const [rate, setRate] = useState(gifFirst ? Math.min(fps, 15) : last.fps && [24, 30, 60, fps].includes(last.fps) ? last.fps : fps);
  const [quality, setQuality] = useState<VideoQuality>(last.quality && ['low', 'medium', 'high'].includes(last.quality) ? last.quality : 'high');
  const [range, setRange] = useState<'whole' | 'scene'>('whole');
  const [coverFirst, setCoverFirst] = useState(coverFirstStart);


  const rates = useMemo(() => [...new Set(format === 'gif' ? [10, 15, 24, fps].filter((r) => r <= Math.max(24, fps)) : [24, 30, 60, fps])].sort((a, b) => a - b), [format, fps]);

  const pickFormat = (f: VideoFormat) => {
    setFormat(f);
    // a GIF is 256 colours a frame and no sound: small and short by default, whatever the piece's own size
    if (f === 'gif') {
      setHeight((h) => (h > 480 ? heights.find((x) => x <= 480) ?? h : h));
      setRate((r) => Math.min(r, 15));
    }
  };

  const width = evenDown((W * height) / H);
  const outH = evenDown(height);
  const span = range === 'scene' && scene ? { from: scene.from, to: scene.to } : null;
  const length = span ? span.to - span.from : duration;
  const frames = Math.max(1, Math.round((length / 1000) * rate));
  const formatName = { auto: 'MP4', mp4: 'MP4', webm: 'WebM', gif: 'GIF' }[format];
  const summary = t('motion.export.summary', { format: formatName, size: `${width}×${outH}`, fps: rate, range: span ? t('motion.export.rangeSceneShort', { name: scene!.name }) : t('motion.export.rangeWholeShort'), length: seconds(length) });

  const firstFrame = hasCover && format !== 'gif' && !span;
  const start = () => {
    if (format !== 'gif') writePref(PREF, JSON.stringify({ format, height, fps: rate, quality }));
    go();
  };
  const go = () => onStart({ format, width, height: outH, fps: rate, quality, ...(span ?? {}), ...(firstFrame && coverFirst ? { coverFirst: true } : {}) });

  return (
    <Dialog label={t('motion.export.title')} className="vexport" onClose={onClose} onSubmit={() => start()}>
      <p className="vsummary" data-summary>
        {summary}
      </p>
      {viaServer && <p className="note">{t('motion.export.viaServerNote', { scenes: viaServer.join(', ') })}</p>}
      <>
          <button type="button" className="vmore" aria-expanded={more} onClick={() => setMore(!more)}>
            {more ? t('motion.export.fewerOptions') : t('motion.export.moreOptions')}
          </button>
          {more && (
            <div className="vopts">
              <label>
                <span>{t('motion.export.format')}</span>
                <select value={format} onChange={(e) => pickFormat(e.target.value as VideoFormat)} aria-label={t('motion.export.format')}>
                  {!viaServer && <option value="auto">{t('motion.export.formatAuto')}</option>}
                  <option value="mp4">MP4</option>
                  {!viaServer && <option value="webm">WebM</option>}
                  <option value="gif">GIF</option>
                </select>
              </label>
              <label>
                <span>{t('motion.export.size')}</span>
                <select value={height} onChange={(e) => setHeight(Number(e.target.value))} aria-label={t('motion.export.size')}>
                  {heights.map((h) => (
                    <option key={h} value={h}>
                      {h === H ? t('motion.export.sizeOriginal', { size: `${W}×${H}` }) : `${evenDown((W * h) / H)}×${evenDown(h)}`}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>{t('motion.export.fps')}</span>
                <select value={rate} onChange={(e) => setRate(Number(e.target.value))} aria-label={t('motion.export.fps')}>
                  {rates.map((r) => (
                    <option key={r} value={r}>
                      {r === fps ? t('motion.export.fpsOriginal', { fps: r }) : t('motion.export.fpsValue', { fps: r })}
                    </option>
                  ))}
                </select>
              </label>
              {format !== 'gif' && (
                <label>
                  <span>{t('motion.export.quality')}</span>
                  <select value={quality} onChange={(e) => setQuality(e.target.value as VideoQuality)} aria-label={t('motion.export.quality')}>
                    <option value="high">{t('motion.export.qualityHigh')}</option>
                    <option value="medium">{t('motion.export.qualityMedium')}</option>
                    <option value="low">{t('motion.export.qualityLow')}</option>
                  </select>
                </label>
              )}
              <label>
                <span>{t('motion.export.range')}</span>
                <select value={range} onChange={(e) => setRange(e.target.value as 'whole' | 'scene')} aria-label={t('motion.export.range')}>
                  <option value="whole">{t('motion.export.rangeWhole', { length: seconds(duration) })}</option>
                  {scene && <option value="scene">{t('motion.export.rangeScene', { name: scene.name, length: seconds(scene.to - scene.from) })}</option>}
                </select>
              </label>
              {firstFrame && (
                <label className="vcheck">
                  <input type="checkbox" checked={coverFirst} onChange={(e) => setCoverFirst(e.target.checked)} />
                  <span>{t('motion.export.coverFirst')}</span>
                </label>
              )}
              <p className="note">
                {format === 'gif' ? t('motion.export.gifNote') : t('motion.export.formatNote')} {t('motion.export.frames', { count: frames })}
              </p>
            </div>
          )}
      </>
      <footer>
        <button type="button" className="btn" onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button type="submit" className="btn primary" autoFocus>
          {t('motion.export.start')}
        </button>
      </footer>
    </Dialog>
  );
}
