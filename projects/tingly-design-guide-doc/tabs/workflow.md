# Workflow

Tingly Design gives you three ways to change a project, and they all land in the same files. Pick the one that matches the size of the change.

| Editor | Speed | Best for |
| :-- | :-- | :-- |
| Direct manipulation | Instant | Retyping, dragging, resizing, ticking a task, changing a colour |
| Fast AI | Seconds | One element or one passage: "make this shorter", "add a third card" |
| Claude Code | Minutes | Whole files, several files at once, new pages and tabs |

## Working with an agent

1. **Point at something.** Select an element on a canvas or slide, or a passage in a doc. The selection travels with your request, so you can say "this" instead of describing it.
2. **Ask fast AI first.** On a canvas or slide, the model replies with jQuery statements, one per line, that run in a sandboxed copy as they stream in. If a line throws, the whole reply is undone and the model is asked again, up to two retries. In a doc, it rewrites the selected passage.
3. **Hand bigger work to Claude Code.** "Hand to Claude Code" runs the local `claude` command with your request, the file you are looking at, what you pointed at and the recent changes. It may only read and edit files, and it reads the format reference in `.claude/skills/` for the project kind before it starts.
4. **Review in git.** Commit from the change log in the editor, or from your terminal. Because write-back is minimal, the diff shows what actually changed.

No API key is needed to start: jQuery mode lets you type statements yourself, through exactly the same execution and write-back path fast AI uses.

## Model settings

Fast AI calls the model through the Anthropic SDK, and Claude Code inherits the server's environment, so the same variables steer both:

```bash
# Use the Anthropic API directly
ANTHROPIC_API_KEY=sk-ant-... pnpm dev

# Or route through Tingly Box to any model it serves
ANTHROPIC_BASE_URL=http://localhost:12580/tingly/anthropic \
ANTHROPIC_AUTH_TOKEN=<your Tingly Box token> \
pnpm dev
```

- `DC_FAST_MODEL` sets the fast AI model; it defaults to `claude-haiku-5-5`.
- `DC_DELEGATE_MODEL` sets the model for Claude Code; the CLI's default is used when it is unset.
- `DC_PROJECTS` moves the projects folder, and `PORT` moves the server (8787 by default).

## Editing from outside

You do not have to use the editor at all. Any editor, script or agent that writes files under `projects/` is picked up by the file watcher: open editors update live and the change is recorded in the journal as an outside edit. The format references in `.claude/skills/` describe each file format for people and agents alike.
