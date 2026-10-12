<p align="right"><b>English</b> · <a href="../zh/theming.md">简体中文</a></p>

# Themes

The editor's look is a set of named tokens (colours, shadows, fonts, radii) written as CSS custom properties on `<html>`. Pick one in the launcher's **Appearance** menu, or pass one in from outside. Themes change the editor around your work; canvases, slides, dashboards and design-system previews keep their own colours, since those are the files you are designing.

## Presets

The presets are Tingly Box's own themes, with the same names, so the editor looks like Tingly Box whether it runs alone or inside it, and a host can pass its mode through unchanged.

| Name | Looks like |
|---|---|
| `system` | `light` or `dark`, following the operating system (the default) |
| `light` | Tingly Box's light theme: slate on near-white with a blue accent |
| `dark` | Tingly Box's dark theme: a near-black slate ladder with a brighter blue |
| `claude` | Anthropic's ivory and orange, Tingly Box's `claude` theme |
| `ds` | DeepSeek blue on a misty canvas, Tingly Box's `ds` theme |
| `sunlit` | Sky blue, Tingly Box's `sunlit` theme |

### Staying in step with Tingly Box

Tingly Box's palettes and font stacks are copied, unchanged, into `apps/editor/src/tingly-box/` (`SOURCE.json` names the commit). `theme.ts` turns each palette into tokens the same way it maps a palette a host passes in (see below), with three adjustments the editor needs: translucent colours are composited over the surface they sit on, so every token is a solid colour; `ds` and `sunlit`, whose page is a gradient, take one colour from it for the canvas; and menu and dialog shadows and the 6 px / 12 px radii come from Tingly Box's component styles. When Tingly Box's theme changes:

```bash
node scripts/sync-tingly-box-theme.mjs ../tingly-box   # path to a tingly-box checkout
pnpm typecheck && python3 e2e/theme.py
```

## Passing a theme in

All four ways take the same value: a preset name, or an object.

```jsonc
{
  "base": "dark",          // a preset to start from; default: palette.mode, else light
  "name": "Rose",          // shown in the Appearance menu
  "tokens": { "accent": "#e11d48" },
  "palette": { ... }       // or Tingly Box's own palette (MUI shape), see below
}
```

| Where | How | Kept |
|---|---|---|
| URL | `?theme=dark` or `?theme=` + URL-encoded JSON | For the browser tab, across projects |
| Script | `window.tinglyDesign.setTheme(theme)`; also `getTheme()` and `presets()` | Until the page reloads |
| Host page | `iframe.contentWindow.postMessage({ type: 'tingly-design:set-theme', theme }, '*')` from the page embedding the editor, or the one that opened it | Until the page reloads |
| Server | `DC_THEME=claude pnpm dev`; also inline JSON or a path to a `.json` file | The default when the person has not picked one |

At start-up the URL wins over what the person picked in the menu, which wins over `DC_THEME`, which wins over `system`. After that the newest change wins. Picking in the menu is remembered and drops a theme the URL brought.

When embedded, the editor reports every change to its parent as `{ type: 'tingly-design:theme-changed', theme: { id, mode, scheme, name } }`.

### Tokens

`canvas` `panel` `panel-2` `hover` `line` `line-2` `ink` `ink-2` `muted` `faint` `accent` `accent-ink` `accent-soft` `on-accent` `danger` `danger-soft` `ok` `ok-soft` `warn` `warn-soft` `backdrop` `float-shadow` `lift-shadow` `ui` `mono` `r` `r-float`

Set only the ones you need. A token derived from one you set follows it unless you set it too: change `accent` and `accent-soft`, `accent-ink` and `on-accent` are worked out from it; change `panel` or `ink` and the lines, hover and grey text are mixed from them. Values that could load something (`url(`, `image(`) or end the declaration (`;`, `{`, `}`) are ignored.

### From Tingly Box

Tingly Box keeps its themes as MUI palettes. Pass one as `palette` and it maps like this:

| Palette | Token |
|---|---|
| `mode` | the base: `light` or `dark` |
| `primary.main` / `primary.dark` / `primary.contrastText` | `accent` / `accent-ink` (light mode) / `on-accent` |
| `background.default` / `background.paper` | `canvas` / `panel` (`transparent` is skipped) |
| `text.primary` / `text.secondary` / `text.disabled` | `ink` / `muted` / `faint` |
| `divider`, `action.hover` | `line`, `hover` |
| `error.main` / `success.main` / `warning.main` | `danger` / `ok` / `warn` |

```js
editorFrame.contentWindow.postMessage({ type: 'tingly-design:set-theme', theme: { name: 'Tingly Box', palette: theme.palette } }, '*');
```

---

Back to the [README](../../README.md)
