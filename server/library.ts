// All library operations, shared by the HTTP API (server/index.ts) and the agent MCP server (server/mcp.ts).
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from './store.ts';
import {
  ARXIV_RE, DOI_RE, bibEntryToPaper, cleanDoi, enrich, fromUrl, makeKey, parseBibtex, searchCrossref, toBibtex,
} from './metadata.ts';
import { downloadPdf, savePdf } from './pdf.ts';
import { FullText, extractPdf } from './fulltext.ts';
import { PROJECT_COLORS, blankPaper, findDuplicate, now, uniq } from './papers.ts';
import { projectPath, projectTree, subtreeIds } from '../shared/projects.ts';
import { DEFAULT_CITEKEY_PATTERN, type Capture, type Issue, type Library, type LibrarySettings, type Paper, type Project } from '../shared/types.ts';

export class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export interface AddOptions { projects?: string[]; tags?: string[]; status?: Paper['status']; notes?: string; fetchPdf?: boolean }

export function parseInput(input: string): Capture {
  input = input.trim();
  const arxivId = input.match(ARXIV_RE)?.[1] ?? input.match(/^(\d{4}\.\d{4,5})(v\d+)?$/)?.[1];
  if (arxivId) return { arxivId, url: `https://arxiv.org/abs/${arxivId}` };
  if (/^https?:\/\//.test(input) && !input.includes('doi.org/')) return { url: input };
  const doi = cleanDoi(input.match(DOI_RE)?.[1]);
  if (doi) return { doi };
  return { title: input };
}

const normTitle = (t: string) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const PLACEHOLDER = /^(paper_?title|title|untitled|conference_?name|journal_?name|firstauthorlast|author)$/i;
const suspiciousTitle = (t: string) =>
  PLACEHOLDER.test(t.trim()) || /^electronic copy available|^microsoft word|^untitled/i.test(t) ||
  (/\.pdf$|_/.test(t) && !/\s/.test(t.replace(/_/g, ''))) || t.includes('|');
const BIB_DIR = 'bib';

// DOI / arXiv ID printed on the first pages of a PDF (SSRN papers only print their abstract id).
function identifiersIn(text: string): { doi?: string; arxivId?: string } {
  const ssrn = text.match(/ssrn\.com\/abstract=(\d+)/i)?.[1];
  return {
    doi: cleanDoi(text.match(DOI_RE)?.[1]) || (ssrn ? `10.2139/ssrn.${ssrn}` : undefined),
    arxivId: text.match(ARXIV_RE)?.[1] ?? text.match(/arXiv:\s*(\d{4}\.\d{4,5})/i)?.[1],
  };
}

// The first meaningful lines of a PDF (title + authors), skipping download banners and journal headers.
function titleBlock(text: string) {
  const junk = /electronic copy|downloaded|https?:|www\.|doi|©|copyright|vol\.|journal|proceedings|^\d+$|^[A-Z\s]{12,}$/i;
  return text.split('\n').map((l) => l.trim()).filter((l) => l.length > 3 && !junk.test(l)).slice(0, 3).join(' ').slice(0, 180);
}

export class LibraryService {
  readonly store: Store;
  readonly fulltext: FullText;
  readonly bibDir: string;
  private bibTimer?: NodeJS.Timeout;

  constructor(dir: string, opts: { autoBib?: boolean } = {}) {
    this.store = new Store(dir);
    this.fulltext = new FullText(dir, this.store.pdfDir);
    this.bibDir = path.join(dir, BIB_DIR);
    if (opts.autoBib !== false) {
      this.store.on('change', () => this.scheduleBibSync());
      this.scheduleBibSync();
    }
  }

  get lib(): Library {
    return this.store.library;
  }

  // ---------- lookups ----------

  // Accepts a paper id or BibTeX key.
  paper(ref: string): Paper {
    const p = this.lib.papers.find((x) => x.id === ref || x.bibtexKey === ref);
    if (!p) throw new HttpError(404, `paper not found: ${ref}`);
    return p;
  }

  // Accepts a folder id, its full path ("PhD › Social situation", "/" or ">" also work) or a unique name.
  project(ref: string): Project {
    const { projects } = this.lib;
    const norm = (s: string) => s.split(/\s*[›>/]\s*/).map((x) => x.trim().toLowerCase()).filter(Boolean).join('›');
    const p = projects.find((x) => x.id === ref)
      ?? projects.find((x) => norm(projectPath(projects, x.id)) === norm(ref))
      ?? (() => {
        const byName = projects.filter((x) => x.name.toLowerCase() === ref.trim().toLowerCase());
        return byName.length === 1 ? byName[0] : undefined;
      })();
    if (!p) throw new HttpError(404, `folder not found: ${ref}`);
    return p;
  }

  projectIds(refs: string[] = []) {
    return refs.map((r) => this.project(r).id);
  }

  // ---------- adding ----------

  // Resolve a capture (bookmarklet / extension) or free text (DOI, arXiv ID, URL, title) into metadata, without saving.
  async lookup(arg: { input?: string; capture?: Capture }) {
    let c: Capture = arg.input ? parseInput(arg.input) : arg.capture ?? {};
    if (c.url && !c.doi && !c.arxivId && !c.title) {
      try { c = { ...(await fromUrl(c.url)), ...c }; } catch (e) { console.warn('[lookup]', (e as Error).message); }
    }
    if (c.title && !c.doi && !c.arxivId && !c.url) {
      // Free-text title: take Crossref's best match if it is clearly the same paper.
      const [best] = await searchCrossref(c.title, 1).catch(() => []);
      if (best && normTitle(best.title ?? '') === normTitle(c.title)) c = { ...c, doi: best.doi };
    }
    const meta = await enrich(c);
    return { meta, duplicate: findDuplicate(this.lib, meta) ?? null };
  }

  addPaper(meta: Partial<Paper>, opts: AddOptions = {}) {
    const { projects = [], tags = [], status, fetchPdf = true } = opts;
    const notes = [meta.notes, opts.notes].filter(Boolean).join('\n\n');
    const result = this.store.mutate((lib) => {
      const dup = findDuplicate(lib, meta);
      if (dup) {
        dup.projects = uniq([...dup.projects, ...projects]);
        dup.tags = uniq([...dup.tags, ...tags]);
        if (notes && !dup.notes.includes(notes)) dup.notes = [dup.notes, notes].filter(Boolean).join('\n\n');
        dup.updatedAt = now();
        return { paper: dup, duplicate: true };
      }
      const paper = blankPaper({ ...meta, notes, projects, tags, status: status ?? 'unread' }, lib);
      lib.papers.unshift(paper);
      return { paper, duplicate: false };
    });
    if (fetchPdf) void this.downloadPdf(result.paper.id).catch(() => {});
    return result;
  }

  async addFromInput(input: string, opts: AddOptions = {}) {
    const { meta } = await this.lookup({ input });
    if (!meta.title) throw new HttpError(422, `could not find metadata for: ${input}`);
    return this.addPaper(meta, opts);
  }

  // A bare PDF: read its first pages for a DOI / arXiv ID, look the paper up, attach the file.
  async addFromPdf(buf: Buffer, opts: AddOptions = {}) {
    let pages: string[] = [], pdfTitle = '';
    try { ({ pages, title: pdfTitle } = await extractPdf(buf, 2)); } catch { throw new HttpError(400, 'not a readable PDF'); }
    const head = pages.join('\n');
    const { doi, arxivId } = identifiersIn(head);
    const firstLine = head.split('\n').map((l) => l.trim()).find((l) => l.length > 15) ?? 'Untitled PDF';
    let meta = await enrich({ doi, arxivId });
    if (!meta.title) meta = { ...(await this.lookup({ input: pdfTitle || firstLine })).meta };
    if (!meta.title) meta.title = pdfTitle || firstLine;
    const { paper, duplicate } = this.addPaper(meta, { ...opts, fetchPdf: false });
    if (!paper.pdfFile) await this.attachPdfBuffer(paper.id, buf);
    return { paper: this.paper(paper.id), duplicate };
  }

  // ---------- editing ----------

  updatePaper(ref: string, changes: Partial<Paper>) {
    const id = this.paper(ref).id;
    return this.store.mutate((lib) => {
      const p = lib.papers.find((x) => x.id === id)!;
      const { id: _id, addedAt: _a, pdfFile: _f, ...rest } = changes;
      Object.assign(p, rest, { updatedAt: now() });
      return p;
    });
  }

  setPaperFolders(ref: string, add: string[] = [], remove: string[] = []) {
    const p = this.paper(ref);
    const addIds = this.projectIds(add), removeIds = new Set(this.projectIds(remove));
    return this.updatePaper(p.id, { projects: uniq([...p.projects.filter((x) => !removeIds.has(x)), ...addIds]) });
  }

  deletePaper(ref: string) {
    const id = this.paper(ref).id;
    // The PDF and extracted text stay on disk, so an undo (restorePaper) loses nothing.
    return this.store.mutate((lib) => {
      const i = lib.papers.findIndex((x) => x.id === id);
      const [p] = lib.papers.splice(i, 1);
      lib.deleted[p.id] = now();
      return p;
    });
  }

  restorePaper(paper: Paper) {
    return this.store.mutate((lib) => {
      const p: Paper = { ...paper, updatedAt: now() };
      delete lib.deleted[p.id];
      if (!lib.papers.some((x) => x.id === p.id)) lib.papers.unshift(p);
      return p;
    });
  }

  // ---------- PDFs ----------

  async attachPdfBuffer(ref: string, buf: Buffer) {
    const p = this.paper(ref);
    let file: string;
    try { file = savePdf(this.store.pdfDir, p.bibtexKey, buf); } catch (e) { throw new HttpError(400, (e as Error).message); }
    const updated = this.store.mutate((lib) => Object.assign(lib.papers.find((x) => x.id === p.id)!, { pdfFile: file, updatedAt: now() }));
    this.fulltext.remove(p.id);
    void this.fulltext.index(p.id, file);
    return updated;
  }

  async downloadPdf(ref: string) {
    const p = this.paper(ref);
    if (p.pdfFile) return p;
    if (!p.pdfUrl) throw new HttpError(400, 'no PDF URL');
    const file = await downloadPdf(this.store.pdfDir, p.bibtexKey, p.pdfUrl);
    if (!file) throw new HttpError(502, 'download did not return a PDF (paywall?)');
    const updated = this.store.mutate((lib) => Object.assign(lib.papers.find((x) => x.id === p.id)!, { pdfFile: file, updatedAt: now() }));
    void this.fulltext.index(p.id, file);
    return updated;
  }

  pdfPath(ref: string) {
    const p = this.paper(ref);
    const file = p.pdfFile && path.join(this.store.pdfDir, path.basename(p.pdfFile));
    return file && fs.existsSync(file) ? file : '';
  }

  async readPdf(ref: string, opts: { startPage?: number; endPage?: number; maxChars?: number } = {}) {
    const p = this.paper(ref);
    if (!this.pdfPath(p.id)) throw new HttpError(404, `no PDF attached to ${p.bibtexKey}`);
    const pages = (await this.fulltext.ensure(p.id, p.pdfFile)).split('\n\f\n');
    const start = Math.max(1, opts.startPage ?? 1), end = Math.min(pages.length, opts.endPage ?? pages.length);
    const max = opts.maxChars ?? 60000;
    let text = pages.slice(start - 1, end).map((t, i) => `--- page ${start + i} ---\n${t}`).join('\n\n');
    const truncated = text.length > max;
    if (truncated) text = text.slice(0, max);
    return { bibtexKey: p.bibtexKey, title: p.title, pages: pages.length, startPage: start, endPage: end, truncated, text };
  }

  // Extract text of every PDF not indexed yet (run in the background by the web server).
  async indexMissing() {
    let n = 0;
    for (const p of this.lib.papers) {
      if (p.pdfFile && !this.fulltext.has(p.id) && this.pdfPath(p.id)) {
        await this.fulltext.index(p.id, p.pdfFile);
        n++;
      }
    }
    if (n) console.log(`[fulltext] indexed ${n} PDF(s)`);
  }

  // ---------- search ----------

  search(opts: { query?: string; project?: string; tag?: string; status?: Paper['status']; fulltext?: boolean; limit?: number }) {
    const inProject = opts.project ? subtreeIds(this.lib.projects, this.project(opts.project).id) : null;
    let papers = this.lib.papers.filter((p) =>
      (!inProject || p.projects.some((x) => inProject.has(x))) &&
      (!opts.tag || p.tags.some((t) => t.toLowerCase() === opts.tag!.toLowerCase())) &&
      (!opts.status || p.status === opts.status));
    const terms = (opts.query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    const snippets = new Map<string, string>();
    if (terms.length) {
      const hay = (p: Paper) => [p.title, p.authors.join(' '), p.year, p.venue, p.abstract, p.notes, p.tags.join(' '), p.doi, p.arxivId, p.bibtexKey].join(' ').toLowerCase();
      const meta = new Set(papers.filter((p) => terms.every((t) => hay(p).includes(t))).map((p) => p.id));
      if (opts.fulltext) for (const { id, snippet } of this.fulltext.search(papers.map((p) => p.id), opts.query!)) snippets.set(id, snippet);
      papers = papers.filter((p) => meta.has(p.id) || snippets.has(p.id));
    }
    return { total: papers.length, papers: papers.slice(0, opts.limit ?? 50), snippets };
  }

  // ---------- folders ----------

  createProject(name: string, parent?: string) {
    const parentId = parent ? this.project(parent).id : undefined;
    return this.store.mutate((lib) => {
      const t = now();
      const proj: Project = {
        id: randomUUID(), name: String(name || 'Untitled').trim(),
        color: PROJECT_COLORS[lib.projects.length % PROJECT_COLORS.length], createdAt: t, updatedAt: t,
      };
      const p = lib.projects.find((x) => x.id === parentId);
      if (p) Object.assign(proj, { parentId: p.id, color: p.color });
      lib.projects.push(proj);
      return proj;
    });
  }

  // `parent`: folder ref, or '' for top level; omitted = don't move.
  updateProject(ref: string, changes: { name?: string; color?: string; parent?: string }) {
    const p = this.project(ref);
    const parentId = changes.parent === undefined ? undefined : changes.parent === '' ? '' : this.project(changes.parent).id;
    if (parentId && subtreeIds(this.lib.projects, p.id).has(parentId))
      throw new HttpError(400, 'cannot move a folder into itself or one of its sub-folders');
    return this.store.mutate((lib) => {
      const q = lib.projects.find((x) => x.id === p.id)!;
      Object.assign(q, { name: changes.name?.trim() || q.name, color: changes.color ?? q.color, updatedAt: now() });
      if (parentId !== undefined) {
        if (parentId) q.parentId = parentId;
        else delete q.parentId;
      }
      return q;
    });
  }

  // Deletes the folder and its sub-folders; papers stay in the library.
  deleteProject(ref: string) {
    const id = this.project(ref).id;
    this.store.mutate((lib) => {
      const ids = subtreeIds(lib.projects, id);
      lib.projects = lib.projects.filter((x) => !ids.has(x.id));
      for (const x of ids) lib.deleted[x] = now();
      for (const p of lib.papers) if (p.projects.some((x) => ids.has(x))) {
        p.projects = p.projects.filter((x) => !ids.has(x));
        p.updatedAt = now();
      }
    });
  }

  folderTree() {
    const { projects, papers } = this.lib;
    return projectTree(projects).map(({ project: p, depth }) => {
      const ids = subtreeIds(projects, p.id);
      return {
        id: p.id, path: projectPath(projects, p.id), depth,
        papers: papers.filter((x) => x.projects.includes(p.id)).length,
        papersInclSubfolders: papers.filter((x) => x.projects.some((y) => ids.has(y))).length,
      };
    });
  }

  // ---------- BibTeX ----------

  papersFor(opts: { project?: string; ids?: string[] }) {
    const inProject = opts.project ? subtreeIds(this.lib.projects, this.project(opts.project).id) : null;
    const ids = opts.ids ? new Set(opts.ids.map((r) => this.paper(r).id)) : null;
    return this.lib.papers.filter((p) => (!inProject || p.projects.some((x) => inProject.has(x))) && (!ids || ids.has(p.id)));
  }

  exportBib(opts: { project?: string; ids?: string[] }) {
    return this.papersFor(opts).map(toBibtex).join('\n\n') + '\n';
  }

  importBib(text: string, project?: string) {
    const projectId = project ? this.project(project).id : undefined;
    const entries = parseBibtex(text);
    return this.store.mutate((lib) => {
      let added = 0, merged = 0;
      for (const e of entries) {
        const meta = bibEntryToPaper(e);
        const dup = findDuplicate(lib, meta);
        if (dup) {
          if (projectId) dup.projects = uniq([...dup.projects, projectId]);
          dup.updatedAt = now();
          merged++;
        } else {
          lib.papers.push(blankPaper({ ...meta, projects: projectId ? [projectId] : [] }, lib));
          added++;
        }
      }
      return { added, merged };
    });
  }

  // Replace a paper's fields from a raw BibTeX entry (JabRef's "BibTeX source" tab).
  updateFromBibtex(ref: string, bibtex: string) {
    const [entry] = parseBibtex(bibtex);
    if (!entry) throw new HttpError(400, 'could not parse the BibTeX entry');
    const m = bibEntryToPaper(entry);
    const p = this.paper(ref);
    if (m.bibtexKey && m.bibtexKey !== p.bibtexKey && this.lib.papers.some((x) => x.bibtexKey === m.bibtexKey))
      throw new HttpError(409, `citation key ${m.bibtexKey} is already used`);
    const { tags: _t, notes: _n, abstract, ...fields } = m; // tags/notes are edited in bibtrack, not in the entry
    return this.updatePaper(p.id, { ...fields, ...(abstract ? { abstract } : {}) });
  }

  settings(): Required<LibrarySettings> {
    return { citekeyPattern: this.lib.settings?.citekeyPattern || DEFAULT_CITEKEY_PATTERN };
  }

  updateSettings(changes: LibrarySettings) {
    return this.store.mutate((lib) => {
      lib.settings = { ...lib.settings, ...changes };
      return lib.settings;
    });
  }

  // Recompute every citation key from the pattern (changes \cite keys!).
  regenerateKeys() {
    const pattern = this.settings().citekeyPattern;
    return this.store.mutate((lib) => {
      const taken = new Set<string>();
      let changed = 0;
      for (const p of [...lib.papers].sort((a, b) => a.addedAt.localeCompare(b.addedAt))) {
        const key = makeKey(p, taken, pattern);
        taken.add(key);
        if (key !== p.bibtexKey) { p.bibtexKey = key; p.updatedAt = now(); changed++; }
      }
      return { changed };
    });
  }

  // Keep <dir>/bib/library.bib and one .bib per folder up to date (like Better BibTeX auto-export).
  // Files are only rewritten when their content changes, so two machines never fight over them in Dropbox.
  syncBibFiles() {
    fs.mkdirSync(this.bibDir, { recursive: true });
    const { projects } = this.lib;
    const want = new Map<string, string>([['library.bib', this.exportBib({})]]);
    for (const p of projects) {
      const name = projectPath(projects, p.id).replace(/ › /g, ' - ').replace(/[\\/:*?"<>|]+/g, '_');
      want.set(`${name}.bib`, this.exportBib({ project: p.id }));
    }
    for (const [name, content] of want) {
      const file = path.join(this.bibDir, name);
      const old = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
      if (old !== content) fs.writeFileSync(file, content);
    }
    for (const f of fs.readdirSync(this.bibDir)) if (f.endsWith('.bib') && !want.has(f)) fs.rmSync(path.join(this.bibDir, f));
  }

  private scheduleBibSync() {
    clearTimeout(this.bibTimer);
    this.bibTimer = setTimeout(() => {
      try { this.syncBibFiles(); } catch (e) { console.warn('[bib]', (e as Error).message); }
    }, 1000);
    this.bibTimer.unref?.();
  }

  // ---------- cleanup (JabRef-style integrity check) ----------

  checkLibrary(): Issue[] {
    const issues: Issue[] = [];
    const papers = this.lib.papers;
    const year = new Date().getFullYear();

    // Duplicates: same DOI / arXiv ID, same normalized title, or one title a long prefix of the other.
    const seen = new Set<string>();
    for (let i = 0; i < papers.length; i++) {
      const a = papers[i];
      if (seen.has(a.id)) continue;
      const group = [a.id];
      let reason = '';
      for (const b of papers.slice(i + 1)) {
        if (seen.has(b.id)) continue;
        const ta = normTitle(a.title), tb = normTitle(b.title);
        const why =
          a.doi && a.doi.toLowerCase() === b.doi.toLowerCase() ? 'same DOI'
          : a.arxivId && a.arxivId === b.arxivId ? 'same arXiv ID'
          : ta.length > 15 && ta === tb ? 'same title'
          : Math.min(ta.length, tb.length) > 30 && (ta.startsWith(tb) || tb.startsWith(ta)) ? 'very similar title'
          : '';
        if (why) { group.push(b.id); seen.add(b.id); reason ||= why; }
      }
      if (group.length > 1) issues.push({ kind: 'duplicate', ids: group, reason });
    }

    for (const p of papers) {
      const missing = (['title', 'authors', 'year'] as const).filter((k) => (k === 'authors' ? !p.authors.length : !p[k].trim()));
      if (missing.length) issues.push({ kind: 'missing', id: p.id, fields: missing });
      const flag = (field: string, value: string) => issues.push({ kind: 'suspicious', id: p.id, field, value });
      if (suspiciousTitle(p.title)) flag('title', p.title);
      if (PLACEHOLDER.test(p.venue.trim())) flag('venue', p.venue);
      if (p.authors.some((a) => PLACEHOLDER.test(a.replace(/[, ]/g, '')))) flag('authors', p.authors.join('; '));
      if (p.year && (!/^\d{4}$/.test(p.year) || +p.year < 1500 || +p.year > year + 1)) flag('year', p.year);
      if (!p.pdfFile) issues.push({ kind: 'no-pdf', id: p.id });
      if (!p.doi && !p.arxivId) issues.push({ kind: 'no-identifier', id: p.id });
    }
    return issues;
  }

  // Merge `merge` into `keep`: union of folders/tags, notes concatenated, empty fields filled, PDF kept.
  mergePapers(keepRef: string, mergeRef: string) {
    const keep = this.paper(keepRef), other = this.paper(mergeRef);
    if (keep.id === other.id) throw new HttpError(400, 'cannot merge a paper with itself');
    return this.store.mutate((lib) => {
      const k = lib.papers.find((x) => x.id === keep.id)!, o = lib.papers.find((x) => x.id === other.id)!;
      k.projects = uniq([...k.projects, ...o.projects]);
      k.tags = uniq([...k.tags, ...o.tags]);
      if (o.notes && !k.notes.includes(o.notes)) k.notes = [k.notes, o.notes].filter(Boolean).join('\n\n');
      for (const f of ['title', 'year', 'venue', 'doi', 'arxivId', 'url', 'pdfUrl', 'pdfFile', 'abstract'] as const) if (!k[f] && o[f]) k[f] = o[f];
      if (!k.authors.length) k.authors = o.authors;
      if (o.rating > k.rating) k.rating = o.rating;
      if (k.status === 'unread') k.status = o.status;
      if (o.addedAt < k.addedAt) k.addedAt = o.addedAt;
      k.updatedAt = now();
      lib.papers = lib.papers.filter((x) => x.id !== o.id);
      lib.deleted[o.id] = now();
      return k;
    });
  }

  // Candidate metadata for a paper with missing/garbage fields: DOI or arXiv ID found in its PDF, else a Crossref title search.
  async findMetadata(ref: string): Promise<Partial<Paper>[]> {
    const p = this.paper(ref);
    let head = '';
    if (this.pdfPath(p.id)) {
      head = (await this.fulltext.ensure(p.id, p.pdfFile)).split('\n\f\n').slice(0, 2).join('\n');
      const ids = identifiersIn(head);
      if (ids.doi || ids.arxivId) {
        const meta = await enrich(ids);
        if (meta.title) return [meta];
      }
    }
    if (p.doi || p.arxivId) {
      const meta = await enrich({ doi: p.doi, arxivId: p.arxivId });
      if (meta.title) return [meta];
    }
    // A garbage title is useless as a query: use the start of the PDF (title + authors) instead.
    const query = suspiciousTitle(p.title) || !p.title
      ? titleBlock(head)
      : [p.title, p.authors[0]?.split(',')[0]].filter(Boolean).join(' ');
    return query.trim() ? searchCrossref(query, 3) : [];
  }
}
