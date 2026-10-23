import type { Capture, Paper } from '../shared/types.ts';

const UA = 'bibtrack/0.1 (personal paper manager; mailto:none)';

export const DOI_RE = /\b(10\.\d{4,9}\/[^\s"'<>]+[^\s"'<>.,;)\]])/i;
export const ARXIV_RE = /(?:arxiv\.org\/(?:abs|pdf|html)\/|arxiv:\s*)(\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?/i;

export function cleanDoi(doi?: string) {
  if (!doi) return '';
  const m = decodeURIComponent(doi).match(DOI_RE);
  return m ? m[1] : '';
}

export function normalizeAuthor(name: string) {
  name = name.replace(/\s+/g, ' ').trim();
  if (!name || name.includes(',')) return name;
  const parts = name.split(' ');
  if (parts.length === 1) return name;
  const last = parts.pop()!;
  return `${last}, ${parts.join(' ')}`;
}

const stripTags = (s = '') =>
  s.replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();

async function fetchWithTimeout(url: string, opts: RequestInit = {}, ms = 8000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctl.signal, headers: { 'User-Agent': UA, ...(opts.headers ?? {}) } });
  } finally {
    clearTimeout(t);
  }
}

const crossrefType: Record<string, string> = {
  'journal-article': 'article',
  'proceedings-article': 'inproceedings',
  'book-chapter': 'incollection',
  book: 'book',
  'posted-content': 'misc',
  dissertation: 'phdthesis',
  report: 'techreport',
};

export async function fromCrossref(doi: string): Promise<Partial<Paper> | null> {
  const res = await fetchWithTimeout(`https://api.crossref.org/works/${encodeURIComponent(doi)}`);
  if (!res.ok) return null;
  const m = (await res.json()).message;
  const pdf = (m.link ?? []).find((l: any) => l['content-type'] === 'application/pdf')?.URL ?? '';
  const year = (m.issued ?? m.published ?? m['published-print'] ?? m['published-online'])?.['date-parts']?.[0]?.[0];
  return {
    type: crossrefType[m.type] ?? 'misc',
    title: stripTags(m.title?.[0] ?? ''),
    authors: (m.author ?? []).map((a: any) => (a.family ? `${a.family}${a.given ? ', ' + a.given : ''}` : a.name ?? '')).filter(Boolean),
    year: year ? String(year) : '',
    venue: stripTags(m['container-title']?.[0] ?? m['event']?.name ?? ''),
    doi,
    url: m.URL ?? `https://doi.org/${doi}`,
    pdfUrl: pdf,
    abstract: stripTags(m.abstract ?? ''),
  };
}

export async function fromArxiv(id: string): Promise<Partial<Paper> | null> {
  const res = await fetchWithTimeout(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}`);
  if (!res.ok) return null;
  const xml = await res.text();
  const entry = xml.match(/<entry>([\s\S]*?)<\/entry>/)?.[1];
  if (!entry) return null;
  const tag = (t: string) => stripTags(entry.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`))?.[1] ?? '');
  const title = tag('title');
  if (!title || title === 'Error') return null;
  const authors = [...entry.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>/g)].map((a) => normalizeAuthor(stripTags(a[1])));
  return {
    type: 'misc',
    title,
    authors,
    year: tag('published').slice(0, 4),
    venue: 'arXiv',
    arxivId: id,
    doi: cleanDoi(tag('arxiv:doi')),
    url: `https://arxiv.org/abs/${id}`,
    pdfUrl: `https://arxiv.org/pdf/${id}`,
    abstract: tag('summary'),
  };
}

// Server-side scrape of a page's citation meta tags (used by "add by URL").
export async function fromUrl(url: string): Promise<Capture> {
  const res = await fetchWithTimeout(url, { headers: { Accept: 'text/html' }, redirect: 'follow' });
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('pdf')) return { url, pdfUrl: url };
  const html = (await res.text()).slice(0, 2_000_000);
  const metas: [string, string][] = [];
  for (const m of html.matchAll(/<meta\s+[^>]*>/gi)) {
    const name = m[0].match(/(?:name|property)\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
    const content = m[0].match(/content\s*=\s*["']([^"']*)["']/i)?.[1];
    if (name && content) metas.push([name, stripTags(content)]);
  }
  const get = (...names: string[]) => names.map((n) => metas.find(([k]) => k === n)?.[1]).find(Boolean) ?? '';
  const all = (n: string) => metas.filter(([k]) => k === n).map(([, v]) => v);
  const title = get('citation_title', 'dc.title', 'og:title') || stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '');
  const authors = all('citation_author').length ? all('citation_author') : all('dc.creator');
  return {
    url: res.url || url,
    title,
    authors: authors.map(normalizeAuthor),
    year: (get('citation_publication_date', 'citation_date', 'dc.date', 'citation_online_date').match(/\d{4}/) ?? [''])[0],
    venue: get('citation_journal_title', 'citation_conference_title', 'citation_publisher', 'og:site_name'),
    doi: cleanDoi(get('citation_doi', 'dc.identifier', 'prism.doi') || html.match(DOI_RE)?.[1]),
    arxivId: (res.url || url).match(ARXIV_RE)?.[1] ?? get('citation_arxiv_id'),
    pdfUrl: get('citation_pdf_url'),
    abstract: get('citation_abstract', 'dc.description', 'description', 'og:description'),
  };
}

// Combine whatever the page gave us with authoritative metadata (arXiv / Crossref).
export async function enrich(c: Capture): Promise<Partial<Paper>> {
  const arxivId = c.arxivId || c.url?.match(ARXIV_RE)?.[1] || '';
  // Many publishers put the DOI in the URL (Springer, ACM, Wiley, doi.org...).
  const doi = cleanDoi(c.doi) || cleanDoi(c.url?.split(/[?#]/)[0].replace(/\.pdf$/i, ''));
  let remote: Partial<Paper> | null = null;
  try {
    // arXiv DOIs (10.48550) are DataCite, not Crossref: go straight to the arXiv API.
    if (doi && !doi.startsWith('10.48550/')) remote = await fromCrossref(doi);
    if (!remote && arxivId) remote = await fromArxiv(arxivId);
    else if (remote && arxivId) remote.arxivId = arxivId;
  } catch (e) {
    console.warn('[metadata] lookup failed:', (e as Error).message);
  }
  const pick = (a?: string, b?: string) => (a && a.trim() ? a.trim() : b ?? '');
  const r = remote ?? {};
  return {
    type: r.type ?? 'misc',
    title: pick(r.title, c.title),
    authors: r.authors?.length ? r.authors : (c.authors ?? []).map(normalizeAuthor).filter(Boolean),
    year: pick(r.year, c.year),
    venue: pick(r.venue, c.venue),
    doi: pick(r.doi, doi),
    arxivId: pick(r.arxivId, arxivId),
    url: pick(c.url, r.url),
    pdfUrl: pick(c.pdfUrl, r.pdfUrl),
    abstract: pick(r.abstract, c.abstract),
    notes: c.notes ?? '',
  };
}

// ---------- BibTeX ----------

const STOP = new Set(['a', 'an', 'the', 'on', 'of', 'for', 'in', 'to', 'and', 'with', 'towards', 'toward', 'via', 'from', 'is', 'are']);

const ascii = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]/g, '');

export function makeKey(p: Partial<Paper>, taken: Set<string>) {
  const last = ascii((p.authors?.[0] ?? 'anon').split(',')[0]).toLowerCase() || 'anon';
  const word = (p.title ?? '').toLowerCase().split(/\s+/).map(ascii).find((w) => w && !STOP.has(w)) ?? '';
  const base = `${last}${p.year ?? ''}${word}`;
  let key = base;
  for (let i = 0; taken.has(key); i++) key = base + String.fromCharCode(97 + i);
  return key;
}

const esc = (s: string) => s.replace(/([&%#_$])/g, '\\$1');

export function toBibtex(p: Paper) {
  const fields: [string, string][] = [
    ['title', `{${esc(p.title)}}`],
    ['author', esc(p.authors.join(' and '))],
    ['year', p.year],
  ];
  const venueField = p.type === 'article' ? 'journal' : p.type === 'inproceedings' || p.type === 'incollection' ? 'booktitle' : 'howpublished';
  if (p.venue && !(p.arxivId && p.venue === 'arXiv')) fields.push([venueField, esc(p.venue)]);
  if (p.doi) fields.push(['doi', p.doi]);
  if (p.arxivId) fields.push(['eprint', p.arxivId], ['archivePrefix', 'arXiv']);
  if (p.url) fields.push(['url', p.url]);
  const body = fields.filter(([, v]) => v).map(([k, v]) => `  ${k} = {${v}}`).join(',\n');
  return `@${p.type || 'misc'}{${p.bibtexKey},\n${body}\n}`;
}

// Minimal BibTeX parser (handles nested braces, quoted values, bare numbers, @string/@comment skipped).
export function parseBibtex(src: string): { type: string; key: string; fields: Record<string, string> }[] {
  const out: { type: string; key: string; fields: Record<string, string> }[] = [];
  let i = 0;
  while ((i = src.indexOf('@', i)) !== -1) {
    const head = src.slice(i).match(/^@(\w+)\s*([{(])/);
    if (!head) { i++; continue; }
    const type = head[1].toLowerCase();
    let j = i + head[0].length;
    // find matching close
    let depth = 1, k = j;
    for (; k < src.length && depth; k++) {
      if (src[k] === '{' || src[k] === '(') depth++;
      else if (src[k] === '}' || src[k] === ')') depth--;
    }
    const body = src.slice(j, k - 1);
    i = k;
    if (type === 'comment' || type === 'string' || type === 'preamble') continue;
    const comma = body.indexOf(',');
    const key = body.slice(0, comma).trim();
    const fields: Record<string, string> = {};
    let p = comma + 1;
    while (p < body.length) {
      const fm = body.slice(p).match(/^\s*([\w:-]+)\s*=\s*/);
      if (!fm) break;
      p += fm[0].length;
      let val = '';
      if (body[p] === '{') {
        let d = 0, q = p;
        for (; q < body.length; q++) {
          if (body[q] === '{') d++;
          else if (body[q] === '}' && --d === 0) break;
        }
        val = body.slice(p + 1, q);
        p = q + 1;
      } else if (body[p] === '"') {
        const q = body.indexOf('"', p + 1);
        val = body.slice(p + 1, q);
        p = q + 1;
      } else {
        const m = body.slice(p).match(/^[^,]*/)!;
        val = m[0].trim();
        p += m[0].length;
      }
      fields[fm[1].toLowerCase()] = val.replace(/[{}]/g, '').replace(/\\([&%#_$])/g, '$1').replace(/\s+/g, ' ').trim();
      const c = body.indexOf(',', p);
      p = c === -1 ? body.length : c + 1;
    }
    out.push({ type, key, fields });
  }
  return out;
}

export function bibEntryToPaper(e: ReturnType<typeof parseBibtex>[number]): Partial<Paper> {
  const f = e.fields;
  return {
    type: e.type,
    bibtexKey: e.key,
    title: f.title ?? '',
    authors: (f.author ?? '').split(/\s+and\s+/i).map(normalizeAuthor).filter(Boolean),
    year: (f.year ?? f.date ?? '').slice(0, 4),
    venue: f.journal ?? f.booktitle ?? f.journaltitle ?? f.publisher ?? f.howpublished ?? '',
    doi: cleanDoi(f.doi),
    arxivId: (f.archiveprefix ?? f.eprinttype ?? '').toLowerCase() === 'arxiv' ? f.eprint ?? '' : '',
    url: f.url ?? '',
    abstract: f.abstract ?? '',
    tags: (f.keywords ?? '').split(/[,;]/).map((s) => s.trim()).filter(Boolean),
    notes: f.note ?? f.annote ?? '',
  };
}
