// One-off migration from Zotero: papers, nested collections, tags, notes, highlights and PDFs.
// Usage: npm run import:zotero -- [path/to/Zotero] [--dry-run]
// Safe to re-run: already imported papers/collections are updated, not duplicated.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Store, libraryDir } from './store.ts';
import { PROJECT_COLORS, blankPaper, findDuplicate, now, uniq } from './papers.ts';
import { ARXIV_RE, cleanDoi } from './metadata.ts';
import { savePdf } from './pdf.ts';
import type { Paper, Project } from '../shared/types.ts';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const candidates = [
  args.find((a) => !a.startsWith('--')),
  path.join(os.homedir(), 'Zotero'),
  path.join(os.homedir(), 'snap/zotero-snap/common/Zotero'),
  path.join(os.homedir(), '.var/app/org.zotero.Zotero/data/Zotero'),
].filter(Boolean) as string[];
const zoteroDir = candidates.find((d) => fs.existsSync(path.join(d, 'zotero.sqlite')));
if (!zoteroDir) {
  console.error(`No zotero.sqlite found in: ${candidates.join(', ')}`);
  process.exit(1);
}

// Zotero keeps the database locked while running, so read a copy.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bibtrack-zotero-'));
fs.copyFileSync(path.join(zoteroDir, 'zotero.sqlite'), path.join(tmp, 'zotero.sqlite'));
const db = new DatabaseSync(path.join(tmp, 'zotero.sqlite'), { readOnly: true });
const all = (sql: string, ...params: (string | number)[]) => db.prepare(sql).all(...params) as any[];

const TYPE_MAP: Record<string, string> = {
  journalArticle: 'article', conferencePaper: 'inproceedings', bookSection: 'incollection', book: 'book',
  thesis: 'phdthesis', report: 'techreport', preprint: 'misc', webpage: 'misc', manuscript: 'unpublished',
};
const ANNOTATION_TYPES: Record<number, string> = { 1: 'highlight', 2: 'note', 3: 'image', 4: 'ink', 5: 'underline' };

const htmlToText = (html: string) =>
  html.replace(/<br\s*\/?>|<\/(p|div|h\d|li)>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n').trim();

const zoteroDate = (d: string) => (d ? new Date(d.replace(' ', 'T') + 'Z').toISOString() : now());

// Resolve a Zotero attachment to a file on disk.
function attachmentFile(att: { key: string; path: string | null; linkMode: number }) {
  if (!att.path) return '';
  if (att.path.startsWith('storage:')) return path.join(zoteroDir!, 'storage', att.key, att.path.slice('storage:'.length));
  return path.isAbsolute(att.path) ? att.path : ''; // "attachments:" (base-dir relative) paths are not supported
}

// ---------- collections → projects ----------
const collections = all(`SELECT collectionID, key, collectionName, parentCollectionID FROM collections`);
const colKey = new Map(collections.map((c) => [c.collectionID, c.key]));
const projectId = (collectionID: number) => `zotero-${colKey.get(collectionID)}`;

// ---------- items ----------
const items = all(`
  SELECT i.itemID, i.key, i.dateAdded, i.dateModified, t.typeName
  FROM items i JOIN itemTypes t USING (itemTypeID)
  WHERE t.typeName NOT IN ('attachment', 'note', 'annotation')
    AND i.itemID NOT IN (SELECT itemID FROM deletedItems)`);
// PDFs added to a collection without a parent item become papers too.
const standalonePdfs = all(`
  SELECT i.itemID, i.key, i.dateAdded, a.path, a.linkMode
  FROM itemAttachments a JOIN items i USING (itemID)
  WHERE a.parentItemID IS NULL AND a.contentType = 'application/pdf'
    AND i.itemID NOT IN (SELECT itemID FROM deletedItems)`);

const fieldsOf = (itemID: number) =>
  Object.fromEntries(all(`
    SELECT f.fieldName, v.value FROM itemData d
    JOIN itemDataValues v USING (valueID) JOIN fields f USING (fieldID) WHERE d.itemID = ?`, itemID)
    .map((r) => [r.fieldName, String(r.value)]));
const collectionsOf = (itemID: number) =>
  all(`SELECT collectionID FROM collectionItems WHERE itemID = ?`, itemID).map((r) => projectId(r.collectionID));
// Only tags you added yourself (type 0); automatic publisher keywords are skipped.
const tagsOf = (itemID: number) =>
  all(`SELECT t.name FROM itemTags it JOIN tags t USING (tagID) WHERE it.itemID = ? AND it.type = 0`, itemID).map((r) => r.name);

function authorsOf(itemID: number) {
  const rows = all(`
    SELECT c.firstName, c.lastName, c.fieldMode, ct.creatorType FROM itemCreators ic
    JOIN creators c USING (creatorID) JOIN creatorTypes ct USING (creatorTypeID)
    WHERE ic.itemID = ? ORDER BY ic.orderIndex`, itemID);
  const authors = rows.filter((r) => r.creatorType === 'author');
  return (authors.length ? authors : rows).map((r) => (r.fieldMode === 1 || !r.firstName ? r.lastName : `${r.lastName}, ${r.firstName}`));
}

function attachmentsOf(itemID: number) {
  return all(`
    SELECT a.itemID, i.key, a.path, a.linkMode, a.contentType FROM itemAttachments a JOIN items i USING (itemID)
    WHERE a.parentItemID = ? AND i.itemID NOT IN (SELECT itemID FROM deletedItems)`, itemID);
}

function notesOf(itemID: number, attachmentIDs: number[]) {
  const parts: string[] = [];
  for (const n of all(`SELECT note FROM itemNotes WHERE parentItemID = ?`, itemID)) {
    const text = htmlToText(n.note);
    if (text) parts.push(text);
  }
  const quotes: string[] = [];
  for (const attID of attachmentIDs) {
    for (const a of all(`SELECT type, text, comment, pageLabel FROM itemAnnotations WHERE parentItemID = ? ORDER BY sortIndex`, attID)) {
      const page = a.pageLabel ? ` (p. ${a.pageLabel})` : '';
      if (a.text) quotes.push(`> ${a.text.replace(/\s+/g, ' ').trim()}${page}${a.comment ? `\n  ${a.comment}` : ''}`);
      else if (a.comment) quotes.push(`• ${a.comment}${page}`);
      else if (ANNOTATION_TYPES[a.type] === 'image' || ANNOTATION_TYPES[a.type] === 'ink') quotes.push(`[${ANNOTATION_TYPES[a.type]} annotation${page}]`);
    }
  }
  if (quotes.length) parts.push(`Highlights (from Zotero):\n\n${quotes.join('\n\n')}`);
  return { notes: parts.join('\n\n'), annotations: quotes.length };
}

type Imported = { meta: Partial<Paper>; pdf: string; zoteroKey: string };
const imported: Imported[] = [];

for (const it of items) {
  const f = fieldsOf(it.itemID);
  const atts = attachmentsOf(it.itemID);
  const { notes, annotations } = notesOf(it.itemID, atts.map((a) => a.itemID));
  const pdfAtt = atts.find((a) => a.contentType === 'application/pdf' && fs.existsSync(attachmentFile(a)));
  const doi = cleanDoi(f.DOI) || cleanDoi(f.extra?.match(/^DOI:\s*(\S+)/im)?.[1]);
  const arxivId = [f.archiveID, f.url, f.extra, doi].map((s) => s?.match(ARXIV_RE)?.[1] ?? s?.match(/10\.48550\/arxiv\.(\d{4}\.\d{4,5})/i)?.[1]).find(Boolean) ?? '';
  imported.push({
    zoteroKey: it.key,
    pdf: pdfAtt ? attachmentFile(pdfAtt) : '',
    meta: {
      id: `zotero-${it.key}`,
      type: TYPE_MAP[it.typeName] ?? 'misc',
      title: f.title ?? '',
      authors: authorsOf(it.itemID),
      year: f.date?.match(/\d{4}/)?.[0] ?? '',
      venue: f.publicationTitle || f.proceedingsTitle || f.bookTitle || f.conferenceName || f.repository || f.websiteTitle || f.publisher || '',
      doi,
      arxivId,
      url: f.url ?? '',
      pdfUrl: arxivId ? `https://arxiv.org/pdf/${arxivId}` : '',
      abstract: f.abstractNote ?? '',
      projects: collectionsOf(it.itemID),
      tags: tagsOf(it.itemID),
      notes,
      status: annotations ? 'read' : 'unread',
      addedAt: zoteroDate(it.dateAdded),
    },
  });
}

for (const a of standalonePdfs) {
  const file = attachmentFile(a);
  if (!fs.existsSync(file)) continue;
  const f = fieldsOf(a.itemID);
  imported.push({
    zoteroKey: a.key,
    pdf: file,
    meta: {
      id: `zotero-${a.key}`,
      title: (f.title ?? path.basename(file)).replace(/\.pdf$/i, '').replace(/_/g, ' '),
      projects: collectionsOf(a.itemID),
      tags: tagsOf(a.itemID),
      notes: notesOf(a.itemID, [a.itemID]).notes,
      addedAt: zoteroDate(a.dateAdded),
    },
  });
}

// ---------- report / write ----------
console.log(`Zotero: ${zoteroDir}`);
console.log(`  ${collections.length} collections, ${items.length} items, ${standalonePdfs.length} standalone PDFs`);
console.log(`  ${imported.filter((x) => x.pdf).length} with PDF, ${imported.filter((x) => x.meta.notes).length} with notes/highlights`);
const noPdf = imported.filter((x) => !x.pdf);
if (noPdf.length) console.log(`  without PDF:\n${noPdf.map((x) => `    - ${x.meta.title}`).join('\n')}`);

if (dryRun) {
  console.log('\n--dry-run: nothing written.');
  process.exit(0);
}

const store = new Store(libraryDir());
let added = 0, updated = 0, pdfs = 0;
store.mutate((lib) => {
  // Projects: create or update, preserving the Zotero tree.
  const topLevel = collections.filter((c) => !c.parentCollectionID);
  const colorOf = new Map<number, string>();
  const colorFor = (c: any): string => {
    if (colorOf.has(c.collectionID)) return colorOf.get(c.collectionID)!;
    const parent = collections.find((x) => x.collectionID === c.parentCollectionID);
    const color = parent ? colorFor(parent) : PROJECT_COLORS[topLevel.indexOf(c) % PROJECT_COLORS.length];
    colorOf.set(c.collectionID, color);
    return color;
  };
  for (const c of collections) {
    const t = now();
    const proj: Project = {
      id: projectId(c.collectionID), name: c.collectionName, color: colorFor(c), createdAt: t, updatedAt: t,
      ...(c.parentCollectionID ? { parentId: projectId(c.parentCollectionID) } : {}),
    };
    // Folders renamed/moved in bibtrack are left alone; folders deleted or merged there stay gone.
    if (!lib.projects.some((p) => p.id === proj.id) && !lib.deleted[proj.id]) lib.projects.push(proj);
  }
  // A collection whose parent was deleted in bibtrack becomes top-level.
  const projIds = new Set(lib.projects.map((p) => p.id));
  for (const p of lib.projects) if (p.parentId && !projIds.has(p.parentId)) delete p.parentId;

  for (const { meta, pdf } of imported) {
    meta.projects = meta.projects?.filter((id) => projIds.has(id));
    const dup = lib.papers.find((p) => p.id === meta.id) ?? findDuplicate(lib, meta);
    let paper: Paper;
    if (dup) {
      // Keep edits made in bibtrack; just merge folders/tags and fill missing fields.
      dup.projects = uniq([...dup.projects, ...(meta.projects ?? [])]);
      dup.tags = uniq([...dup.tags, ...(meta.tags ?? [])]);
      for (const k of ['title', 'year', 'venue', 'doi', 'arxivId', 'url', 'abstract', 'notes'] as const)
        if (!dup[k] && meta[k]) dup[k] = meta[k]!;
      if (!dup.authors.length && meta.authors?.length) dup.authors = meta.authors;
      dup.updatedAt = now();
      paper = dup;
      updated++;
    } else {
      paper = blankPaper(meta, lib);
      lib.papers.push(paper);
      added++;
    }
    if (pdf && !paper.pdfFile) {
      try {
        paper.pdfFile = savePdf(store.pdfDir, paper.bibtexKey, fs.readFileSync(pdf));
        pdfs++;
      } catch (e) {
        console.warn(`  could not copy PDF for "${paper.title}": ${(e as Error).message}`);
      }
    }
  }
  lib.papers.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
});
console.log(`\nImported into ${store.file}: ${added} new, ${updated} already present, ${pdfs} PDFs copied.`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(0);
