import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TINGLY_BOX_ANTHROPIC, TINGLY_BOX_IMAGEGEN, resolveAi, validBaseUrl, validProfile } from '@dc/core';
import { api, type AiConfig, type AiDraft, type AiSource } from '../api';
import { toast, useStore } from '../store';
import { External } from './icons';
import { Dialog } from './Dialog';

const BOX_REPO = 'https://github.com/tingly-dev/tingly-box';
type Preset = AiConfig['preset'];

const close = () => useStore.setState({ aiSettingsOpen: false });

/** Mounted once (main.tsx), opened by `aiSettingsOpen`: the launcher button, the project menu and the prompt bar's hint all set it. */
export function AiSettingsHost() {
  const open = useStore((s) => s.aiSettingsOpen);
  return open ? <AiSettings /> : null;
}

/** A value the environment fixed (a host that embeds the editor) cannot be changed here; say so. */
const Locked = ({ source }: { source: AiSource | 'connection' | 'none' }) => {
  const { t } = useTranslation();
  return source === 'env' ? <span className="lock">{t('aiSettings.fromHost')}</span> : null;
};

/**
 * The fast model and Claude Code in one place. They share a connection (Tingly Box, Anthropic or any
 * Anthropic-compatible address), each has a model name, and Claude Code may use its own sign-in instead.
 * What wins when a value is set twice is in .design/ai-settings.md.
 */
function AiSettings() {
  const { t } = useTranslation();
  const [cfg, setCfg] = useState<AiConfig | null>(null);
  const [preset, setPreset] = useState<Preset>('anthropic');
  const [custom, setCustom] = useState('');
  const [key, setKey] = useState('');
  const [fastModel, setFastModel] = useState('');
  const [claudeModel, setClaudeModel] = useState('');
  const [profile, setProfile] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [imageKey, setImageKey] = useState('');
  const [imageModel, setImageModel] = useState('');
  const [imageOn, setImageOn] = useState(true);
  // null until the person chooses: then it follows whether there is a key, as the server's default does
  const [chosen, setChosen] = useState<'shared' | 'login' | null>(null);
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    api.aiConfig().then(
      (c) => {
        setCfg(c);
        // a first run offers Tingly Box when it answers on its default port
        setPreset(c.baseUrl.source === 'default' && c.box.reachable && !c.key.set ? 'tingly-box' : c.preset);
        setCustom(c.preset === 'custom' ? c.baseUrl.value : '');
        setFastModel(c.fastModel.source === 'saved' ? c.fastModel.value : '');
        setClaudeModel(c.claudeModel.source === 'saved' ? c.claudeModel.value : '');
        setProfile(c.claudeProfile.source === 'saved' ? c.claudeProfile.value : '');
        setImageUrl(c.image.baseUrl.source === 'saved' ? c.image.baseUrl.value : '');
        setImageModel(c.image.model.source === 'saved' ? c.image.model.value : '');
        setImageOn(c.image.enabled.value);
        setChosen(c.claudeRoute.source === 'saved' ? c.claudeRoute.value : null);
      },
      (e) => {
        toast((e as Error).message, 'error');
        close();
      },
    );
  }, []);
  if (!cfg) return null;

  const urlLocked = cfg.baseUrl.source === 'env';
  const keyLocked = cfg.key.source === 'env';
  const baseUrl = urlLocked ? cfg.baseUrl.value : preset === 'tingly-box' ? TINGLY_BOX_ANTHROPIC : preset === 'custom' ? custom.trim() : '';
  const problem = !validBaseUrl(baseUrl) || (preset === 'custom' && !urlLocked && !baseUrl) ? t('aiSettings.badUrl') : '';
  // what the empty model fields would mean with this connection
  const dflt = resolveAi({}, { baseUrl });
  // a Tingly Box Claude Code profile is part of the address Claude Code is given, so it is typed as a plain name
  const profileLocked = cfg.claudeProfile.source === 'env';
  const profileProblem = preset === 'tingly-box' && !profileLocked && !validProfile(profile.trim()) ? t('aiSettings.badProfile') : '';
  const claudeAddr = resolveAi({}, { baseUrl, claudeProfile: profileLocked ? cfg.claudeProfile.value : profile.trim() }).claudeBaseUrl;
  const hasKey = keyLocked || cfg.key.set || key.trim() !== '';
  const route = chosen ?? (hasKey ? 'shared' : 'login');
  // the image address follows the connection when it can (Tingly Box); otherwise it is typed
  const imgUrlLocked = cfg.image.baseUrl.source === 'env';
  const followsBox = preset === 'tingly-box' && !imgUrlLocked;
  const imgUrl = imgUrlLocked ? cfg.image.baseUrl.value : followsBox ? TINGLY_BOX_IMAGEGEN : imageUrl.trim();
  const imgOnLocked = cfg.image.enabled.source === 'env';
  const imgKeyLocked = cfg.image.key.source === 'env';
  const imgProblem = !validBaseUrl(imgUrl) ? t('aiSettings.badUrl') : '';
  const imgDflt = resolveAi({}, { baseUrl, imageBaseUrl: imgUrl }).image;
  // the connection's key is lent only to an address that follows the connection (the same rule as the server's)
  const lent = resolveAi({}, { baseUrl, imageBaseUrl: imgUrl, ...(hasKey ? { apiKey: 'x' } : {}) }).image.key.set;
  const imgReady = Boolean(imgUrl) && (imgKeyLocked || cfg.image.key.source === 'saved' || imageKey.trim() !== '' || lent) && !imgProblem;
  const draft = (): AiDraft => ({
    imageBaseUrl: imgUrlLocked || followsBox ? '' : imgUrl,
    ...(imageKey.trim() ? { imageKey: imageKey.trim() } : {}),
    imageModel: imageModel.trim(),
    ...(imageOn || imgOnLocked ? {} : { imageEnabled: false }),
    baseUrl: urlLocked ? '' : baseUrl,
    ...(key.trim() ? { apiKey: key.trim() } : {}),
    fastModel: fastModel.trim(),
    claudeModel: claudeModel.trim(),
    ...(preset === 'tingly-box' && !profileLocked ? { claudeProfile: profile.trim() } : {}),
    ...(chosen ? { claudeRoute: chosen } : {}),
  });

  const runTest = async () => {
    setBusy(true);
    setTest(null);
    try {
      const r = await api.testAiConfig(draft());
      setTest(r.ok ? { ok: true, text: t('aiSettings.testOk', { ms: r.ms }) } : { ok: false, text: r.error ?? '' });
    } catch (e) {
      setTest({ ok: false, text: (e as Error).message });
    }
    setBusy(false);
  };
  const save = async () => {
    if (problem || imgProblem || profileProblem || busy) return;
    setBusy(true);
    try {
      await api.saveAiConfig(draft());
      useStore.setState({ health: await api.health(), aiSettingsOpen: false });
      toast(t('aiSettings.saved'), 'info');
    } catch (e) {
      toast((e as Error).message, 'error');
      setBusy(false);
    }
  };

  const presets: { id: Preset; name: string; hint?: string }[] = [
    { id: 'tingly-box', name: 'Tingly Box', hint: t('aiSettings.suggested') },
    { id: 'anthropic', name: 'Anthropic' },
    { id: 'custom', name: t('aiSettings.custom') },
  ];

  return (
    <Dialog label={t('aiSettings.title')} className="aiset" onClose={close} onSubmit={() => void save()}>

      <section>
        <h3>{t('aiSettings.connection')}</h3>
        <p className="note">{t('aiSettings.connectionNote')}</p>
        {!urlLocked && (
          <div className="kinds" role="radiogroup" aria-label={t('aiSettings.connection')}>
            {presets.map((p) => (
              <button type="button" key={p.id} role="radio" aria-checked={preset === p.id} data-preset={p.id} className="kopt" onClick={() => setPreset(p.id)}>
                <span className="name">{p.name}</span>
                {p.hint && <span className="tag">{p.hint}</span>}
              </button>
            ))}
          </div>
        )}
        {preset === 'tingly-box' && !urlLocked && (
          <p className={`status ${cfg.box.reachable ? 'ok' : ''}`} data-box={cfg.box.reachable ? 'up' : 'down'}>
            {cfg.box.reachable ? t('aiSettings.boxUp') : t('aiSettings.boxDown')}{' '}
            <a href={BOX_REPO} target="_blank" rel="noopener noreferrer">
              {t('aiSettings.boxGet')} <External />
            </a>
          </p>
        )}
        <label className="field">
          <span>{t('aiSettings.address')}</span>
          {preset === 'custom' && !urlLocked ? (
            <input className="input mono" placeholder="https://" value={custom} onChange={(e) => setCustom(e.target.value)} aria-label={t('aiSettings.address')} />
          ) : (
            <code className="addr" data-address>
              {baseUrl || 'https://api.anthropic.com'}
            </code>
          )}
          <Locked source={cfg.baseUrl.source} />
        </label>
        <label className="field">
          <span>{t('aiSettings.key')}</span>
          <input
            className="input mono"
            type="password"
            autoComplete="off"
            disabled={keyLocked}
            placeholder={keyLocked ? '••••••••' : cfg.key.set ? t('aiSettings.keyKept') : preset === 'tingly-box' ? t('aiSettings.keyBox') : 'sk-ant-…'}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            aria-label={t('aiSettings.key')}
          />
          <Locked source={cfg.key.source} />
        </label>
        {problem && <p className="status bad">{problem}</p>}
      </section>

      <section>
        <h3>{t('aiSettings.fast')}</h3>
        <p className="note">{t('aiSettings.fastNote')}</p>
        <label className="field">
          <span>{t('aiSettings.model')}</span>
          <input
            className="input mono"
            disabled={cfg.fastModel.source === 'env'}
            placeholder={dflt.fastModel.value}
            value={cfg.fastModel.source === 'env' ? cfg.fastModel.value : fastModel}
            onChange={(e) => setFastModel(e.target.value)}
            aria-label={t('aiSettings.fast') + ' ' + t('aiSettings.model')}
          />
          <Locked source={cfg.fastModel.source} />
        </label>
        <div className="testrow">
          <button type="button" className="btn sm" disabled={busy || !hasKey || !!problem} onClick={() => void runTest()}>
            {t('aiSettings.test')}
          </button>
          {test && (
            <span className={`status ${test.ok ? 'ok' : 'bad'}`} role="status">
              {test.text}
            </span>
          )}
          {!hasKey && !test && <span className="status">{t('aiSettings.needKey')}</span>}
        </div>
      </section>

      <section data-image-section>
        <h3>{t('aiSettings.image')}</h3>
        <p className="note">{t('aiSettings.imageNote')}</p>
        <label className="field">
          <span>{t('aiSettings.address')}</span>
          {followsBox || imgUrlLocked ? (
            <code className="addr" data-image-address>
              {imgUrl}
            </code>
          ) : (
            <input className="input mono" placeholder="https://api.openai.com/v1" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} aria-label={t('aiSettings.imageAddress')} />
          )}
          <Locked source={cfg.image.baseUrl.source} />
        </label>
        {followsBox && <p className="status">{t('aiSettings.imageBoxNote')}</p>}
        {preset === 'anthropic' && !imgUrl && <p className="status" data-image-none>{t('aiSettings.imageNoEndpoint')}</p>}
        {imgUrl && (
          <>
            <label className="field">
              <span>{t('aiSettings.key')}</span>
              <input
                className="input mono"
                type="password"
                autoComplete="off"
                disabled={imgKeyLocked}
                placeholder={imgKeyLocked ? '••••••••' : cfg.image.key.source === 'saved' ? t('aiSettings.keyKept') : t('aiSettings.imageKeyShared')}
                value={imageKey}
                onChange={(e) => setImageKey(e.target.value)}
                aria-label={t('aiSettings.imageKeyLabel')}
              />
              <Locked source={cfg.image.key.source} />
            </label>
            <label className="field">
              <span>{t('aiSettings.model')}</span>
              <input
                className="input mono"
                disabled={cfg.image.model.source === 'env'}
                placeholder={imgDflt.model.value}
                value={cfg.image.model.source === 'env' ? cfg.image.model.value : imageModel}
                onChange={(e) => setImageModel(e.target.value)}
                aria-label={t('aiSettings.imageModelLabel')}
              />
              <Locked source={cfg.image.model.source} />
            </label>
            <label className={`check${imgReady ? '' : ' off'}`} data-image-switch>
              <input type="checkbox" checked={imgReady && (imgOnLocked ? cfg.image.enabled.value : imageOn)} disabled={!imgReady || imgOnLocked} onChange={(e) => setImageOn(e.target.checked)} />
              <span>{t('aiSettings.imageSwitch')}</span>
              <Locked source={cfg.image.enabled.source} />
            </label>
            <p className={`status ${imgReady && imageOn ? 'ok' : ''}`} data-image-state={!imgReady ? 'off' : imageOn ? 'ready' : 'paused'}>
              {!imgReady ? t('aiSettings.imageOff') : imageOn ? t('aiSettings.imageReady') : t('aiSettings.imagePaused')}
            </p>
          </>
        )}
        {imgProblem && <p className="status bad">{imgProblem}</p>}
      </section>

      <section>
        <h3>Claude Code</h3>
        <p className="note">{t('aiSettings.claudeNote')}</p>
        <div className="seg" role="group" aria-label="Claude Code">
          {(
            [
              ['shared', t('aiSettings.routeShared')],
              ['login', t('aiSettings.routeLogin')],
            ] as const
          ).map(([k, l]) => (
            <button type="button" key={k} data-route={k} aria-pressed={route === k} onClick={() => setChosen(k)}>
              {l}
            </button>
          ))}
        </div>
        {route === 'shared' && preset === 'tingly-box' && (
          <>
            <label className="field">
              <span>{t('aiSettings.profile')}</span>
              <input
                className="input mono"
                disabled={profileLocked}
                placeholder={t('aiSettings.profileMain')}
                value={profileLocked ? cfg.claudeProfile.value : profile}
                onChange={(e) => setProfile(e.target.value)}
                aria-label={t('aiSettings.profile')}
              />
              <Locked source={cfg.claudeProfile.source} />
            </label>
            {profileProblem ? <p className="status bad">{profileProblem}</p> : <p className="note">{t('aiSettings.profileNote')}</p>}
            <p className="status" data-claude-address>
              <code className="addr">{claudeAddr}</code>
            </p>
          </>
        )}
        {route === 'shared' && (
          <label className="field">
            <span>{t('aiSettings.model')}</span>
            <input
              className="input mono"
              disabled={cfg.claudeModel.source === 'env'}
              placeholder={dflt.claudeModel.value || t('aiSettings.claudeDefault')}
              value={cfg.claudeModel.source === 'env' ? cfg.claudeModel.value : claudeModel}
              onChange={(e) => setClaudeModel(e.target.value)}
              aria-label={'Claude Code ' + t('aiSettings.model')}
            />
            <Locked source={cfg.claudeModel.source} />
          </label>
        )}
        <p className={`status ${cfg.claudeCli ? 'ok' : 'bad'}`}>{cfg.claudeCli ? t('aiSettings.cliOk') : t('aiSettings.cliMissing')}</p>
        {route === 'shared' && !hasKey && <p className="status bad">{t('aiSettings.sharedNeedsKey')}</p>}
      </section>

      <footer>
        <button type="button" className="btn" onClick={close}>
          {t('common.cancel')}
        </button>
        <button type="submit" className="btn primary" disabled={busy || !!problem || !!imgProblem || !!profileProblem}>
          {t('common.save')}
        </button>
      </footer>
    </Dialog>
  );
}
