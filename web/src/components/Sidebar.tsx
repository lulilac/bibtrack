import { useState } from 'react';
import { api, type Library, type Project } from '../api.ts';
import MoveDialog from './MoveDialog.tsx';
import { Icon } from '../icons.tsx';
import { ThemeSwitch } from '../theme.tsx';
import { projectPath, projectTree, subtreeIds } from '../../../shared/projects.ts';

const FolderIcon = ({ color, open }: { color: string; open: boolean }) => (
  <svg className="folder" width="16" height="16" viewBox="0 0 16 16" aria-hidden>
    <path d={open ? 'M1.5 3.5h4l1.5 1.5h7v1.5H4L1.5 13z' : 'M1.5 3.5h4l1.5 1.5h7.5v8h-13z'} fill={color} fillOpacity=".3" stroke={color} strokeWidth="1.2" strokeLinejoin="round" />
    {open && <path d="M4 6.5h11l-2.5 6.5h-11z" fill={color} fillOpacity=".55" stroke={color} strokeWidth="1.2" strokeLinejoin="round" />}
  </svg>
);

export type View =
  | { kind: 'all' }
  | { kind: 'status'; status: 'unread' | 'reading' | 'read' }
  | { kind: 'project'; id: string }
  | { kind: 'none' }
  | { kind: 'tag'; tag: string };

export const sameView = (a: View, b: View) => JSON.stringify(a) === JSON.stringify(b);

const COLLAPSED_KEY = 'bibtrack.collapsed';

export default function Sidebar({ lib, view, setView, onOpenTags }: {
  lib: Library;
  view: View;
  setView: (v: View) => void;
  onOpenTags: () => void;
}) {
  const [newName, setNewName] = useState('');
  const [moving, setMoving] = useState<Project | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [collapsed, setCollapsedState] = useState<Set<string>>(() => new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]')));
  const count = (f: (p: Library['papers'][number]) => boolean) => lib.papers.filter(f).length;
  const tagCount = new Set(lib.papers.flatMap((p) => p.tags)).size;
  const tree = projectTree(lib.projects);
  const hasChildren = new Set(lib.projects.map((p) => p.parentId).filter(Boolean));

  const toggle = (id: string) => {
    const next = new Set(collapsed);
    next.has(id) ? next.delete(id) : next.add(id);
    setCollapsedState(next);
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
  };

  // Hide rows whose ancestor is collapsed.
  const byId = new Map(lib.projects.map((p) => [p.id, p]));
  const hidden = (id: string) => {
    for (let p = byId.get(byId.get(id)?.parentId ?? ''); p; p = byId.get(p.parentId ?? '')) if (collapsed.has(p.id)) return true;
    return false;
  };

  const Item = ({ v, label, n, icon }: { v: View; label: string; n: number; icon: keyof typeof Icon }) => (
    <li className={sameView(v, view) ? 'active' : ''} onClick={() => setView(v)}>
      <span className="nav-icon">{Icon[icon]}</span>
      <span className="grow">{label}</span>
      <span className="count">{n}</span>
    </li>
  );

  const addProject = async (parentId?: string) => {
    const name = parentId ? prompt('Name of the new sub-folder:')?.trim() : newName.trim();
    if (!name) return;
    const p = await api.addProject(name, parentId);
    if (!parentId) setNewName('');
    else if (collapsed.has(parentId)) toggle(parentId);
    setView({ kind: 'project', id: p.id });
  };

  return (
    <nav className="sidebar">
      <div className="brand"><span className="brand-mark">b</span>bibtrack</div>
      <ul>
        <Item v={{ kind: 'all' }} label="All papers" n={lib.papers.length} icon="library" />
        <Item v={{ kind: 'status', status: 'unread' }} label="Unread" n={count((p) => p.status === 'unread')} icon="inbox" />
        <Item v={{ kind: 'status', status: 'reading' }} label="Reading" n={count((p) => p.status === 'reading')} icon="book" />
        <Item v={{ kind: 'none' }} label="No project" n={count((p) => !p.projects.length)} icon="folderOff" />
        <li className={view.kind === 'tag' ? 'active' : ''} onClick={onOpenTags} title="Search tags (t)">
          <span className="nav-icon">{Icon.tag}</span>
          <span className="grow">{view.kind === 'tag' ? `#${view.tag}` : 'Tags'}</span>
          <span className="count">{tagCount}</span>
        </li>
      </ul>
      <h4>Projects</h4>
      <ul>
        {tree.filter(({ project: p }) => !hidden(p.id)).map(({ project: p, depth }) => {
          const ids = subtreeIds(lib.projects, p.id);
          const n = count((x) => x.projects.some((id) => ids.has(id)));
          const indent = { paddingLeft: 8 + depth * 16 };
          return editing === p.id ? (
            <li key={p.id} style={indent}>
              <input
                autoFocus
                defaultValue={p.name}
                onBlur={(e) => { api.updateProject(p.id, { name: e.target.value }); setEditing(null); }}
                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setEditing(null); }}
              />
            </li>
          ) : (
            <div key={p.id} className="proj" onDoubleClick={() => setEditing(p.id)}>
              <li className={`${sameView(view, { kind: 'project', id: p.id }) ? 'active' : ''} ${n ? '' : 'empty-proj'}`}
                onClick={() => setView({ kind: 'project', id: p.id })}>
                {Array.from({ length: depth }, (_, i) => <span key={i} className="guide" />)}
                <span className={`twisty ${hasChildren.has(p.id) ? '' : 'leaf'}`}
                  onClick={(e) => { e.stopPropagation(); toggle(p.id); }}>
                  {collapsed.has(p.id) ? '▸' : '▾'}
                </span>
                <FolderIcon color={p.color} open={hasChildren.has(p.id) && !collapsed.has(p.id)} />
                <span className="grow name" title={projectPath(lib.projects, p.id)}>{p.name}</span>
                {n > 0 && <span className="count">{n}</span>}
              </li>
              <span className="proj-actions">
                <button title="New sub-folder" onClick={() => addProject(p.id)}>+</button>
                <button title="Rename" onClick={() => setEditing(p.id)}>✎</button>
                <button title="Move to another folder" onClick={() => setMoving(p)}>↳</button>
                <button
                  title="Delete project and its sub-folders (papers are kept)"
                  onClick={() => {
                    const subs = ids.size - 1;
                    if (confirm(`Delete project "${p.name}"${subs ? ` and its ${subs} sub-folder(s)` : ''}? Papers stay in the library.`)) {
                      api.deleteProject(p.id);
                      if (view.kind === 'project' && ids.has(view.id)) setView({ kind: 'all' });
                    }
                  }}
                >×</button>
              </span>
            </div>
          );
        })}
        <li className="new">
          <input placeholder="+ New project" value={newName} onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addProject()} />
        </li>
      </ul>
      {moving && <MoveDialog lib={lib} project={moving} onClose={() => setMoving(null)} />}
      <div className="sidebar-foot">
        <a href="/bookmarklet">Bookmarklet</a>
        <ThemeSwitch />
      </div>
    </nav>
  );
}
