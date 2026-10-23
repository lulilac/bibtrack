// JabRef-style citation keys, shared by the server (key generation) and the UI (live preview).
import { DEFAULT_CITEKEY_PATTERN, type Paper } from './types.ts';

const STOP = new Set(['a', 'an', 'the', 'on', 'of', 'for', 'in', 'to', 'and', 'with', 'towards', 'toward', 'via', 'from', 'is', 'are']);

const ascii = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]/g, '');

const significant = (title = '') => title.split(/\s+/).map(ascii).filter((w) => w && !STOP.has(w.toLowerCase()));
const lastName = (a?: string) => ascii((a ?? '').split(',')[0]);

// JabRef-style key patterns: [auth] [authEtAl] [authors2] [year] [shorttitle] [veryshorttitle] [venue],
// each optionally followed by :lower or :upper. Unknown tokens are dropped.
export function formatKey(p: Partial<Paper>, pattern = DEFAULT_CITEKEY_PATTERN) {
  const a = p.authors ?? [];
  const tokens: Record<string, () => string> = {
    auth: () => lastName(a[0]) || 'anon',
    authetal: () => (a.length > 2 ? `${lastName(a[0])}EtAl` : a.slice(0, 2).map(lastName).join('')) || 'anon',
    authors2: () => a.slice(0, 2).map(lastName).join('') + (a.length > 2 ? 'EtAl' : '') || 'anon',
    year: () => p.year ?? '',
    shorttitle: () => significant(p.title).slice(0, 3).map((w) => w[0].toUpperCase() + w.slice(1)).join(''),
    veryshorttitle: () => significant(p.title)[0] ?? '',
    venue: () => significant(p.venue).map((w) => w[0].toUpperCase()).join(''),
  };
  return pattern.replace(/\[([a-z0-9]+)(?::(lower|upper))?\]/gi, (_m, name: string, mod?: string) => {
    const v = tokens[name.toLowerCase()]?.() ?? '';
    return mod === 'lower' ? v.toLowerCase() : mod === 'upper' ? v.toUpperCase() : v;
  }).replace(/[^\w:-]/g, '');
}
