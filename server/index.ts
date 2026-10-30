import express, { type Request, type Response } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { libraryDir } from './store.ts';
import { HttpError, LibraryService } from './library.ts';
import type { Paper } from '../shared/types.ts';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = Number(process.env.PORT ?? 5577);
const HOST = process.env.HOST ?? '127.0.0.1';
const lib = new LibraryService(libraryDir());
const app = express();

// Origins allowed to write: always this machine, plus BIBTRACK_ORIGIN (comma-separated) when
// bibtrack is served from somewhere else, e.g. https://bibtrack.example.org.
const extraOrigins = new Set(
  (process.env.BIBTRACK_ORIGIN ?? '').split(',').map((s) => s.trim()).filter(Boolean),
);
const allowedOrigin = (o: string) =>
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o) || extraOrigins.has(o);

// Only accept writes from our own pages (blocks other websites from POSTing to the server).
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (req.method !== 'GET' && origin && !allowedOrigin(origin)) {
    return res.status(403).json({ error: 'forbidden origin' });
  }
  next();
});
app.use(express.json({ limit: '5mb' }));

// Wrap a handler: its return value is sent as JSON, HttpErrors become status codes.
const handle = (fn: (req: Request, res: Response) => unknown) => async (req: Request, res: Response) => {
  try {
    const out = await fn(req, res);
    if (!res.headersSent) res.json(out ?? { ok: true });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    if (!res.headersSent) res.status(status).json({ error: (e as Error).message });
  }
};
const raw = express.raw({ type: '*/*', limit: '200mb' });
const text = express.text({ type: '*/*', limit: '50mb' });
const projectsParam = (req: Request) => (req.query.project ? [String(req.query.project)] : []);

// ---------- library & live updates ----------

app.get('/api/library', handle(() => lib.lib));
app.get('/api/info', handle(() => ({ dir: lib.store.dir, bibDir: lib.bibDir })));

app.get('/api/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  const onChange = () => res.write(`data: change\n\n`);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  lib.store.on('change', onChange);
  req.on('close', () => { lib.store.off('change', onChange); clearInterval(ping); });
});

// ---------- papers ----------

app.post('/api/lookup', handle((req) => lib.lookup(req.body)));

app.post('/api/papers', handle((req) => {
  const { meta, ...opts } = req.body as { meta: Partial<Paper>; projects?: string[]; tags?: string[]; status?: Paper['status']; fetchPdf?: boolean };
  return lib.addPaper(meta, opts);
}));
app.post('/api/papers/from-pdf', raw, handle((req) => lib.addFromPdf(req.body as Buffer, { projects: projectsParam(req) })));
app.post('/api/papers/merge', handle((req) => lib.mergePapers(req.body.keep, req.body.merge)));

app.patch('/api/papers/:id', handle((req) => lib.updatePaper(req.params.id, req.body)));
app.put('/api/papers/:id/bibtex', text, handle((req) => lib.updateFromBibtex(req.params.id, req.body as string)));
app.delete('/api/papers/:id', handle((req) => lib.deletePaper(req.params.id)));
app.post('/api/papers/:id/restore', handle((req) => lib.restorePaper(req.body)));
app.post('/api/papers/:id/pdf', raw, handle((req) => lib.attachPdfBuffer(req.params.id, req.body as Buffer)));
app.post('/api/papers/:id/fetch-pdf', handle((req) => lib.downloadPdf(req.params.id)));
app.get('/api/papers/:id/metadata-candidates', handle((req) => lib.findMetadata(req.params.id)));

app.get('/pdf/:id', (req, res) => {
  let file = '';
  try { file = lib.pdfPath(req.params.id); } catch {}
  if (!file) return res.status(404).send('PDF not found');
  res.type('application/pdf').set('Content-Disposition', `inline; filename="${path.basename(file)}"`).sendFile(file);
});

// Full-text matches only (metadata search happens in the browser).
app.get('/api/search', handle((req) => {
  const q = String(req.query.q ?? '');
  return lib.fulltext.search(lib.lib.papers.map((p) => p.id), q);
}));

app.get('/api/check', handle(() => lib.checkLibrary()));

// ---------- folders ----------

app.post('/api/projects', handle((req) => lib.createProject(req.body.name, req.body.parentId)));
app.patch('/api/projects/:id', handle((req) => {
  const { name, color, parentId } = req.body as { name?: string; color?: string; parentId?: string };
  return lib.updateProject(req.params.id, { name, color, parent: parentId });
}));
app.delete('/api/projects/:id', handle((req) => lib.deleteProject(req.params.id)));

// ---------- BibTeX & settings ----------

app.get('/api/export.bib', handle((req, res) => {
  const { project, ids } = req.query as { project?: string; ids?: string };
  const body = lib.exportBib({ project, ids: ids ? ids.split(',') : undefined });
  const name = project ? lib.project(project).name : 'bibtrack';
  res.type('text/plain; charset=utf-8')
    .set('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${name.replace(/[^\w-]+/g, '_')}.bib"`)
    .send(body);
}));
app.post('/api/import', text, handle((req) => lib.importBib(req.body as string, req.query.project as string | undefined)));

app.get('/api/settings', handle(() => lib.settings()));
app.patch('/api/settings', handle((req) => lib.updateSettings({ citekeyPattern: req.body.citekeyPattern })));
app.post('/api/settings/regenerate-keys', handle(() => lib.regenerateKeys()));

// ---------- static web app ----------

const dist = path.join(root, 'web', 'dist');
app.use(express.static(dist));
app.get(['/', '/add', '/bookmarklet'], (_req, res) => {
  const index = path.join(dist, 'index.html');
  fs.existsSync(index) ? res.sendFile(index) : res.status(500).send('Web app not built: run `npm run build`');
});

app.listen(PORT, HOST, () => {
  console.log(`bibtrack running at http://localhost:${PORT}  (library: ${lib.store.file})`);
  // Extract text of PDFs not indexed yet, in the background.
  void lib.indexMissing();
});
