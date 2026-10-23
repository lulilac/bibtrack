// MCP server: gives AI agents (Claude, Gemini CLI, Codex, Cursor, ...) full access to the bibtrack library.
// Run with `npm run mcp` (stdio). It edits the same Dropbox library as the web app; open web UIs update live.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { libraryDir } from './store.ts';
import { LibraryService } from './library.ts';
import { projectPath } from '../shared/projects.ts';
import type { Paper } from '../shared/types.ts';

// stdout is the MCP channel: send all logging to stderr.
console.log = console.error;
console.info = console.error;

const lib = new LibraryService(libraryDir());
const server = new McpServer({ name: 'bibtrack', version: '0.2.0' });

const json = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 1) }] });
const folders = (p: Paper) => p.projects.map((id) => projectPath(lib.lib.projects, id)).filter(Boolean);
const summary = (p: Paper) => ({
  id: p.id, key: p.bibtexKey, title: p.title, authors: p.authors.slice(0, 4).concat(p.authors.length > 4 ? ['…'] : []),
  year: p.year, venue: p.venue, folders: folders(p), tags: p.tags, status: p.status, hasPdf: !!p.pdfFile,
});
const full = ({ projects: _p, ...p }: Paper) => ({ ...p, key: p.bibtexKey, folders: folders({ ...p, projects: _p }), hasPdf: !!p.pdfFile });

// Wrap a tool: results as JSON text, errors reported to the agent instead of crashing.
const tool = <S extends z.ZodRawShape>(name: string, description: string, schema: S, fn: (args: z.infer<z.ZodObject<S>>) => unknown) =>
  server.registerTool(name, { description, inputSchema: schema }, (async (args: any) => {
    try {
      return json(await fn(args));
    } catch (e) {
      return { ...json({ error: (e as Error).message }), isError: true };
    }
  }) as any);

const ref = z.string().describe('Paper id or BibTeX citation key');
const folderRef = z.string().describe('Folder id or path, e.g. "PhD › Social situation" (">" or "/" also work)');
const status = z.enum(['unread', 'reading', 'read']);

tool('search_papers',
  'Search the library. Matches title, authors, venue, abstract, notes, tags, DOI and citation key; with fulltext=true also the text inside PDFs (returns snippets). Filters can be combined; no query lists everything in scope.',
  {
    query: z.string().optional(),
    folder: folderRef.optional().describe('Only papers in this folder (including sub-folders)'),
    tag: z.string().optional(),
    status: status.optional(),
    fulltext: z.boolean().optional().describe('Also search inside PDF text'),
    limit: z.number().int().min(1).max(500).optional().describe('Default 50'),
  },
  ({ query, folder, tag, status, fulltext, limit }) => {
    const r = lib.search({ query, project: folder, tag, status, fulltext, limit });
    return { total: r.total, papers: r.papers.map((p) => ({ ...summary(p), ...(r.snippets.has(p.id) ? { pdfSnippet: r.snippets.get(p.id) } : {}) })) };
  });

tool('get_paper', 'All metadata of one paper, including abstract, notes (with PDF highlights imported from Zotero), URLs and folders.',
  { id: ref }, ({ id }) => full(lib.paper(id)));

tool('read_pdf',
  'Read the text of a paper\'s PDF (extracted once, then cached). Use page ranges for long papers; output is truncated at maxChars.',
  {
    id: ref,
    startPage: z.number().int().min(1).optional(),
    endPage: z.number().int().min(1).optional(),
    maxChars: z.number().int().min(1000).max(400000).optional().describe('Default 60000'),
  },
  ({ id, ...opts }) => lib.readPdf(id, opts));

tool('add_paper',
  'Add a paper from a DOI, arXiv ID, URL (publisher/arXiv page or PDF link) or a title. Metadata is completed from Crossref/arXiv and the PDF downloaded when openly available. If the paper already exists it is only added to the given folders/tags.',
  {
    input: z.string().describe('DOI, arXiv ID, URL or title'),
    folders: z.array(folderRef).optional(),
    tags: z.array(z.string()).optional(),
    notes: z.string().optional(),
    fetchPdf: z.boolean().optional().describe('Default true'),
  },
  async ({ input, folders: f, ...opts }) => {
    const { paper, duplicate } = await lib.addFromInput(input, { ...opts, projects: lib.projectIds(f) });
    return { duplicate, paper: summary(paper) };
  });

tool('update_paper',
  'Edit fields of a paper. Only the given fields change. To change folders prefer set_paper_folders.',
  {
    id: ref,
    fields: z.object({
      title: z.string(), authors: z.array(z.string()).describe('"Last, First" each'), year: z.string(), venue: z.string(),
      type: z.string().describe('BibTeX entry type: article, inproceedings, misc, book, ...'), doi: z.string(), arxivId: z.string(),
      url: z.string(), pdfUrl: z.string(), abstract: z.string(), bibtexKey: z.string(), tags: z.array(z.string()),
      status, rating: z.number().int().min(0).max(5), notes: z.string(),
    }).partial(),
  },
  ({ id, fields }) => summary(lib.updatePaper(id, fields)));

tool('set_paper_folders', 'Add a paper to folders and/or remove it from folders.',
  { id: ref, add: z.array(folderRef).optional(), remove: z.array(folderRef).optional() },
  ({ id, add, remove }) => summary(lib.setPaperFolders(id, add, remove)));

tool('delete_paper', 'Remove a paper from the library (its PDF file is kept on disk).', { id: ref },
  ({ id }) => ({ deleted: summary(lib.deletePaper(id)) }));

tool('list_folders', 'The folder tree with paper counts (direct and including sub-folders).', {}, () => lib.folderTree());

tool('create_folder', 'Create a folder, optionally inside another one.', { name: z.string(), parent: folderRef.optional() },
  ({ name, parent }) => {
    const p = lib.createProject(name, parent);
    return { id: p.id, path: projectPath(lib.lib.projects, p.id) };
  });

tool('update_folder', 'Rename a folder and/or move it (parent "" = top level).',
  { id: folderRef, name: z.string().optional(), parent: z.string().optional().describe('Folder ref, or "" for top level') },
  ({ id, name, parent }) => {
    const p = lib.updateProject(id, { name, parent });
    return { id: p.id, path: projectPath(lib.lib.projects, p.id) };
  });

tool('delete_folder', 'Delete a folder and its sub-folders. Papers stay in the library.', { id: folderRef },
  ({ id }) => { lib.deleteProject(id); return { ok: true }; });

tool('export_bibtex', 'BibTeX for a folder (incl. sub-folders), a list of papers, or the whole library.',
  { folder: folderRef.optional(), ids: z.array(ref).optional() },
  ({ folder, ids }) => lib.exportBib({ project: folder, ids }));

tool('check_library',
  'Integrity check: duplicate groups, missing title/authors/year, placeholder or garbage values, papers without PDF or without DOI/arXiv ID.',
  {}, () => lib.checkLibrary().map((i) => ('ids' in i ? { ...i, papers: i.ids.map((id) => summary(lib.paper(id))) } : { ...i, paper: summary(lib.paper(i.id)) })));

tool('find_metadata',
  'Candidate metadata for a paper with missing or wrong fields (from a DOI/arXiv ID inside its PDF, or a Crossref search). Nothing is changed: apply a candidate with update_paper.',
  { id: ref }, ({ id }) => lib.findMetadata(id));

tool('merge_papers', 'Merge a duplicate into another paper: folders, tags and notes are combined, empty fields filled, the duplicate removed.',
  { keep: ref, merge: ref }, ({ keep, merge }) => summary(lib.mergePapers(keep, merge)));

const transport = new StdioServerTransport();
// Exit when the agent disconnects (the library file watcher would otherwise keep the process alive).
transport.onclose = () => process.exit(0);
process.stdin.on('end', () => process.exit(0));
await server.connect(transport);
