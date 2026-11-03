import type { Capture, Paper } from './types.ts';

// What a library entry *is*, as opposed to `type`, which is its BibTeX entry type.
// A preprint and a journal article are both papers; a GitHub repo and a blog post are not.
export type Kind = 'paper' | 'web' | 'code' | 'dataset' | 'note';

export const KINDS: Kind[] = ['paper', 'web', 'code', 'dataset', 'note'];

export const KIND_LABEL: Record<Kind, string> = {
  paper: 'Paper', web: 'Web page', code: 'Code', dataset: 'Dataset', note: 'Idea',
};

export const KIND_PLURAL: Record<Kind, string> = {
  paper: 'Papers', web: 'Web pages', code: 'Code', dataset: 'Datasets', note: 'Ideas',
};

// Entries that are not literature: no PDF or DOI is expected, and the library check
// should not nag about authors or a publication year.
export const isPaperLike = (k: Kind) => k === 'paper';

export const kindOf = (p: { kind?: Kind }): Kind => p.kind ?? 'paper';

const host = (url?: string) => {
  if (!url) return '';
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; }
};
const pathOf = (url?: string) => {
  if (!url) return '';
  try { return new URL(url).pathname.toLowerCase(); } catch { return ''; }
};
const on = (h: string, ...domains: string[]) => domains.some((d) => h === d || h.endsWith('.' + d));

// Repository and package hosts: a link here is code, even when it also carries a DOI
// (a Zenodo-archived repo is still the software, not a paper about it).
const CODE_HOSTS = ['github.com', 'gitlab.com', 'bitbucket.org', 'codeberg.org', 'sourceforge.net',
  'pypi.org', 'npmjs.com', 'crates.io', 'rubygems.org', 'hub.docker.com', 'gitee.com'];

const DATASET_HOSTS = ['kaggle.com', 'figshare.com', 'openml.org', 'data.gov', 'dataverse.harvard.edu',
  'zenodo.org', 'opendatasoft.com', 'datahub.io', 'roboflow.com'];

// Journals, conferences, preprint servers and indexes: a link here is literature.
const PAPER_HOSTS = ['arxiv.org', 'biorxiv.org', 'medrxiv.org', 'openreview.net', 'aclanthology.org',
  'ieeexplore.ieee.org', 'dl.acm.org', 'link.springer.com', 'sciencedirect.com', 'nature.com',
  'science.org', 'pubmed.ncbi.nlm.nih.gov', 'ncbi.nlm.nih.gov', 'semanticscholar.org', 'mdpi.com',
  'frontiersin.org', 'plos.org', 'onlinelibrary.wiley.com', 'tandfonline.com', 'sagepub.com',
  'cambridge.org', 'oup.com', 'jmlr.org', 'proceedings.mlr.press', 'papers.nips.cc', 'iospress.com',
  'researchgate.net', 'ssrn.com', 'hal.science', 'dblp.org'];

/**
 * Guess what a captured page is. Explicit host rules win over everything, because a DOI on a
 * software or data archive still describes software or data. `hint` is what the metadata
 * provider said (Crossref knows its own datasets), and beats our identifier heuristics.
 * Everything unrecognised that has a URL is a web page — the safer default, since calling a
 * blog post a paper pollutes the BibTeX.
 */
export function detectKind(c: Capture & { type?: string }, hint?: Kind): Kind {
  const h = host(c.url);
  const p = pathOf(c.url);

  if (h === 'huggingface.co') return p.startsWith('/datasets/') ? 'dataset' : 'code';
  if (h === 'paperswithcode.com') return p.startsWith('/dataset') ? 'dataset' : 'paper';
  if (on(h, ...CODE_HOSTS)) return 'code';
  if (on(h, ...DATASET_HOSTS)) return 'dataset';
  if (c.type === 'dataset') return 'dataset';
  if (c.type === 'software') return 'code';
  if (hint) return hint;

  if (c.arxivId) return 'paper';
  if (on(h, ...PAPER_HOSTS)) return 'paper';
  if (c.doi) return 'paper';
  // Citation meta tags (`citation_title` and friends) are emitted by journals and repositories,
  // so a page carrying a journal name or a PDF link alongside authors is literature.
  if (c.pdfUrl && (c.authors?.length || c.venue)) return 'paper';
  if (!c.url) return 'note';
  return 'web';
}
