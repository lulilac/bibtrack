import { useEffect, useMemo, useRef, useState } from 'react';
import { api, useLibrary, type Paper } from './api.ts';
import Sidebar, { type View } from './components/Sidebar.tsx';
import PaperTable, { type SortKey } from './components/PaperTable.tsx';
import PaperDetail from './components/PaperDetail.tsx';
import { projectPath, subtreeIds } from '../../shared/projects.ts';
import { Icon } from './icons.tsx';
import TagsDialog from './components/TagsDialog.tsx';

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

  const papers = useMemo(() => {
    if (!lib) return [];
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const inProject = view.kind === 'project' ? subtreeIds(lib.projects, view.id) : new Set<string>();
    const list = lib.papers.filter((p) => matches(p, view, inProject) && (!terms.length || terms.every((t) => haystack(p).includes(t))));
    const val = (p: Paper) => (sort.key === 'authors' ? p.authors[0] ?? '' : String(p[sort.key] ?? '')).toLowerCase();
    return list.sort((a, b) => val(a).localeCompare(val(b)) * sort.dir);
  }, [lib, view, query, sort]);

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
      <Sidebar lib={lib} view={view} setView={(v) => { setView(v); setSelected(null); }} onOpenTags={() => setTagsOpen(true)} />
      <main>
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
            <a className="btn ghost icon" href={exportUrl} title="Export BibTeX for this project (or the whole library)">{Icon.download}</a>
            <button className="btn ghost" onClick={() => importRef.current?.click()} title="Import a .bib file (e.g. exported from Zotero)">{Icon.upload}</button>
          </div>
          <input ref={importRef} type="file" accept=".bib,text/plain" hidden onChange={(e) => { importBib(e.target.files?.[0]); e.target.value = ''; }} />
        </div>
        {error && <div className="banner error">{error}</div>}
        <PaperTable papers={papers} projects={lib.projects} selected={selected} onSelect={setSelected} sort={sort} setSort={setSort} />
      </main>
      {current && <PaperDetail key={current.id} paper={current} projects={lib.projects} onDelete={remove} toast={toast} />}
      {tagsOpen && (
        <TagsDialog lib={lib} active={view.kind === 'tag' ? view.tag : undefined} onClose={() => setTagsOpen(false)}
          onPick={(tag) => { setView(tag ? { kind: 'tag', tag } : { kind: 'all' }); setSelected(null); }} />
      )}
      {toastMsg && (
        <div className="toast">
          {toastMsg.msg}
          {toastMsg.undo && <button onClick={() => { toastMsg.undo!(); setToastMsg(null); }}>Undo</button>}
        </div>
      )}
    </div>
  );
}
