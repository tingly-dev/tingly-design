import type { Hono } from 'hono';
import { claudeCliReady } from './shared';
import { stream } from 'hono/streaming';
import { type ProjectKind, FAST_EDIT_SYSTEM, FAST_EDIT_SYSTEM_CANVAS, FAST_EDIT_SLIDES, FAST_EDIT_MOTION, FAST_EDIT_DOCS, sanitizeSaved, validBaseUrl, type AiCard, type KeyFrom, checkMessages, type ModelMessage } from '@dc/core';
import { HttpError, projectDir } from '../store';
import { publish } from '../hub';
import { logError, logInfo, logWarn } from '../log';
import { aiResolved, boxReachable, fastClient, saveAi, testFast, withKeyFrom } from '../aiconfig';
import { generateImage, imageState, setProjectImageOn } from '../imagegen';
import { langOf, replyLanguage, trOf } from '../i18n';
import type Anthropic from '@anthropic-ai/sdk';

const aiDraft = (b: Record<string, unknown>) => {
  const d = sanitizeSaved(b);
  for (const k of ['fastBaseUrl', 'claudeBaseUrl', 'imageBaseUrl'] as const) if (b[k] && !validBaseUrl(d[k] ?? '')) throw new HttpError(400, 'badBaseUrl');
  return d;
};

/** `keyFrom`: {claude: 'fast'} hands the fast card's token to Claude Code's Tingly Box tab, once, at save (nothing stays linked). */
const keyFromOf = (b: Record<string, unknown>): KeyFrom => {
  const out: KeyFrom = {};
  const cards = ['fast', 'claude', 'image'] as const;
  const from = (b.keyFrom && typeof b.keyFrom === 'object' ? b.keyFrom : {}) as Record<string, unknown>;
  for (const to of cards) if (cards.includes(from[to] as AiCard)) out[to] = from[to] as AiCard;
  return out;
};

/** The fast model's system prompt per kind; a dashboard has none (its page goes to Claude Code). A design system reads as a canvas, as it always has. */
const FAST_PROMPT: Record<ProjectKind, string | null> = {
  design: FAST_EDIT_SYSTEM_CANVAS,
  slides: FAST_EDIT_SYSTEM + '\n\n' + FAST_EDIT_SLIDES,
  'design-system': FAST_EDIT_SYSTEM,
  dashboard: null,
  docs: FAST_EDIT_DOCS,
  motion: FAST_EDIT_SYSTEM + '\n\n' + FAST_EDIT_SLIDES + '\n\n' + FAST_EDIT_MOTION,
};

/** Fast edit, AI settings and images. */
export function registerAi(app: Hono): void {
  app.post('/api/projects/:p/fast-edit', async (c) => {
    const anthropic = fastClient();
    if (!anthropic) {
      logWarn('fast.unavailable', { project: c.req.param('p'), reason: 'no fast model configured' });
      return c.json({ error: trOf(c)('errors.noFastModel') }, 501);
    }
    const model = aiResolved().fast.model.value;
    const body = await c.req.json<{ messages: ModelMessage[]; kind?: string }>();
    const bad = checkMessages(body.messages);
    if (bad) throw new HttpError(400, 'badRequest', { detail: bad });
    const kind: ProjectKind = body.kind && Object.hasOwn(FAST_PROMPT, body.kind) ? (body.kind as ProjectKind) : 'design';
    const system = FAST_PROMPT[kind];
    if (system === null) throw new HttpError(400, 'dashboardIsClaudeCode');
    const lang = replyLanguage(langOf(c));
    const project = c.req.param('p');
    const started = Date.now();
    const meta = { project, kind: body.kind ?? 'design', model, messages: body.messages.length };
    logInfo('fast.start', meta);
    return stream(c, async (s) => {
      const ms = anthropic.messages.stream({
        model,
        max_tokens: 4096,
        system: system + '\n\n' + lang,
        messages: body.messages as Anthropic.MessageParam[],
      });
      let chars = 0;
      s.onAbort(() => {
        logInfo('fast.aborted', { ...meta, ms: Date.now() - started, chars });
        ms.abort();
      });
      try {
        for await (const ev of ms) {
          if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
            chars += ev.delta.text.length;
            await s.write(ev.delta.text);
          }
        }
        const usage = await ms.finalMessage().then((m) => m.usage).catch(() => null);
        logInfo('fast.done', { ...meta, ms: Date.now() - started, chars, inputTokens: usage?.input_tokens, outputTokens: usage?.output_tokens });
      } catch (e) {
        if (!s.aborted) {
          logError('fast.error', { ...meta, ms: Date.now() - started, chars, error: (e as Error).message });
          await s.write(`\n__ERROR__ ${(e as Error).message}\n`);
        }
      }
    });
  });

  // ---------------------------------------------------------------- AI settings

  /** What the settings dialog shows. The key never leaves the server: only whether one is set, and where it came from. */
  app.get('/api/ai-config', async (c) => {
    const boxUp = await boxReachable();
    return c.json({ ...aiResolved(), claudeCli: claudeCliReady(), box: { reachable: boxUp } });
  });

  app.put('/api/ai-config', async (c) => {
    const b = await c.req.json<Record<string, unknown>>();
    await saveAi(aiDraft(b), { reset: b.reset === true, keyFrom: keyFromOf(b) });
    return c.json({ ok: true });
  });

  /** Tries the fast model with what is in the dialog, saved or not. */
  app.post('/api/ai-config/test', async (c) => {
    const b = await c.req.json<Record<string, unknown>>();
    const res = await testFast(withKeyFrom(aiDraft(b), keyFromOf(b)));
    return c.json(res.error === 'noKey' ? { ...res, error: trOf(c)('errors.noFastModel') } : res);
  });

  // ---------------------------------------------------------------- images

  /** Make a picture from a prompt, or change one in the project (`edit`), and keep it under uploads/. Claude Code reaches this through scripts/image-gen.mjs. */
  app.post('/api/projects/:p/images', async (c) => {
    const p = c.req.param('p');
    projectDir(p);
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
    const str = (k: string) => (typeof body[k] === 'string' ? (body[k] as string) : undefined);
    const out = await generateImage(p, { prompt: str('prompt') ?? '', size: str('size'), quality: str('quality'), edit: str('edit') });
    publish(p, { type: 'assets', path: out.path });
    return c.json(out);
  });

  /** Whether pictures can be made in this project: configured in the settings, allowed globally, and not switched off for the project. */
  app.get('/api/projects/:p/image-gen', async (c) => {
    const p = c.req.param('p');
    projectDir(p);
    return c.json(await imageState(p));
  });

  app.put('/api/projects/:p/image-gen', async (c) => {
    const p = c.req.param('p');
    projectDir(p);
    const b = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
    await setProjectImageOn(p, b.enabled !== false);
    return c.json(await imageState(p));
  });
}
