import { randomUUID } from 'node:crypto';
import { makeKey } from './metadata.ts';
import type { Library, Paper } from '../shared/types.ts';

export const PROJECT_COLORS = ['#4f7cff', '#e5534b', '#3fb950', '#d29922', '#a371f7', '#db61a2', '#39c5cf', '#f0883e'];

export const now = () => new Date().toISOString();
export const uniq = <T,>(a: T[]) => [...new Set(a)];

export function findDuplicate(lib: Library, p: Partial<Paper>) {
  const doi = p.doi?.toLowerCase();
  return lib.papers.find(
    (x) =>
      (doi && x.doi.toLowerCase() === doi) ||
      (p.arxivId && x.arxivId === p.arxivId) ||
      (p.url && x.url === p.url) ||
      (p.title && p.title.length > 20 && x.title.toLowerCase() === p.title.toLowerCase()),
  );
}

export function blankPaper(p: Partial<Paper>, lib: Library): Paper {
  const t = now();
  const paper: Paper = {
    id: randomUUID(), type: 'misc', title: '', authors: [], year: '', venue: '', doi: '', arxivId: '', url: '',
    pdfUrl: '', pdfFile: '', abstract: '', bibtexKey: '', projects: [], tags: [], status: 'unread', rating: 0,
    notes: '', addedAt: t, updatedAt: t,
    ...Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)),
  };
  if (!paper.bibtexKey || lib.papers.some((x) => x.bibtexKey === paper.bibtexKey))
    paper.bibtexKey = makeKey(paper, new Set(lib.papers.map((x) => x.bibtexKey)));
  return paper;
}
