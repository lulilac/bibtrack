import { useEffect, useRef, useState } from 'react';
import { api, splitList, type Paper, type Project } from '../api.ts';
import ProjectPicker from './ProjectPicker.tsx';
import { Icon } from '../icons.tsx';

// Text field that keeps its own value while focused and saves on blur (or debounced, for notes).
function Field({ label, value, onSave, multiline, rows = 2, debounce, className }: {
  label: string;
  className?: string;
  value: string;
  onSave: (v: string) => void;
  multiline?: boolean;
  rows?: number;
  debounce?: number;
}) {
  const [v, setV] = useState(value);
  const focused = useRef(false);
  const timer = useRef<number>();
  useEffect(() => { if (!focused.current) setV(value); }, [value]);
  const commit = (x: string) => { if (x !== value) onSave(x); };
  const props = {
    value: v,
    onFocus: () => (focused.current = true),
    onBlur: () => { focused.current = false; clearTimeout(timer.current); commit(v); },
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setV(e.target.value);
      if (debounce) {
        clearTimeout(timer.current);
        const x = e.target.value;
        timer.current = window.setTimeout(() => commit(x), debounce);
      }
    },
  };
  return (
    <label className={className}>
      {label}
      {multiline ? <textarea rows={rows} {...props} /> : <input {...props} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />}
    </label>
  );
}

export default function PaperDetail({ paper, projects, onDelete, toast }: {
  paper: Paper;
  projects: Project[];
  onDelete: (p: Paper) => void;
  toast: (msg: string) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const save = (changes: Partial<Paper>) => api.updatePaper(paper.id, changes).catch((e) => toast(e.message));

  const upload = async (file?: File) => {
    if (!file) return;
    try { await api.uploadPdf(paper.id, file); toast('PDF attached'); } catch (e) { toast((e as Error).message); }
  };

  const copyBib = async () => {
    const text = await (await fetch(`/api/export.bib?ids=${paper.id}`)).text();
    await navigator.clipboard.writeText(text.trim());
    toast(`Copied \\cite{${paper.bibtexKey}}`);
  };

  return (
    <aside
      className={`detail ${dragging ? 'dragging' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); upload(e.dataTransfer.files[0]); }}
    >
      <div className="actions">
        {paper.pdfFile && <a className="btn primary" href={`/pdf/${paper.id}`} target="_blank">{Icon.file}Open PDF</a>}
        {!paper.pdfFile && paper.pdfUrl && (
          <button className="btn" onClick={() => api.fetchPdf(paper.id).then(() => toast('PDF downloaded'), (e) => toast(e.message))}>{Icon.download}Get PDF</button>
        )}
        {!paper.pdfFile && <button className="btn" onClick={() => fileInput.current?.click()}>{Icon.paperclip}Attach PDF</button>}
        {paper.url && <a className="btn" href={paper.url} target="_blank" rel="noreferrer" title="Open web page">{Icon.link}Page</a>}
        <button className="btn" onClick={copyBib} title="Copy BibTeX">{Icon.copy}BibTeX</button>
        <button className="btn ghost danger icon" onClick={() => onDelete(paper)} title="Delete (Del)" style={{ marginLeft: 'auto' }}>{Icon.trash}</button>
        <input ref={fileInput} type="file" accept="application/pdf" hidden onChange={(e) => upload(e.target.files?.[0])} />
      </div>

      <div className="status-row">
        <div className="segmented">
          {(['unread', 'reading', 'read'] as const).map((s) => (
            <button key={s} className={`seg ${paper.status === s ? 'on' : ''}`} onClick={() => save({ status: s })}>{s}</button>
          ))}
        </div>
        <span className="stars">
          {[1, 2, 3, 4, 5].map((n) => (
            <span key={n} className={n <= paper.rating ? 'on' : ''} onClick={() => save({ rating: n === paper.rating ? 0 : n })}>★</span>
          ))}
        </span>
      </div>

      <Field label="" className="title-field" value={paper.title} onSave={(title) => save({ title })} multiline rows={3} />
      <Field label="Authors (separated by ;)" value={paper.authors.join('; ')}
        onSave={(v) => save({ authors: v.split(/\s*;\s*/).filter(Boolean) })} />
      <div className="row">
        <Field label="Year" value={paper.year} onSave={(year) => save({ year })} />
        <Field label="Venue" value={paper.venue} onSave={(venue) => save({ venue })} />
      </div>
      <label>Projects</label>
      <ProjectPicker projects={projects} selected={paper.projects} onChange={(ids) => save({ projects: ids })} allowCreate />
      <Field label="Tags (comma separated)" value={paper.tags.join(', ')} onSave={(v) => save({ tags: splitList(v) })} />
      <Field label="Notes" className="notes-field" value={paper.notes} onSave={(notes) => save({ notes })} multiline rows={10} debounce={800} />

      <details>
        <summary>Abstract</summary>
        <Field label="" value={paper.abstract} onSave={(abstract) => save({ abstract })} multiline rows={8} />
      </details>
      <details>
        <summary>Identifiers & BibTeX</summary>
        <div className="row">
          <Field label="BibTeX key" value={paper.bibtexKey} onSave={(bibtexKey) => save({ bibtexKey })} />
          <Field label="Type" value={paper.type} onSave={(type) => save({ type })} />
        </div>
        <Field label="DOI" value={paper.doi} onSave={(doi) => save({ doi })} />
        <Field label="arXiv ID" value={paper.arxivId} onSave={(arxivId) => save({ arxivId })} />
        <Field label="URL" value={paper.url} onSave={(url) => save({ url })} />
        <Field label="PDF URL" value={paper.pdfUrl} onSave={(pdfUrl) => save({ pdfUrl })} />
      </details>
      <p className="muted small">Added {new Date(paper.addedAt).toLocaleString()} · drop a PDF here to attach it</p>
    </aside>
  );
}
