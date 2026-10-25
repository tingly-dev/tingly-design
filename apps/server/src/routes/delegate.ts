import type { Hono } from 'hono';
import { claudeCliReady } from './shared';
import { checkUploads, isTurn, settingsProject } from '@dc/core';
import { HttpError, kindOf, projectDir, readFolder } from '../store';
import { readTranscript, recordTurn } from '../transcript';
import { forgetConversation, isDelegateRunning, readConversation, startDelegate, stopDelegate, type DelegateRequest } from '../delegate';
import { logWarn } from '../log';
import { imageState } from '../imagegen';
import { langOf, trOf } from '../i18n';

/** Claude Code delegation. */
export function registerDelegate(app: Hono): void {
  app.post('/api/projects/:p/delegate', async (c) => {
    const p = c.req.param('p');
    projectDir(p);
    if (!claudeCliReady()) {
      logWarn('delegate.unavailable', { project: p, reason: 'claude CLI not found' });
      return c.json({ error: trOf(c)('errors.noClaudeCli') }, 501);
    }
    const req = await c.req.json<DelegateRequest>();
    if (!req.prompt?.trim()) throw new HttpError(400, 'promptMissing');
    const bad = checkUploads(req.attachments);
    if (bad) throw new HttpError(400, 'badRequest', { detail: bad });
    const kind = (await kindOf(projectDir(p))) ?? 'design';
    // the settings are read here, not trusted from the caller: they are what the project has now
    const files = Object.fromEntries(Object.entries(await readFolder(projectDir(p))).map(([f, s]) => [f, s.content]));
    req.settings = settingsProject(kind, files);
    return c.json({ id: startDelegate(p, req, kind, langOf(c), (await imageState(p)).on) });
  });

  /** The Claude Code conversation the project keeps: the next request continues it unless it asks for a new one. */
  app.get('/api/projects/:p/conversation', (c) => {
    const p = c.req.param('p');
    projectDir(p);
    return c.json(readConversation(p));
  });

  /** What was said and done in the project, newest turns last (.design/chat-panel.md). */
  app.get('/api/projects/:p/transcript', (c) => {
    const p = c.req.param('p');
    projectDir(p);
    // a turn the server lost with its process (a restart, a crash) is not still running
    const now = Date.now();
    return c.json(
      readTranscript(p).map((turn) =>
        turn.state === 'running' && turn.agent === 'claude' && now - turn.startedAt > 20_000 && !isDelegateRunning(turn.id)
          ? { ...turn, state: 'error' as const, answer: turn.answer ?? trOf(c)('prompt.run.interrupted') }
          : turn,
      ),
    );
  });

  /** A turn the editor ran itself (the fast model's), written when it ends. Claude Code's turns are written by the run. */
  app.post('/api/projects/:p/transcript', async (c) => {
    const p = c.req.param('p');
    projectDir(p);
    const turn = await c.req.json<unknown>();
    if (!isTurn(turn) || turn.agent !== 'fast' || turn.source !== 'editor') throw new HttpError(400, 'badRequest', { detail: 'turn' });
    recordTurn(p, turn);
    return c.json({ ok: true });
  });

  app.delete('/api/projects/:p/conversation', (c) => {
    const p = c.req.param('p');
    projectDir(p);
    forgetConversation(p);
    return c.json({ ok: true });
  });

  app.delete('/api/projects/:p/delegate/:id', (c) => {
    const p = c.req.param('p');
    projectDir(p);
    if (!stopDelegate(p, c.req.param('id'))) throw new HttpError(404, 'taskFinished');
    return c.json({ ok: true });
  });
}
