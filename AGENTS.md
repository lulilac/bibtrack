# AGENTS.md

Guidance for AI agents (Claude, Gemini, Codex, Cursor, …) that use bibtrack's library through its MCP server, or that
work on this codebase.

## Using the library (MCP tools)

The MCP server (`server/mcp.ts`, started with `npm run mcp` or the command in the README) gives full read/write access to
the user's paper library. Edits are saved immediately; open web UIs refresh live.

**Identifying things**
- **Papers:** by `id` or citation key (`bibtexKey`, e.g. `vaswani2017attention`). Prefer the citation key when you show papers to the user; it's what they `\cite`.
- **Folders:** by id or path, e.g. `"PhD › Social situation"`. You can also write `>` or `/` as the separator, or use a unique folder name on its own.
- **Folder contents:** a folder includes its sub-folders when searching or exporting. A paper can be in several folders.

**Typical workflows**
- *Find and read:*
  1. `search_papers {query, folder?, fulltext: true}` to find candidates; PDF matches come with a snippet.
  2. `get_paper` for abstract and notes.
  3. `read_pdf {id, startPage, endPage}` for the actual text. Read long papers in page ranges.
- *Add:* `add_paper {input: DOI | arXiv ID | URL | title, folders, tags, notes}`. If the paper already exists, it's only added to the folders and tags; check `duplicate` in the result.
- *Organise:*
  - `set_paper_folders {id, add, remove}`
  - `create_folder` / `update_folder {parent: ""}` (top level) / `delete_folder` (papers are kept)
- *Write LaTeX:* `export_bibtex {folder}`. Every folder also has an always-current file at `<library>/bib/<Folder - Path>.bib`.
- *Clean up:*
  1. `check_library` returns duplicate groups and missing or suspicious fields.
  2. For duplicates: `merge_papers {keep, merge}`.
  3. For broken entries: `find_metadata {id}` returns candidates, then apply the right one with `update_paper`. Show the user the candidate before overwriting metadata.

**Conventions**
- Authors are `"Last, First"` strings; `year` is a string; `type` is a BibTeX entry type (`article`, `inproceedings`, `misc`, …).
- `notes` is free text. Papers imported from Zotero contain a `Highlights (from Zotero):` section with the user's PDF highlights as `> quote (p. N)`. Append to notes; don't replace them unless asked.
- `status`: `unread` | `reading` | `read`. `rating` is 0–5.
- Ask before bulk-destructive actions: deleting folders or papers, merging, or regenerating citation keys. Deleted papers are tombstoned and their PDFs stay on disk, but `\cite` keys in the user's documents may break.

## Data on disk

`BIBTRACK_DIR` (default `~/Dropbox/bibtrack`):

| Path | Content |
| --- | --- |
| `library.json` | `{ version, projects[], papers[], deleted{}, settings }`. Folders are called `projects` in the code (`parentId` for nesting); `deleted` holds tombstones (id → time). |
| `pdfs/` | PDFs, named `<bibtexKey>.pdf` |
| `fulltext/<paperId>.txt` | Cached PDF text; pages separated by `\f` |
| `bib/` | Generated `.bib` files. Don't edit them: they're overwritten. |
| `backups/` | Manual backups |

Never write `library.json` directly while the app may be running. Go through `LibraryService` (`server/library.ts`), which
applies each change to the freshest file on disk with an atomic write (`Store.mutate` in `server/store.ts`).

## Working on the code

- **Stack:** TypeScript everywhere, run with `tsx` (no build step for the server); React + Vite for `web/`; no UI library.
- **Single service layer:** new library features go in `server/library.ts`, then they're exposed in *both* `server/index.ts` (HTTP) and `server/mcp.ts` (MCP tool). The UI calls the HTTP API through `web/src/api.ts`.
- **Shared code** (data model, folder tree helpers, citation keys) lives in `shared/` and is imported by the server and the UI.
- **Styling** is `web/src/style.css` with CSS variables for the light and dark themes (`--bg`, `--fg`, `--muted`, …). Reuse them, and check both themes.
- **Checks:**
  - `npm run typecheck`
  - `npm run build`
  - Try changes against a scratch library: `BIBTRACK_DIR=/tmp/x PORT=5599 npm start`. Never test against the user's real library.
- **MCP servers use stdout for the protocol.** Log to stderr only; `server/mcp.ts` redirects `console.log`.
