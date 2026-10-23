export type Status = 'unread' | 'reading' | 'read';

export interface Project {
  id: string;
  name: string;
  parentId?: string; // nested projects (like Zotero sub-collections)
  color: string;
  createdAt: string;
  updatedAt: string;
}

export interface Paper {
  id: string;
  type: string; // bibtex entry type: article, inproceedings, misc, ...
  title: string;
  authors: string[]; // "Last, First"
  year: string;
  venue: string;
  doi: string;
  arxivId: string;
  url: string;
  pdfUrl: string;
  pdfFile: string; // file name inside <dir>/pdfs
  abstract: string;
  bibtexKey: string;
  projects: string[];
  tags: string[];
  status: Status;
  rating: number;
  notes: string;
  addedAt: string;
  updatedAt: string;
}

export interface Library {
  version: 1;
  projects: Project[];
  papers: Paper[];
  // tombstones: id -> deletion time, so deletions survive merges of Dropbox conflicted copies
  deleted: Record<string, string>;
  settings?: LibrarySettings;
}

export interface LibrarySettings {
  // JabRef-style citation key pattern, e.g. "[auth:lower][year][veryshorttitle:lower]"
  citekeyPattern?: string;
}

export const DEFAULT_CITEKEY_PATTERN = '[auth:lower][year][veryshorttitle:lower]';

// What the bookmarklet / "add" box sends
export interface Capture {
  title?: string;
  authors?: string[];
  year?: string;
  venue?: string;
  doi?: string;
  arxivId?: string;
  url?: string;
  pdfUrl?: string;
  abstract?: string;
  notes?: string;
}

// A problem found by the library check (JabRef-style integrity check).
export type Issue =
  | { kind: 'duplicate'; ids: string[]; reason: string }
  | { kind: 'missing'; id: string; fields: string[] }
  | { kind: 'suspicious'; id: string; field: string; value: string }
  | { kind: 'no-pdf'; id: string }
  | { kind: 'no-identifier'; id: string };
