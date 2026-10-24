# Tingly Design handbook

Status: Draft for review · Audience: people new to Tingly Design and the agents working beside them.

Tingly Design is a local design workspace where you and an AI agent edit the same files. This handbook is one of them: the Docs project `tingly-design-guide-doc`.

## What Tingly Design is

Canvases, slide decks, design systems, dashboards and documents are plain files under `projects/`. You click, drag and retype on screen; a fast model rewrites what you point at in seconds; Claude Code edits the files directly. All three work on the same source, and every open editor sees each change live.

> Every edit writes back only the characters that changed, so the files stay reviewable in git and pleasant to write by hand.

It pairs with [Tingly Box](https://github.com/tingly-dev/tingly-box), our open-source AI gateway that connects any agent to any model. Point `ANTHROPIC_BASE_URL` at Tingly Box and both fast AI and Claude Code run on whichever model you route them to; *Workflow* has the settings.

## Six project kinds

| Kind | What you make | Main files | Skill |
| --- | --- | --- | --- |
| Canvas | Screens and flows | `canvas.json`, `*.dc.html` | `dc-canvas` |
| Slides | Decks with speaker notes | `deck.json`, `slides/<id>.html` | `slides` |
| Design system | Tokens and components | `design-system.json`, `tokens.json` | `design-system` |
| Dashboard | Live data pages | `dash.json`, `datasets/`, `files/index.html` | `dashboard` |
| Docs | Guides and specs | `doc.json`, `tabs/<id>.md`, `comments.json` | `docs` |
| Motion | Promos and animated videos | `motion.json`, `scenes/<id>.html` | `motion` |

## Before your first edit

- [ ] Run `pnpm install`, then `pnpm dev`, and open `localhost:5173`
- [ ] Pick a sample project, or create one of the six kinds from the picker
- [ ] Set `ANTHROPIC_API_KEY` (or a Tingly Box endpoint) to turn on fast AI
- [ ] Install the `claude` command if you want to hand work to Claude Code
- [x] Read this handbook
