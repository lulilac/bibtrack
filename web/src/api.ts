import { useCallback, useEffect, useState } from 'react';
import type { Capture, Library, Paper, Project } from '../../shared/types.ts';

export type { Capture, Library, Paper, Project };

async function req<T>(method: string, url: string, body?: unknown, raw = false): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined && !raw ? { 'Content-Type': 'application/json' } : undefined,
    body: body === undefined ? undefined : raw ? (body as BodyInit) : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? res.statusText);
  return data as T;
}

export const api = {
  library: () => req<Library>('GET', '/api/library'),
  lookup: (arg: { input?: string; capture?: Capture }) =>
    req<{ meta: Partial<Paper>; duplicate: Paper | null }>('POST', '/api/lookup', arg),
  addPaper: (body: { meta: Partial<Paper>; projects?: string[]; tags?: string[]; status?: Paper['status']; fetchPdf?: boolean }) =>
    req<{ paper: Paper; duplicate: boolean }>('POST', '/api/papers', body),
  updatePaper: (id: string, changes: Partial<Paper>) => req<Paper>('PATCH', `/api/papers/${id}`, changes),
  deletePaper: (id: string) => req<Paper>('DELETE', `/api/papers/${id}`),
  restorePaper: (p: Paper) => req<Paper>('POST', `/api/papers/${p.id}/restore`, p),
  uploadPdf: (id: string, file: Blob) => req<Paper>('POST', `/api/papers/${id}/pdf`, file, true),
  fetchPdf: (id: string) => req<Paper>('POST', `/api/papers/${id}/fetch-pdf`),
  addProject: (name: string, parentId?: string) => req<Project>('POST', '/api/projects', { name, parentId }),
  updateProject: (id: string, changes: Partial<Project>) => req<Project>('PATCH', `/api/projects/${id}`, changes),
  deleteProject: (id: string) => req<{ ok: true }>('DELETE', `/api/projects/${id}`),
  importBib: (text: string, project?: string) =>
    req<{ added: number; merged: number }>('POST', `/api/import${project ? `?project=${project}` : ''}`, text, true),
};

// After a rebuild + server restart, reload so an old tab never runs stale code.
const currentBundle = () => document.querySelector<HTMLScriptElement>('script[src*="/assets/"]')?.getAttribute('src');
async function reloadIfUpdated() {
  const mine = currentBundle();
  if (!mine) return; // dev server
  const html = await fetch('/', { cache: 'no-store' }).then((r) => r.text(), () => '');
  const served = html.match(/src="([^"]*\/assets\/[^"]+\.js)"/)?.[1];
  if (served && served !== mine) location.reload();
}

// Library state, refreshed whenever the server reports a change (local edit or Dropbox sync).
export function useLibrary() {
  const [lib, setLib] = useState<Library | null>(null);
  const [error, setError] = useState('');
  const refresh = useCallback(() => {
    api.library().then((l) => { setLib(l); setError(''); }, (e) => setError(String(e.message ?? e)));
  }, []);
  useEffect(() => {
    refresh();
    const es = new EventSource('/api/events');
    es.onmessage = refresh;
    es.onerror = () => setError('Server not reachable — is `npm start` running?');
    es.onopen = () => { refresh(); reloadIfUpdated(); };
    return () => es.close();
  }, [refresh]);
  return { lib, error, refresh };
}

export const authorsShort = (a: string[]) => {
  const last = (s: string) => s.split(',')[0].trim();
  if (!a.length) return '';
  if (a.length === 1) return last(a[0]);
  if (a.length === 2) return `${last(a[0])} & ${last(a[1])}`;
  return `${last(a[0])} et al.`;
};

export const splitList = (s: string) => s.split(/[,;]/).map((x) => x.trim()).filter(Boolean);
