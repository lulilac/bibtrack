# bibtrack

A small, fast, Zotero-like paper library. Everything lives in your Dropbox folder, so every machine
running bibtrack sees the same library:

```
~/Dropbox/bibtrack/library.json   # all metadata, projects, notes, tags
~/Dropbox/bibtrack/pdfs/*.pdf     # downloaded / attached PDFs
```

## Setup (once per machine)

```sh
npm install
npm run build
npm start            # → http://localhost:5577
```

Then install the toolbar button (below), or open http://localhost:5577/bookmarklet and drag the
**＋ bibtrack** bookmarklet to your bookmarks bar.

### Toolbar button (Zen / Firefox / Chrome)

The `extension/` folder is a small browser extension: a toolbar button (or <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd>)
that opens the save form in a popup, with the page's metadata already filled in.

- **Zen / Firefox, quick try:** `about:debugging#/runtime/this-firefox` → *Load Temporary Add-on…* →
  pick `extension/manifest.json`. It stays until the browser restarts.
- **Zen / Firefox, permanent:** Firefox-based browsers only keep signed extensions. Sign it once for
  free as a private ("unlisted") add-on: create API keys at https://addons.mozilla.org/developers/addon/api/key/, then
  ```sh
  npx web-ext sign -s extension --channel=unlisted --api-key=USER:XXXX --api-secret=YYYY
  ```
  and open the resulting `web-ext-artifacts/*.xpi` in Zen to install it. Bump `version` in
  `extension/manifest.json` before signing a new build.
- **Chrome / Chromium:** `chrome://extensions` → enable *Developer mode* → *Load unpacked* → pick `extension/`.

Pin the button to the toolbar (Zen: right-click the toolbar → *Customize Toolbar*, or via the
extensions menu). If you change `PORT`, update `SERVER` in `extension/popup.js` and `frame-src` in `extension/manifest.json`.

### Start automatically at login (systemd user service)

Edit `WorkingDirectory` in `bibtrack.service` if the repo lives elsewhere, then:

```sh
mkdir -p ~/.config/systemd/user
cp bibtrack.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now bibtrack
journalctl --user -u bibtrack -f     # logs
```

## Usage

- **Save from the browser:** on any paper page (arXiv, IEEE, ACM, Springer, Elsevier, OpenReview, a PDF…)
  click the bookmarklet. Metadata is read from the page and completed via arXiv / Crossref.
  Pick projects, press <kbd>Enter</kbd>. Selected text on the page becomes a note.
  Adding a paper that's already in the library just adds it to the chosen projects.
- **Add by identifier:** paste a DOI, arXiv ID or URL in the top bar (added to the current project).
- **PDFs:** downloaded automatically when a PDF link is known; otherwise drop a PDF onto the detail pane.
- **Projects:** nested folders; a paper can be in many. Hover a folder for + (sub-folder), ✎ (rename), ↳ (move), × (delete).
- **Tags:** click *Tags* in the sidebar (or press `t`) to search tags and filter by one.
- **BibTeX:** *Export .bib* exports the current project (or everything); *Copy BibTeX* copies one entry.
  *Import .bib* imports a file (e.g. exported from Zotero) into the current project.
- **Keys:** `/` search · `t` tags · `j`/`k` or arrows move · `o` open PDF · `Del` delete (with undo) · `Esc` deselect.

## Migrating from Zotero

```sh
npm run import:zotero -- --dry-run     # show what would be imported
npm run import:zotero                  # import (auto-finds ~/Zotero, snap or flatpak installs)
npm run import:zotero -- /path/to/Zotero
```

Imports papers, the nested collection tree (as nested projects), your own tags, child notes, PDF
highlights (copied into notes as quotes with page numbers) and PDFs (copied into `pdfs/`). Zotero's
database is copied before reading, so Zotero can stay open. Re-running is safe: existing papers keep
your bibtrack edits and only gain missing folders/tags/fields.

## Config

| env var        | default              |
| -------------- | -------------------- |
| `BIBTRACK_DIR` | `~/Dropbox/bibtrack` |
| `PORT`         | `5577`               |

The bookmarklet points at the port it was installed from, so use the same port on every machine.

## Sync notes

- Writes are atomic and each edit is applied to the freshest file on disk; changes arriving via
  Dropbox are picked up live (the UI refreshes on its own).
- If two machines edit before Dropbox syncs, Dropbox creates a `library (… conflicted copy …).json`.
  bibtrack merges it automatically (newest edit per paper wins, deletions are remembered) and removes it.
- The server only listens on `127.0.0.1` and rejects writes from other websites.

## Development

```sh
npm run dev   # server with reload on :5577 + Vite on http://localhost:5578
```

Code: `server/` (Express API, storage, metadata lookups), `web/` (Vite + React UI),
`shared/types.ts` (data model).
