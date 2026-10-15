import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

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
}

/** The scene under the playhead, as a range to offer: where it starts and ends on the played timeline. */
export interface ScenePick {
  name: string;
  from: number;
  to: number;
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const evenDown = (n: number) => Math.max(2, Math.floor(n / 2) * 2);

/** Heights people know by name, offered when smaller than the piece. */
const HEIGHTS = [2160, 1440, 1080, 720, 480, 360];

/**
 * Export video: one summary line and one button for the common case (the file this piece should be, at
 * its own size and speed), and everything else behind "More options": format, size, frame rate,
 * quality, and a single scene instead of the whole piece. When the piece holds an embed or a video
 * layer the server's Chrome draws it, which always makes an MP4 at the piece's size, so the options
 * are replaced by a sentence saying so. See .design/export-menu.md.
 */
export function VideoExportDialog({
  size,
  fps,
  duration,
  scene,
  viaServer,
  onStart,
  onClose,
}: {
  size: [number, number];
  fps: number;
  /** milliseconds of video, after speed */
  duration: number;
  scene: ScenePick | null;
  /** scenes with an embed or video layer when the server's Chrome will draw them, else null */
  viaServer: string[] | null;
  onStart: (o: VideoExportOptions) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [W, H] = size;
  const [more, setMore] = useState(false);
  const [format, setFormat] = useState<VideoFormat>('auto');
  const [height, setHeight] = useState(H);
  const [rate, setRate] = useState(fps);
  const [quality, setQuality] = useState<VideoQuality>('high');
  const [range, setRange] = useState<'whole' | 'scene'>('whole');

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  const heights = useMemo(() => [...new Set([H, ...HEIGHTS.filter((h) => h < H)])].sort((a, b) => b - a), [H]);
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
  const summary = viaServer
    ? t('motion.export.summaryServer', { size: `${W}×${H}`, fps })
    : t('motion.export.summary', { format: formatName, size: `${width}×${outH}`, fps: rate, range: span ? t('motion.export.rangeSceneShort', { name: scene!.name }) : t('motion.export.rangeWholeShort'), length: seconds(length) });

  const start = () => onStart({ format, width, height: outH, fps: rate, quality, ...(span ?? {}) });

  return (
    <div className="lmodal" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="ldialog vexport"
        role="dialog"
        aria-label={t('motion.export.title')}
        onSubmit={(e) => {
          e.preventDefault();
          start();
        }}
      >
        <header>
          <h2>{t('motion.export.title')}</h2>
          <button type="button" className="tb" aria-label={t('common.close')} onClick={onClose}>
            ×
          </button>
        </header>
        <p className="vsummary" data-summary>
          {summary}
        </p>
        {viaServer ? (
          <p className="note">{t('motion.export.viaServerOptions', { scenes: viaServer.join(', ') })}</p>
        ) : (
          <>
            <button type="button" className="vmore" aria-expanded={more} onClick={() => setMore(!more)}>
              {more ? t('motion.export.fewerOptions') : t('motion.export.moreOptions')}
            </button>
            {more && (
              <div className="vopts">
                <label>
                  <span>{t('motion.export.format')}</span>
                  <select value={format} onChange={(e) => pickFormat(e.target.value as VideoFormat)} aria-label={t('motion.export.format')}>
                    <option value="auto">{t('motion.export.formatAuto')}</option>
                    <option value="mp4">MP4</option>
                    <option value="webm">WebM</option>
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
                <p className="note">
                  {format === 'gif' ? t('motion.export.gifNote') : span ? t('motion.export.sceneNoSound') : t('motion.export.formatNote')} {t('motion.export.frames', { count: frames })}
                </p>
              </div>
            )}
          </>
        )}
        <footer>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn primary" autoFocus>
            {t('motion.export.start')}
          </button>
        </footer>
      </form>
    </div>
  );
}
