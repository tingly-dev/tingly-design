import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { TINGLY_BOX_ANTHROPIC, TINGLY_BOX_IMAGEGEN, boxClaudeUrl, TINGLY_BOX_URL, resolveAi, validBaseUrl, validProfile, type AiCard, type AiSource, type ClaudeMode, type KeyFrom } from '@dc/core';
import { api, type AiConfig, type AiDraft } from '../api';
import { toast, useStore } from '../store';
import { External } from './icons';
import { Dialog } from './Dialog';
import { Segmented } from './Segmented';

const BOX_REPO = 'https://github.com/tingly-dev/tingly-box';
type FastPreset = 'tingly-box' | 'anthropic' | 'custom';
type ImagePreset = 'tingly-box' | 'custom';

const close = () => useStore.setState({ aiSettingsOpen: false });

/** Mounted once (main.tsx), opened by `aiSettingsOpen`: the launcher button, the project menu and the prompt bar's hint all set it. */
export function AiSettingsHost() {
  const open = useStore((s) => s.aiSettingsOpen);
  return open ? <AiSettings /> : null;
}

/** A value the environment fixed (a host that embeds the editor) cannot be changed here; say so. */
const Locked = ({ source }: { source: AiSource | 'none' }) => {
  const { t } = useTranslation();
  return source === 'env' ? <span className="lock">{t('aiSettings.fromHost')}</span> : null;
};

/** A choice with Tingly Box's "suggested" mark. */
const BoxLabel = ({ name, suggested }: { name: string; suggested?: boolean }) => {
  const { t } = useTranslation();
  return (
    <>
      {name}
      {suggested && <span className="tag">{t('aiSettings.suggested')}</span>}
    </>
  );
};

/** One of the three jobs: its own title, a line of what it is for, how it stands, and everything it needs. */
function Card({ id, title, note, state, aside, children }: { id: AiCard; title: string; note: string; state: { ok: boolean; text: string }; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="card" data-card={id}>
      <header>
        <h3>{title}</h3>
        <span className={`state ${state.ok ? 'ok' : 'warn'}`} data-state={state.ok ? 'ready' : 'missing'} role="status">
          {state.text}
        </span>
      </header>
      <p className="note">{note}</p>
      {aside}
      {children}
    </section>
  );
}

/** Said only when Tingly Box is not answering: while it runs there is nothing to tell. */
const BoxStatus = ({ up }: { up: boolean }) => {
  const { t } = useTranslation();
  return up ? null : (
    <p className="status" data-box="down">
      {t('aiSettings.boxDown')}{' '}
      <a href={BOX_REPO} target="_blank" rel="noopener noreferrer">
        {t('aiSettings.boxGet')} <External />
      </a>
    </p>
  );
};

/** A key or token. When another card already holds a Tingly Box token, this one can take it at save (a copy, not a link). */
function KeyRow({
  label,
  value,
  onChange,
  placeholder,
  locked,
  source,
  aria,
  reuse,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  locked: boolean;
  source: AiSource | 'none';
  aria: string;
  reuse?: { from: string; picked: boolean; pick: (on: boolean) => void };
}) {
  const { t } = useTranslation();
  return (
    <>
      <label className="field">
        <span>{label}</span>
        {reuse?.picked ? (
          <span className="reused" data-reused>
            {t('aiSettings.reused', { card: reuse.from })}
            <button type="button" className="link" onClick={() => reuse.pick(false)}>
              {t('aiSettings.reusedChange')}
            </button>
          </span>
        ) : (
          <input className="input mono" type="password" autoComplete="off" disabled={locked} placeholder={locked ? '••••••••' : placeholder} value={value} onChange={(e) => onChange(e.target.value)} aria-label={aria} />
        )}
        <Locked source={source} />
      </label>
      {reuse && !reuse.picked && !value.trim() && (
        <button type="button" className="link reuse" data-reuse onClick={() => reuse.pick(true)}>
          {t('aiSettings.reuse', { card: reuse.from })}
        </button>
      )}
    </>
  );
}

/**
 * The three jobs that use a model, one card each: Claude Code (its own sign-in, Tingly Box, or any address),
 * ImageGen and fast AI. A card carries its own address, key and model, so nothing moves when another changes.
 * What wins when a value is set twice is in .design/ai-settings.md.
 */
function AiSettings() {
  const { t } = useTranslation();
  const [cfg, setCfg] = useState<AiConfig | null>(null);
  // fast AI
  const [fastPreset, setFastPreset] = useState<FastPreset>('anthropic');
  const [fastCustom, setFastCustom] = useState('');
  const [fastKey, setFastKey] = useState('');
  const [fastModel, setFastModel] = useState('');
  // Claude Code
  const [mode, setMode] = useState<ClaudeMode>('local');
  const [modeChosen, setModeChosen] = useState(false);
  const [boxKey, setBoxKey] = useState('');
  const [boxModel, setBoxModel] = useState('');
  const [profile, setProfile] = useState('');
  const [customUrl, setCustomUrl] = useState('');
  const [customKey, setCustomKey] = useState('');
  const [customModel, setCustomModel] = useState('');
  // ImageGen
  const [imgPreset, setImgPreset] = useState<ImagePreset>('tingly-box');
  const [imgCustom, setImgCustom] = useState('');
  const [imgKey, setImgKey] = useState('');
  const [imgModel, setImgModel] = useState('');
  const [imgOn, setImgOn] = useState(true);
  // a Tingly Box token one card takes from another when saved
  const [keyFrom, setKeyFrom] = useState<KeyFrom>({});
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    api.aiConfig().then(
      (c) => {
        setCfg(c);
        const f = c.fast;
        // a first run offers Tingly Box when it answers on its default port
        setFastPreset(f.baseUrl.source === 'default' && c.box.reachable && !f.key.set ? 'tingly-box' : f.preset);
        setFastCustom(f.preset === 'custom' ? f.baseUrl.value : '');
        setFastModel(f.model.source === 'saved' ? f.model.value : '');
        setMode(c.claude.mode.value);
        setModeChosen(c.claude.mode.source === 'saved');
        setBoxModel(c.claude.box.model.source === 'saved' ? c.claude.box.model.value : '');
        setProfile(c.claude.box.profile.value);
        setCustomUrl(c.claude.custom.baseUrl.value);
        setCustomModel(c.claude.custom.model.source === 'saved' ? c.claude.custom.model.value : '');
        setImgPreset(c.image.preset ?? 'tingly-box');
        setImgCustom(c.image.preset === 'custom' ? c.image.baseUrl.value : '');
        setImgModel(c.image.model.source === 'saved' ? c.image.model.value : '');
        setImgOn(c.image.enabled.value);
      },
      (e) => {
        toast((e as Error).message, 'error');
        close();
      },
    );
  }, []);
  if (!cfg) return null;

  // ---- fast AI
  const fastUrlLocked = cfg.fast.baseUrl.source === 'env';
  const fastKeyLocked = cfg.fast.key.source === 'env';
  const fastUrl = fastUrlLocked ? cfg.fast.baseUrl.value : fastPreset === 'tingly-box' ? TINGLY_BOX_ANTHROPIC : fastPreset === 'custom' ? fastCustom.trim() : '';
  const fastProblem = !validBaseUrl(fastUrl) || (fastPreset === 'custom' && !fastUrlLocked && !fastUrl) ? t('aiSettings.badUrl') : '';
  const fastDefault = resolveAi({}, { fastBaseUrl: fastUrl }).fast.model.value;

  // ---- Claude Code
  const modeLocked = cfg.claude.mode.source === 'env';
  const customLocked = cfg.claude.custom.baseUrl.source === 'env';
  const customKeyLocked = cfg.claude.custom.key.source === 'env';
  const customProblem = !validBaseUrl(customUrl.trim()) ? t('aiSettings.badUrl') : '';
  const profileProblem = !validProfile(profile.trim()) ? t('aiSettings.badProfile') : '';
  const boxAddress = boxClaudeUrl(TINGLY_BOX_URL, validProfile(profile.trim()) ? profile.trim() : '');

  // ---- ImageGen
  const imgUrlLocked = cfg.image.baseUrl.source === 'env';
  const imgKeyLocked = cfg.image.key.source === 'env';
  const imgOnLocked = cfg.image.enabled.source === 'env';
  const imgUrl = imgUrlLocked ? cfg.image.baseUrl.value : imgPreset === 'tingly-box' ? TINGLY_BOX_IMAGEGEN : imgCustom.trim();
  const imgProblem = !validBaseUrl(imgUrl) ? t('aiSettings.badUrl') : '';
  const imgDefault = resolveAi({}, { imageBaseUrl: imgUrl }).image.model.value;

  // ---- tokens: which cards hold a Tingly Box token (typed here, or saved for the address they have saved)
  const savedBox = (card: AiCard) => (card === 'fast' ? cfg.fast.preset === 'tingly-box' && cfg.fast.key.source === 'saved' : card === 'claude' ? cfg.claude.box.key.set : cfg.image.preset === 'tingly-box' && cfg.image.key.source === 'saved');
  const typed = (card: AiCard) => (card === 'fast' ? fastPreset === 'tingly-box' && fastKey.trim() !== '' : card === 'claude' ? mode === 'box' && boxKey.trim() !== '' : imgPreset === 'tingly-box' && imgKey.trim() !== '');
  const cardName: Record<AiCard, string> = { claude: t('aiSettings.claude'), image: t('aiSettings.image'), fast: t('aiSettings.fast') };
  const holds = (card: AiCard) => typed(card) || savedBox(card);
  /** the other card whose token this one may take */
  const lender = (card: AiCard): AiCard | undefined => (['claude', 'image', 'fast'] as AiCard[]).find((o) => o !== card && holds(o));
  const takes = (card: AiCard, from: AiCard | undefined) => Boolean(from) && keyFrom[card] === from && holds(from!);
  /** a card with no token of its own may take another's; once taken, the field says so */
  const reuseFor = (card: AiCard, own: string, hasSaved: boolean) => {
    const from = keyFrom[card] && holds(keyFrom[card]!) ? keyFrom[card] : lender(card);
    if (!from || own.trim() || (hasSaved && !takes(card, from))) return undefined;
    return { from: cardName[from], picked: takes(card, from), pick: (on: boolean) => setKeyFrom((k) => ({ ...k, [card]: on ? from : undefined })) };
  };
  const taking = (card: AiCard, active: boolean): boolean => active && takes(card, keyFrom[card]);

  const fastHasKey = fastKeyLocked || cfg.fast.key.source === 'saved' || fastKey.trim() !== '' || taking('fast', fastPreset === 'tingly-box');
  const boxHasKey = cfg.claude.box.key.set || boxKey.trim() !== '' || taking('claude', true);
  const customHasKey = customKeyLocked || cfg.claude.custom.key.set || customKey.trim() !== '';
  const imgHasKey = imgKeyLocked || cfg.image.key.source === 'saved' || imgKey.trim() !== '' || taking('image', imgPreset === 'tingly-box');
  const imgReady = Boolean(imgUrl) && imgHasKey && !imgProblem;

  const draft = (): AiDraft => ({
    fastBaseUrl: fastUrlLocked ? '' : fastUrl,
    ...(fastKey.trim() ? { fastKey: fastKey.trim() } : {}),
    fastModel: fastModel.trim(),
    ...(modeLocked || !modeChosen ? {} : { claudeMode: mode }),
    ...(boxKey.trim() ? { claudeBoxKey: boxKey.trim() } : {}),
    claudeBoxModel: boxModel.trim(),
    claudeProfile: profile.trim(),
    claudeBaseUrl: customLocked ? '' : customUrl.trim(),
    ...(customKey.trim() ? { claudeKey: customKey.trim() } : {}),
    claudeModel: customModel.trim(),
    imageBaseUrl: imgUrlLocked ? '' : imgUrl,
    ...(imgKey.trim() ? { imageKey: imgKey.trim() } : {}),
    imageModel: imgModel.trim(),
    ...(imgOn || imgOnLocked ? {} : { imageEnabled: false }),
    keyFrom: Object.fromEntries(
      (Object.entries(keyFrom) as [AiCard, AiCard | undefined][]).filter(([card, from]) => {
        const active = card === 'fast' ? fastPreset === 'tingly-box' : card === 'claude' ? mode === 'box' : imgPreset === 'tingly-box';
        return from && active && takes(card, from);
      }),
    ),
  });
  const problem = fastProblem || (mode === 'custom' ? customProblem : '') || (mode === 'box' ? profileProblem : '') || imgProblem;

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
    if (problem || busy) return;
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

  // ---- how each card stands, for its header
  const claudeState =
    mode === 'local'
      ? cfg.claudeCli
        ? { ok: true, text: t('aiSettings.state.ready') }
        : { ok: false, text: t('aiSettings.state.noCli') }
      : (mode === 'box' ? boxHasKey : customHasKey)
        ? { ok: true, text: t('aiSettings.state.ready') }
        : { ok: false, text: t(mode === 'box' ? 'aiSettings.state.needsToken' : 'aiSettings.state.needsKey') };
  const imageState = !imgReady ? { ok: false, text: t(!imgUrl ? 'aiSettings.state.needsAddress' : imgPreset === 'tingly-box' ? 'aiSettings.state.needsToken' : 'aiSettings.state.needsKey') } : (imgOnLocked ? cfg.image.enabled.value : imgOn) ? { ok: true, text: t('aiSettings.state.ready') } : { ok: false, text: t('aiSettings.state.off') };
  const fastState = fastProblem ? { ok: false, text: t('aiSettings.state.needsAddress') } : fastHasKey ? { ok: true, text: t('aiSettings.state.ready') } : { ok: false, text: t(fastPreset === 'tingly-box' ? 'aiSettings.state.needsToken' : 'aiSettings.state.needsKey') };

  return (
    <Dialog label={t('aiSettings.title')} className="aiset" onClose={close} onSubmit={() => void save()}>
      <Card
        id="claude"
        title={t('aiSettings.claude')}
        note={t('aiSettings.claudeNote')}
        state={claudeState}
        aside={
          modeLocked ? null : (
            <Segmented
              label={t('aiSettings.claude')}
              data="mode"
              value={mode}
              onChange={(m) => {
                setMode(m);
                setModeChosen(true);
              }}
              options={[
                { value: 'local', label: t('aiSettings.tabLocal') },
                { value: 'box', label: <BoxLabel name={t('aiSettings.tabBox')} suggested /> },
                { value: 'custom', label: t('aiSettings.tabCustom') },
              ]}
            />
          )
        }
      >
        {mode === 'local' && (
          <>
            <p className="note">{t('aiSettings.localNote')}</p>
            <p className={`status ${cfg.claudeCli ? 'ok' : 'bad'}`}>{cfg.claudeCli ? t('aiSettings.cliOk') : t('aiSettings.cliMissing')}</p>
          </>
        )}
        {mode === 'box' && (
          <>
            <BoxStatus up={cfg.box.reachable} />
            <KeyRow
              label={t('aiSettings.token')}
              value={boxKey}
              onChange={setBoxKey}
              placeholder={cfg.claude.box.key.set ? t('aiSettings.keyKept') : t('aiSettings.keyBox')}
              locked={false}
              source="none"
              aria={t('aiSettings.claude') + ' ' + t('aiSettings.token')}
              reuse={reuseFor('claude', boxKey, cfg.claude.box.key.set)}
            />
            <label className="field">
              <span>{t('aiSettings.profile')}</span>
              <input className="input mono" placeholder={t('aiSettings.profileMain')} value={profile} onChange={(e) => setProfile(e.target.value)} aria-label={t('aiSettings.profile')} />
            </label>
            {profileProblem ? <p className="status bad">{profileProblem}</p> : <p className="note">{t('aiSettings.profileNote')}</p>}
            <label className="field">
              <span>{t('aiSettings.model')}</span>
              <input
                className="input mono"
                disabled={cfg.claude.box.model.source === 'env'}
                placeholder={resolveAi({}, {}).claude.box.model.value}
                value={cfg.claude.box.model.source === 'env' ? cfg.claude.box.model.value : boxModel}
                onChange={(e) => setBoxModel(e.target.value)}
                aria-label={t('aiSettings.claude') + ' ' + t('aiSettings.model')}
              />
              <Locked source={cfg.claude.box.model.source} />
            </label>
            <p className="status" data-claude-address>
              <code className="addr">{boxAddress}</code>
            </p>
          </>
        )}
        {mode === 'custom' && (
          <>
            {!customLocked && <p className="note">{t('aiSettings.customNote')}</p>}
            <label className="field">
              <span>{t('aiSettings.address')}</span>
              {customLocked ? (
                <code className="addr" data-claude-address>
                  {cfg.claude.custom.baseUrl.value}
                </code>
              ) : (
                <input className="input mono" placeholder="https://api.anthropic.com" value={customUrl} onChange={(e) => setCustomUrl(e.target.value)} aria-label={t('aiSettings.claude') + ' ' + t('aiSettings.address')} />
              )}
              <Locked source={cfg.claude.custom.baseUrl.source} />
            </label>
            <KeyRow
              label={t('aiSettings.key')}
              value={customKey}
              onChange={setCustomKey}
              placeholder={cfg.claude.custom.key.set ? t('aiSettings.keyKept') : 'sk-ant-…'}
              locked={customKeyLocked}
              source={cfg.claude.custom.key.source}
              aria={t('aiSettings.claude') + ' ' + t('aiSettings.key')}
            />
            <label className="field">
              <span>{t('aiSettings.model')}</span>
              <input
                className="input mono"
                disabled={cfg.claude.custom.model.source === 'env'}
                placeholder={resolveAi({}, { claudeBaseUrl: customUrl.trim() }).claude.custom.model.value || t('aiSettings.claudeDefault')}
                value={cfg.claude.custom.model.source === 'env' ? cfg.claude.custom.model.value : customModel}
                onChange={(e) => setCustomModel(e.target.value)}
                aria-label={t('aiSettings.claude') + ' ' + t('aiSettings.model')}
              />
              <Locked source={cfg.claude.custom.model.source} />
            </label>
            {customProblem && <p className="status bad">{customProblem}</p>}
          </>
        )}
      </Card>

      <Card id="image" title={t('aiSettings.image')} note={t('aiSettings.imageNote')} state={imageState}>
        {!imgUrlLocked && (
          <Segmented
            label={t('aiSettings.image')}
            data="image-preset"
            value={imgPreset}
            onChange={setImgPreset}
            options={[
              { value: 'tingly-box', label: <BoxLabel name="Tingly Box" suggested /> },
              { value: 'custom', label: t('aiSettings.custom') },
            ]}
          />
        )}
        {imgPreset === 'tingly-box' && !imgUrlLocked && <BoxStatus up={cfg.box.reachable} />}
        <label className="field">
          <span>{t('aiSettings.address')}</span>
          {imgPreset === 'tingly-box' || imgUrlLocked ? (
            <code className="addr" data-image-address>
              {imgUrl}
            </code>
          ) : (
            <input className="input mono" placeholder="https://api.openai.com/v1" value={imgCustom} onChange={(e) => setImgCustom(e.target.value)} aria-label={t('aiSettings.imageAddress')} />
          )}
          <Locked source={cfg.image.baseUrl.source} />
        </label>
        <KeyRow
          label={imgPreset === 'tingly-box' ? t('aiSettings.token') : t('aiSettings.key')}
          value={imgKey}
          onChange={setImgKey}
          placeholder={cfg.image.key.source === 'saved' ? t('aiSettings.keyKept') : imgPreset === 'tingly-box' ? t('aiSettings.keyBox') : 'sk-…'}
          locked={imgKeyLocked}
          source={cfg.image.key.source}
          aria={t('aiSettings.imageKeyLabel')}
          reuse={imgPreset === 'tingly-box' ? reuseFor('image', imgKey, cfg.image.key.source === 'saved' && cfg.image.preset === 'tingly-box') : undefined}
        />
        <label className="field">
          <span>{t('aiSettings.model')}</span>
          <input
            className="input mono"
            disabled={cfg.image.model.source === 'env'}
            placeholder={imgDefault}
            value={cfg.image.model.source === 'env' ? cfg.image.model.value : imgModel}
            onChange={(e) => setImgModel(e.target.value)}
            aria-label={t('aiSettings.imageModelLabel')}
          />
          <Locked source={cfg.image.model.source} />
        </label>
        <label className={`check${imgReady ? '' : ' off'}`} data-image-switch data-image-state={!imgReady ? 'off' : imgOn ? 'ready' : 'paused'}>
          <input type="checkbox" checked={imgReady && (imgOnLocked ? cfg.image.enabled.value : imgOn)} disabled={!imgReady || imgOnLocked} onChange={(e) => setImgOn(e.target.checked)} />
          <span>{t('aiSettings.imageSwitch')}</span>
          <Locked source={cfg.image.enabled.source} />
        </label>
        {imgReady && !imgOn && <p className="note">{t('aiSettings.imagePaused')}</p>}
        {imgProblem && <p className="status bad">{imgProblem}</p>}
      </Card>

      <Card id="fast" title={t('aiSettings.fast')} note={t('aiSettings.fastNote')} state={fastState}>
        {!fastUrlLocked && (
          <Segmented
            label={t('aiSettings.fast')}
            data="preset"
            value={fastPreset}
            onChange={setFastPreset}
            options={[
              { value: 'tingly-box', label: <BoxLabel name="Tingly Box" suggested /> },
              { value: 'anthropic', label: 'Anthropic' },
              { value: 'custom', label: t('aiSettings.custom') },
            ]}
          />
        )}
        {fastPreset === 'tingly-box' && !fastUrlLocked && <BoxStatus up={cfg.box.reachable} />}
        <label className="field">
          <span>{t('aiSettings.address')}</span>
          {fastPreset === 'custom' && !fastUrlLocked ? (
            <input className="input mono" placeholder="https://" value={fastCustom} onChange={(e) => setFastCustom(e.target.value)} aria-label={t('aiSettings.address')} />
          ) : (
            <code className="addr" data-address>
              {fastUrl || 'https://api.anthropic.com'}
            </code>
          )}
          <Locked source={cfg.fast.baseUrl.source} />
        </label>
        <KeyRow
          label={fastPreset === 'tingly-box' ? t('aiSettings.token') : t('aiSettings.key')}
          value={fastKey}
          onChange={setFastKey}
          placeholder={cfg.fast.key.set ? t('aiSettings.keyKept') : fastPreset === 'tingly-box' ? t('aiSettings.keyBox') : 'sk-ant-…'}
          locked={fastKeyLocked}
          source={cfg.fast.key.source}
          aria={t('aiSettings.fast') + ' ' + t('aiSettings.key')}
          reuse={fastPreset === 'tingly-box' ? reuseFor('fast', fastKey, cfg.fast.key.source === 'saved' && cfg.fast.preset === 'tingly-box') : undefined}
        />
        <label className="field">
          <span>{t('aiSettings.model')}</span>
          <input
            className="input mono"
            disabled={cfg.fast.model.source === 'env'}
            placeholder={fastDefault}
            value={cfg.fast.model.source === 'env' ? cfg.fast.model.value : fastModel}
            onChange={(e) => setFastModel(e.target.value)}
            aria-label={t('aiSettings.fast') + ' ' + t('aiSettings.model')}
          />
          <Locked source={cfg.fast.model.source} />
        </label>
        {fastProblem && <p className="status bad">{fastProblem}</p>}
        <div className="testrow">
          <button type="button" className="btn sm" disabled={busy || !fastHasKey || !!fastProblem} onClick={() => void runTest()}>
            {t('aiSettings.test')}
          </button>
          {test && (
            <span className={`status ${test.ok ? 'ok' : 'bad'}`} role="status">
              {test.text}
            </span>
          )}
          {!fastHasKey && !test && <span className="status">{t('aiSettings.needKey')}</span>}
        </div>
      </Card>

      <footer>
        <button type="button" className="btn" onClick={close}>
          {t('common.cancel')}
        </button>
        <button type="submit" className="btn primary" disabled={busy || !!problem}>
          {t('common.save')}
        </button>
      </footer>
    </Dialog>
  );
}
