import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Store, libraryDir } from './store.ts';
import { enrich, fromUrl, toBibtex, parseBibtex, bibEntryToPaper, cleanDoi, ARXIV_RE, DOI_RE } from './metadata.ts';
import { downloadPdf, savePdf } from './pdf.ts';
import { PROJECT_COLORS, blankPaper, findDuplicate, now, uniq } from './papers.ts';
import { subtreeIds } from '../shared/projects.ts';
import type { Capture, Paper, Project } from '../shared/types.ts';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = Number(process.env.PORT ?? 5577);
const store = new Store(libraryDir());
const app = express();

// Only accept writes from our own pages (blocks other websites from POSTing to localhost).
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (req.method !== 'GET' && origin && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    return res.status(403).json({ error: 'forbidden origin' });
  }
  next();
});
app.use(express.json({ limit: '5mb' }));

function parseInput(input: string): Capture {
  input = input.trim();
  const arxivId = input.match(ARXIV_RE)?.[1] ?? input.match(/^(\d{4}\.\d{4,5})(v\d+)?$/)?.[1];
  if (arxivId) return { arxivId, url: `https://arxiv.org/abs/${arxivId}` };
  if (/^https?:\/\//.test(input) && !input.includes('doi.org/')) return { url: input };
  const doi = cleanDoi(input.match(DOI_RE)?.[1]);
  if (doi) return { doi };
  return { title: input };
}

async function attachPdf(id: string) {
  const p = store.library.papers.find((x) => x.id === id);
  if (!p?.pdfUrl || p.pdfFile) return;
  const file = await downloadPdf(store.pdfDir, p.bibtexKey, p.pdfUrl);
  if (file) store.mutate((lib) => {
    const q = lib.papers.find((x) => x.id === id);
    if (q) Object.assign(q, { pdfFile: file, updatedAt: now() });
  });
}

// ---------- API ----------

app.get('/api/library', (_req, res) => res.json(store.library));

app.get('/api/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  const onChange = () => res.write(`data: change\n\n`);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  store.on('change', onChange);
  req.on('close', () => { store.off('change', onChange); clearInterval(ping); });
});

// Resolve a capture (from bookmarklet or free-text input) into full metadata without saving.
app.post('/api/lookup', async (req, res) => {
  let c: Capture = req.body.input ? parseInput(req.body.input) : req.body.capture ?? {};
  if (c.url && !c.doi && !c.arxivId && !c.title) {
    try { c = { ...(await fromUrl(c.url)), ...c }; } catch (e) { console.warn('[lookup]', (e as Error).message); }
  }
  const meta = await enrich(c);
  const dup = findDuplicate(store.library, meta);
  res.json({ meta, duplicate: dup ?? null });
});

app.post('/api/papers', async (req, res) => {
  const { meta, projects = [], tags = [], status, fetchPdf = true } = req.body as {
    meta: Partial<Paper>; projects?: string[]; tags?: string[]; status?: Paper['status']; fetchPdf?: boolean;
  };
  const result = store.mutate((lib) => {
    const dup = findDuplicate(lib, meta);
    if (dup) {
      dup.projects = uniq([...dup.projects, ...projects]);
      dup.tags = uniq([...dup.tags, ...tags]);
      if (meta.notes && !dup.notes.includes(meta.notes)) dup.notes = [dup.notes, meta.notes].filter(Boolean).join('\n\n');
      dup.updatedAt = now();
      return { paper: dup, duplicate: true };
    }
    const paper = blankPaper({ ...meta, projects, tags, status: status ?? 'unread' }, lib);
    lib.papers.unshift(paper);
    return { paper, duplicate: false };
  });
  res.json(result);
  if (fetchPdf) attachPdf(result.paper.id);
});

app.patch('/api/papers/:id', (req, res) => {
  const paper = store.mutate((lib) => {
    const p = lib.papers.find((x) => x.id === req.params.id);
    if (!p) return null;
    const { id, addedAt, ...changes } = req.body;
    Object.assign(p, changes, { updatedAt: now() });
    return p;
  });
  paper ? res.json(paper) : res.status(404).json({ error: 'not found' });
});

app.delete('/api/papers/:id', (req, res) => {
  const removed = store.mutate((lib) => {
    const i = lib.papers.findIndex((x) => x.id === req.params.id);
    if (i < 0) return null;
    const [p] = lib.papers.splice(i, 1);
    lib.deleted[p.id] = now();
    return p;
  });
  // PDF is kept on disk until the paper's tombstone is permanent; restoring re-links it.
  removed ? res.json(removed) : res.status(404).json({ error: 'not found' });
});

// Undo a delete.
app.post('/api/papers/:id/restore', (req, res) => {
  const paper = store.mutate((lib) => {
    const p: Paper = { ...req.body, updatedAt: now() };
    delete lib.deleted[p.id];
    if (!lib.papers.some((x) => x.id === p.id)) lib.papers.unshift(p);
    return p;
  });
  res.json(paper);
});

app.post('/api/papers/:id/pdf', express.raw({ type: '*/*', limit: '200mb' }), (req, res) => {
  const p = store.library.papers.find((x) => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'not found' });
  try {
    const file = savePdf(store.pdfDir, p.bibtexKey, req.body as Buffer);
    res.json(store.mutate((lib) => {
      const q = lib.papers.find((x) => x.id === p.id)!;
      return Object.assign(q, { pdfFile: file, updatedAt: now() });
    }));
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.post('/api/papers/:id/fetch-pdf', async (req, res) => {
  const p = store.library.papers.find((x) => x.id === req.params.id);
  if (!p?.pdfUrl) return res.status(400).json({ error: 'no PDF URL' });
  const file = await downloadPdf(store.pdfDir, p.bibtexKey, p.pdfUrl);
  if (!file) return res.status(502).json({ error: 'download did not return a PDF (paywall?)' });
  res.json(store.mutate((lib) => Object.assign(lib.papers.find((x) => x.id === p.id)!, { pdfFile: file, updatedAt: now() })));
});

app.get('/pdf/:id', (req, res) => {
  const p = store.library.papers.find((x) => x.id === req.params.id);
  const file = p?.pdfFile && path.join(store.pdfDir, path.basename(p.pdfFile));
  if (!file || !fs.existsSync(file)) return res.status(404).send('PDF not found');
  res.type('application/pdf').set('Content-Disposition', `inline; filename="${path.basename(file)}"`).sendFile(file);
});

app.post('/api/projects', (req, res) => {
  res.json(store.mutate((lib) => {
    const t = now();
    const proj: Project = {
      id: randomUUID(), name: String(req.body.name ?? 'Untitled').trim(),
      color: PROJECT_COLORS[lib.projects.length % PROJECT_COLORS.length], createdAt: t, updatedAt: t,
    };
    const parent = lib.projects.find((x) => x.id === req.body.parentId);
    if (parent) Object.assign(proj, { parentId: parent.id, color: parent.color });
    lib.projects.push(proj);
    return proj;
  }));
});

app.patch('/api/projects/:id', (req, res) => {
  const { parentId } = req.body as { parentId?: string };
  const lib = store.library;
  const p = lib.projects.find((x) => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'not found' });
  // Moving: '' = top level; the new parent must exist and not be the folder itself or one of its sub-folders.
  if (parentId && (!lib.projects.some((x) => x.id === parentId) || subtreeIds(lib.projects, p.id).has(parentId)))
    return res.status(400).json({ error: 'cannot move a folder into itself or one of its sub-folders' });
  res.json(store.mutate((lib) => {
    const q = lib.projects.find((x) => x.id === req.params.id)!;
    Object.assign(q, { name: req.body.name ?? q.name, color: req.body.color ?? q.color, updatedAt: now() });
    if (parentId !== undefined) {
      if (parentId) q.parentId = parentId;
      else delete q.parentId;
    }
    return q;
  }));
});

app.delete('/api/projects/:id', (req, res) => {
  // Deletes the project and its sub-projects; papers stay in the library.
  store.mutate((lib) => {
    const ids = subtreeIds(lib.projects, req.params.id);
    lib.projects = lib.projects.filter((x) => !ids.has(x.id));
    for (const id of ids) lib.deleted[id] = now();
    for (const p of lib.papers) if (p.projects.some((x) => ids.has(x))) {
      p.projects = p.projects.filter((x) => !ids.has(x));
      p.updatedAt = now();
    }
  });
  res.json({ ok: true });
});

app.get('/api/export.bib', (req, res) => {
  const { project, ids } = req.query as { project?: string; ids?: string };
  const idSet = ids ? new Set(ids.split(',')) : null;
  const projIds = project ? subtreeIds(store.library.projects, project) : null;
  const papers = store.library.papers.filter((p) => (!projIds || p.projects.some((x) => projIds.has(x))) && (!idSet || idSet.has(p.id)));
  const name = store.library.projects.find((x) => x.id === project)?.name ?? 'bibtrack';
  res.type('text/plain; charset=utf-8')
    .set('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${name.replace(/[^\w-]+/g, '_')}.bib"`)
    .send(papers.map(toBibtex).join('\n\n') + '\n');
});

app.post('/api/import', express.text({ type: '*/*', limit: '50mb' }), (req, res) => {
  const project = req.query.project as string | undefined;
  const entries = parseBibtex(req.body as string);
  const result = store.mutate((lib) => {
    let added = 0, merged = 0;
    for (const e of entries) {
      const meta = bibEntryToPaper(e);
      const dup = findDuplicate(lib, meta);
      if (dup) {
        if (project) dup.projects = uniq([...dup.projects, project]);
        dup.updatedAt = now();
        merged++;
      } else {
        lib.papers.push(blankPaper({ ...meta, projects: project ? [project] : [] }, lib));
        added++;
      }
    }
    return { added, merged };
  });
  res.json(result);
});

// ---------- static web app ----------

const dist = path.join(root, 'web', 'dist');
app.use(express.static(dist));
app.get(['/', '/add', '/bookmarklet'], (_req, res) => {
  const index = path.join(dist, 'index.html');
  fs.existsSync(index) ? res.sendFile(index) : res.status(500).send('Web app not built: run `npm run build`');
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`bibtrack running at http://localhost:${PORT}  (library: ${store.file})`);
});
