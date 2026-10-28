<p align="right"><b>English</b> · <a href="../../zh/guide/claude-design.md">简体中文</a></p>

# Moving work to and from Claude Design

Tingly Design's canvas, slides, design system and dashboard follow the files of Claude's own Design, Slides, Design System and Dashboard artifacts, so work can go both ways: bring a design made on claude.ai here to keep editing it by hand, in a terminal or with Claude Code, and hand a project made here back as files Claude Code can publish as the original artifact.

| Tingly Design | Claude's type | In the package |
|---|---|---|
| Canvas | Design | `project/canvas.json`, `project/*.dc.html` |
| Slides | Slides | `project/deck.json`, `project/slides/<id>.html` |
| Design system | Design System | `project/design-system.json`, `tokens.json`, `README.md`, `components/`, `assets/`, `fonts/` |
| Dashboard | Dashboard | the store's documents as files: `dash/meta.json`, `dash/params.json`, `datasets/<id>.json`, `files/<name>`, and the attached data as `blobs/<name>` |
| Doc | Docs | no files in the original (Docs live in a service): they go through Markdown |
| Motion | none | there is no original type |

## Bring a design in

1. Ask Claude Code to read the artifact into a folder: *“Read this artifact (the link) and save every file, and its assets, in `~/claude-design/poster`”*. Claude Code saves `project/…` and any pictures the design uses, named by their id.
2. Import that folder, or a `.zip` of it:
   - on the home page, **New project → Import a project package (.zip)…**;
   - or from a terminal, `tingly-design import ~/claude-design/poster`.

There is nothing to pick: Tingly Design sees from the files which kind it is and opens it, named after its title. Pictures that were stored as `/_blob/<id>` and came along are brought into `uploads/`; a toast says how many did not. A dashboard whose data files did not come along opens with its datasets listed under Problems, and attaching a file fixes each one.

A Markdown file saved from Claude Docs (**Export → Markdown**) opens through **New project → Import Markdown (.md)…**, as a new doc.

## Hand a project back

**Import / Export → Claude Design package (.zip)** in a canvas, slides, design system or dashboard (or `tingly-design export <project> --as claude-design`) saves the project in the original layout, with a `README.md` for Claude Code that says how to publish it. Give the unzipped folder to Claude Code: *“Publish this folder as a Slides artifact.”*

Things the toast, or the README, will tell you:

- **Slides' pictures** are files under `uploads/`; the original only accepts uploaded assets there, so Claude Code uploads them before publishing.
- **A design system installed from a project here** is named by a local path. Install the real one on claude.ai.
- **A SQLite query's rows go along** as a `blobs/<id>.csv` per dataset; the dataset points at its file and keeps the query. Claude Code uploads the CSV as an asset before publishing. The database itself is left out — the original Dashboard cannot read one — and a query whose rows could not be read stays a query.
- **Datasets that query a connector** the other side does not have need replacing with an attached file.

The change log, rendered videos, the git folder and other local files never go in a package. To keep a project as it is (change log and design systems included), use **Whole project (.zip)** instead.
