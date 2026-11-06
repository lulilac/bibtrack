import { useEffect, useMemo, useRef, useState } from 'react';
import { api, splitList, useLibrary, type Capture, type Paper } from '../api.ts';
import ProjectPicker from './ProjectPicker.tsx';
import { KINDS, KIND_LABEL, kindOf, type Kind } from '../../../shared/kinds.ts';

const LAST_PROJECTS = 'bibtrack.lastProjects';

// Inside the toolbar extension we are an iframe: ask the extension popup to close itself.
const close = () => (window.parent !== window ? window.parent.postMessage('bibtrack:close', '*') : window.close());

// Tell the embedder we really loaded. Behind a password a frame can come back as the browser's
// own 401 page, which looks identical from the outside; this message is the difference, and the
// add-on falls back to its own window when it never arrives.
const announce = () => { if (window.parent !== window) window.parent.postMessage('bibtrack:ready', '*'); };

function readCapture(): Capture {
  try {
    return JSON.parse(decodeURIComponent(location.hash.slice(1)));
  } catch {
    return {};
  }
}

// Popup opened by the bookmarklet: shows the captured metadata, enriched by the server.
export default function AddPopup() {
  const { lib } = useLibrary();
  const capture = useMemo(readCapture, []);
  const [meta, setMeta] = useState<Partial<Paper>>({ ...capture, authors: capture.authors ?? [] });
  const [looking, setLooking] = useState(true);
  const [duplicate, setDuplicate] = useState<Paper | null>(null);
  const [projects, setProjects] = useState<string[]>(() => JSON.parse(localStorage.getItem(LAST_PROJECTS) ?? '[]'));
  const [tags, setTags] = useState('');
  const [fetchPdf, setFetchPdf] = useState(true);
  const kind = kindOf(meta);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | string>('idle');
  const saveRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    api.lookup({ capture }).then(
      ({ meta: m, duplicate: d }) => {
        // Keep anything the user already edited; fill the rest from the lookup.
        setMeta((cur) => ({ ...m, notes: cur.notes ?? m.notes, ...(cur.kind ? { kind: cur.kind } : {}) }));
        setDuplicate(d);
        if (d) setProjects((p) => [...new Set([...p, ...d.projects])]);
      },
      () => {},
    ).finally(() => setLooking(false));
    announce();
    saveRef.current?.focus();
  }, [capture]);

  // Drop projects that no longer exist
  const validProjects = projects.filter((id) => lib?.projects.some((p) => p.id === id));

  const save = async () => {
    setState('saving');
    try {
      localStorage.setItem(LAST_PROJECTS, JSON.stringify(validProjects));
      await api.addPaper({ meta, projects: validProjects, tags: splitList(tags), fetchPdf: fetchPdf && kind === 'paper' });
      setState('saved');
      setTimeout(close, 700);
    } catch (e) {
      setState(`Error: ${(e as Error).message}`);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      const inTextarea = (e.target as HTMLElement).tagName === 'TEXTAREA';
      if (e.key === 'Enter' && (!inTextarea || e.ctrlKey)) { e.preventDefault(); save(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const set = (k: keyof Paper) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setMeta({ ...meta, [k]: k === 'authors' ? e.target.value.split(/\s*;\s*/) : e.target.value });

  return (
    <div className="popup">
      <header>
        <span className="brand-mark">b</span>Save to bibtrack
        {looking && <span className="muted"> · looking up metadata…</span>}
      </header>
      {duplicate && (
        <div className="banner saved-already">
          <strong>Already saved.</strong> Saving again just files it into the folders you pick below.
        </div>
      )}
      <div className="kind-pick">
        {/* Guessed from the page; one click to correct it. */}
        {KINDS.map((k) => (
          <button key={k} type="button" className={`seg ${kind === k ? 'on' : ''}`} onClick={() => setMeta({ ...meta, kind: k })}>
            {KIND_LABEL[k]}
          </button>
        ))}
      </div>
      <label>Title<textarea rows={2} value={meta.title ?? ''} onChange={set('title')} /></label>
      <label><span>Authors <span className="muted">(separated by ;)</span></span>
        <input value={(meta.authors ?? []).join('; ')} onChange={set('authors')} /></label>
      <div className="row">
        <label>Year<input value={meta.year ?? ''} onChange={set('year')} /></label>
        <label className="grow">{kind === 'paper' ? 'Venue' : 'Source'}<input value={meta.venue ?? ''} onChange={set('venue')} /></label>
      </div>
      {kind === 'paper' && (
        <div className="row">
          <label className="grow">DOI<input value={meta.doi ?? ''} onChange={set('doi')} /></label>
          <label>arXiv<input value={meta.arxivId ?? ''} onChange={set('arxivId')} /></label>
        </div>
      )}
      <label>Projects</label>
      {lib && <ProjectPicker projects={lib.projects} selected={validProjects} onChange={setProjects} allowCreate />}
      <label><span>Tags <span className="muted">(comma separated)</span></span><input value={tags} onChange={(e) => setTags(e.target.value)} /></label>
      <label>Notes<textarea rows={3} value={meta.notes ?? ''} onChange={set('notes')} /></label>
      {kind === 'paper' && (
        <label className="check">
          <input type="checkbox" checked={fetchPdf} onChange={(e) => setFetchPdf(e.target.checked)} disabled={!meta.pdfUrl} />
          Download PDF {meta.pdfUrl ? <span className="muted">({new URL(meta.pdfUrl, location.href).host})</span> : <span className="muted">(no PDF link found)</span>}
        </label>
      )}
      <footer>
        <span className="muted">{state.startsWith('Error') ? <span className="error">{state}</span> : 'Enter to save · Esc to close'}</span>
        <button ref={saveRef} className="primary" onClick={save} disabled={state === 'saving' || state === 'saved' || !meta.title}>
          {state === 'saved' ? 'Saved ✓' : state === 'saving' ? 'Saving…' : 'Save'}
        </button>
      </footer>
    </div>
  );
}
