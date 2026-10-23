import { useState } from 'react';
import { api, type Project } from '../api.ts';
import { projectPath, projectTree } from '../../../shared/projects.ts';

// Selected projects as removable chips, plus a filterable folder tree to add more.
export default function ProjectPicker({ projects, selected, onChange, allowCreate }: {
  projects: Project[];
  selected: string[];
  onChange: (ids: string[]) => void;
  allowCreate?: boolean;
}) {
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState(false);
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  const byId = new Map(projects.map((p) => [p.id, p]));
  const f = filter.trim().toLowerCase();
  const rows = projectTree(projects).filter(({ project }) => !f || projectPath(projects, project.id).toLowerCase().includes(f));

  const create = async () => {
    if (!filter.trim()) return;
    const p = await api.addProject(filter.trim());
    setFilter('');
    onChange([...selected, p.id]);
  };

  return (
    <div className="picker">
      <div className="chips">
        {selected.map((id) => byId.get(id)).filter(Boolean).map((p) => (
          <button key={p!.id} type="button" className="chip on" style={{ '--c': p!.color } as React.CSSProperties}
            title="Remove" onClick={() => toggle(p!.id)}>
            {projectPath(projects, p!.id)} ×
          </button>
        ))}
        <input
          className="chip-input"
          placeholder={projects.length ? '+ add to folder…' : allowCreate ? '+ new project' : 'no projects yet'}
          value={filter}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onChange={(e) => { setFilter(e.target.value); setOpen(true); }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            e.stopPropagation();
            if (rows.length && f) { toggle(rows[0].project.id); setFilter(''); }
            else if (allowCreate) create();
          }}
        />
      </div>
      {open && (rows.length > 0 || (allowCreate && f)) && (
        <ul className="tree-list" onMouseDown={(e) => e.preventDefault()}>
          {rows.map(({ project: p, depth }) => (
            <li key={p.id} style={{ paddingLeft: 6 + (f ? 0 : depth * 14) }} onClick={() => { toggle(p.id); setFilter(''); }}>
              <input type="checkbox" readOnly checked={selected.includes(p.id)} />
              <span className="dot" style={{ background: p.color }} />
              {f ? projectPath(projects, p.id) : p.name}
            </li>
          ))}
          {allowCreate && f && !rows.some(({ project }) => project.name.toLowerCase() === f) && (
            <li className="create" onClick={create}>+ Create project “{filter.trim()}”</li>
          )}
        </ul>
      )}
    </div>
  );
}
