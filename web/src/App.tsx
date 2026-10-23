import { useEffect, useMemo, useRef, useState } from 'react';
import { api, useLibrary, type Paper, type Project } from './api.ts';
import Sidebar, { type View } from './components/Sidebar.tsx';
import PaperTable, { type SortKey } from './components/PaperTable.tsx';
import PaperDetail from './components/PaperDetail.tsx';
import { projectPath, subtreeIds } from '../../shared/projects.ts';
import { Icon } from './icons.tsx';
import TagsDialog from './components/TagsDialog.tsx';
import BibDialog from './components/BibDialog.tsx';
import CheckDialog from './components/CheckDialog.tsx';
import SettingsDialog from './components/SettingsDialog.tsx';

const VIEW_KEY = 'bibtrack.view';

// `inProject` holds the selected project plus its sub-projects.
const matches = (p: Paper, view: View, inProject: Set<string>) => {
  switch (view.kind) {
    case 'all': return true;
    case 'status': return p.status === view.status;
    case 'project': return p.projects.some((id) => inProject.has(id));
    case 'none': return !p.projects.length;
    case 'tag': return p.tags.includes(view.tag);
  }
};

const haystack = (p: Paper) =>
  [p.title, p.authors.join(' '), p.year, p.venue, p.abstract, p.notes, p.tags.join(' '), p.doi, p.arxivId, p.bibtexKey].join(' ').toLowerCase();

export default function App() {
  const { lib, error, refresh } = useLibrary();
  const [view, setViewState] = useState<View>(() => JSON.parse(localStorage.getItem(VIEW_KEY) ?? '{"kind":"all"}'));
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'addedAt', dir: -1 });
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState('');
  const [busy, setBusy] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [checkOpen, setCheckOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [bibFor, setBibFor] = useState<Project | null>(null);
  const [issueCount, setIssueCount] = useState(0);
  const [fulltext, setFulltext] = useState<Map<string, string>>(new Map());
  const [dropping, setDropping] = useState(false);
  const pdfRef = useRef<HTMLInputElement>(null);
  const [toastMsg, setToastMsg] = useState<{ msg: string; undo?: () => void } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<number>();

  const setView = (v: View) => { setViewState(v); localStorage.setItem(VIEW_KEY, JSON.stringify(v)); };
  const toast = (msg: string, undo?: () => void) => {
    setToastMsg({ msg, undo });
    clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastMsg(null), undo ? 7000 : 3000);
  };

  const project = view.kind === 'project' ? lib?.projects.find((p) => p.id === view.id) : undefined;
  // If the selected project was deleted (possibly on another machine), fall back to "all".
  useEffect(() => { if (lib && view.kind === 'project' && !project) setView({ kind: 'all' }); }, [lib, view, project]);

  // Full-text (PDF) matches come from the server, debounced; metadata matching stays instant in the browser.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) { setFulltext(new Map()); return; }
    const t = setTimeout(() => api.fulltextSearch(q).then((r) => setFulltext(new Map(r.map((x) => [x.id, x.snippet]))), () => {}), 250);
    return () => clearTimeout(t);
  }, [query]);

  // Number of real problems (duplicates, broken or missing metadata) for the sidebar badge.
  useEffect(() => {
    if (!lib) return;
    const t = setTimeout(() => api.check().then((r) => setIssueCount(r.filter((i) => ['duplicate', 'suspicious', 'missing'].includes(i.kind)).length), () => {}), 500);
    return () => clearTimeout(t);
  }, [lib]);

  const { papers, snippets } = useMemo(() => {
    if (!lib) return { papers: [], snippets: new Map<string, string>() };
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const inProject = view.kind === 'project' ? subtreeIds(lib.projects, view.id) : new Set<string>();
    const snippets = new Map<string, string>();
    const list = lib.papers.filter((p) => {
      if (!matches(p, view, inProject)) return false;
      if (!terms.length || terms.every((t) => haystack(p).includes(t))) return true;
      if (fulltext.has(p.id)) { snippets.set(p.id, fulltext.get(p.id)!); return true; }
      return false;
    });
    const val = (p: Paper) => (sort.key === 'authors' ? p.authors[0] ?? '' : String(p[sort.key] ?? '')).toLowerCase();
    return { papers: list.sort((a, b) => val(a).localeCompare(val(b)) * sort.dir), snippets };
  }, [lib, view, query, sort, fulltext]);

  const current = lib?.papers.find((p) => p.id === selected) ?? null;

  const remove = async (p: Paper) => {
    const idx = papers.findIndex((x) => x.id === p.id);
    setSelected(papers[idx + 1]?.id ?? papers[idx - 1]?.id ?? null);
    const removed = await api.deletePaper(p.id);
    refresh();
    toast(`Deleted “${p.title.slice(0, 50)}”`, async () => { await api.restorePaper(removed); refresh(); setSelected(p.id); });
  };

  const add = async () => {
    if (!adding.trim()) return;
    setBusy(true);
    try {
      const { meta } = await api.lookup({ input: adding });
      const { paper, duplicate } = await api.addPaper({ meta, projects: project ? [project.id] : [] });
      setAdding('');
      refresh();
      setSelected(paper.id);
      toast(duplicate ? 'Already in library — added to this project' : `Added “${paper.title.slice(0, 60)}”`);
    } catch (e) {
      toast(`Could not add: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  // Bare PDFs: the server reads their DOI / arXiv ID and fills in the metadata.
  const addPdfs = async (files: File[]) => {
    const pdfs = files.filter((f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
    if (!pdfs.length) return toast('Drop PDF files to add them');
    for (const f of pdfs) {
      toast(`Reading ${f.name}…`);
      try {
        const { paper, duplicate } = await api.addFromPdf(f, project?.id);
        setSelected(paper.id);
        toast(duplicate ? `Already in library: “${paper.title.slice(0, 50)}”` : `Added “${paper.title.slice(0, 60)}”`);
      } catch (e) {
        toast(`${f.name}: ${(e as Error).message}`);
      }
    }
    refresh();
  };

  const importBib = async (file?: File) => {
    if (!file) return;
    const r = await api.importBib(await file.text(), project?.id);
    refresh();
    toast(`Imported ${r.added} new, ${r.merged} already present`);
  };

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA'].includes(t.tagName)) {
        if (e.key === 'Escape') t.blur();
        return;
      }
      const i = papers.findIndex((p) => p.id === selected);
      if (document.querySelector('.modal')) return; // dialogs handle their own keys
      if (e.key === '/') { e.preventDefault(); searchRef.current?.focus(); }
      else if (e.key === 't') { e.preventDefault(); setTagsOpen(true); }
      else if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); setSelected(papers[Math.min(i + 1, papers.length - 1)]?.id ?? null); }
      else if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); setSelected(papers[Math.max(i - 1, 0)]?.id ?? null); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && current) remove(current);
      else if (e.key === 'o' && current?.pdfFile) window.open(`/pdf/${current.id}`, '_blank');
      else if (e.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!lib) return <div className="empty">{error || 'Loading…'}</div>;

  const exportUrl = `/api/export.bib?download=1${project ? `&project=${project.id}` : ''}`;
  const title = view.kind === 'project' && project ? projectPath(lib.projects, project.id)
    : view.kind === 'status' ? view.status[0].toUpperCase() + view.status.slice(1)
    : view.kind === 'tag' ? `#${view.tag}` : view.kind === 'none' ? 'No project' : 'All papers';

  return (
    <div className={`app ${current ? 'has-detail' : ''}`}>
      <Sidebar lib={lib} view={view} setView={(v) => { setView(v); setSelected(null); }} onOpenTags={() => setTagsOpen(true)}
        onOpenCheck={() => setCheckOpen(true)} onOpenSettings={() => setSettingsOpen(true)} onBib={setBibFor} issueCount={issueCount} />
      <main
        className={dropping ? 'dropping' : ''}
        onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDropping(true); } }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropping(false); }}
        onDrop={(e) => { e.preventDefault(); setDropping(false); addPdfs([...e.dataTransfer.files]); }}
      >
        <div className="toolbar">
          <h2>{title} <span className="muted">{papers.length}</span></h2>
          <label className="input-icon search">
            {Icon.search}
            <input ref={searchRef} placeholder="Search   /" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <form className="addbox" onSubmit={(e) => { e.preventDefault(); add(); }}>
            <label className="input-icon">
              {Icon.plus}
              <input placeholder="Add DOI, arXiv or URL" title={project ? `Adds to ${project.name}` : undefined} value={adding}
                onChange={(e) => setAdding(e.target.value)} disabled={busy} />
            </label>
            <button className="btn primary" disabled={busy || !adding.trim()}>{busy ? 'Adding…' : 'Add'}</button>
          </form>
          <div className="toolbar-actions">
            <button className="btn ghost icon" onClick={() => pdfRef.current?.click()} title="Add papers from PDF files (or drop PDFs on the list)">{Icon.filePlus}</button>
            {project
              ? <button className="btn ghost bib-btn" onClick={() => setBibFor(project)} title="BibTeX for this folder">{'{}'} .bib</button>
              : <a className="btn ghost icon" href={exportUrl} title="Export BibTeX for the whole library">{Icon.download}</a>}
            <button className="btn ghost" onClick={() => importRef.current?.click()} title="Import a .bib file (e.g. exported from Zotero)">{Icon.upload}</button>
          </div>
          <input ref={importRef} type="file" accept=".bib,text/plain" hidden onChange={(e) => { importBib(e.target.files?.[0]); e.target.value = ''; }} />
          <input ref={pdfRef} type="file" accept="application/pdf" multiple hidden onChange={(e) => { addPdfs([...(e.target.files ?? [])]); e.target.value = ''; }} />
        </div>
        {error && <div className="banner error">{error}</div>}
        <PaperTable papers={papers} projects={lib.projects} selected={selected} onSelect={setSelected} sort={sort} setSort={setSort} snippets={snippets} />
        {dropping && <div className="drop-hint">Drop PDFs to add them{project ? ` to ${project.name}` : ''}</div>}
      </main>
      {current && <PaperDetail key={current.id} paper={current} projects={lib.projects} onDelete={remove} toast={toast} />}
      {tagsOpen && (
        <TagsDialog lib={lib} active={view.kind === 'tag' ? view.tag : undefined} onClose={() => setTagsOpen(false)}
          onPick={(tag) => { setView(tag ? { kind: 'tag', tag } : { kind: 'all' }); setSelected(null); }} />
      )}
      {bibFor && <BibDialog lib={lib} project={bibFor} onClose={() => setBibFor(null)} toast={toast} />}
      {checkOpen && <CheckDialog lib={lib} onClose={() => setCheckOpen(false)} toast={toast}
        onOpen={(id) => { setView({ kind: 'all' }); setQuery(''); setSelected(id); }} />}
      {settingsOpen && <SettingsDialog lib={lib} onClose={() => setSettingsOpen(false)} toast={toast} />}
      {toastMsg && (
        <div className="toast">
          {toastMsg.msg}
          {toastMsg.undo && <button onClick={() => { toastMsg.undo!(); setToastMsg(null); }}>Undo</button>}
        </div>
      )}
    </div>
  );
}
