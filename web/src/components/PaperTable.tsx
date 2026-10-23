import { useEffect, useRef } from 'react';
import { authorsShort, type Paper, type Project } from '../api.ts';

export type SortKey = 'title' | 'authors' | 'year' | 'venue' | 'status' | 'addedAt';

export default function PaperTable({ papers, projects, selected, onSelect, sort, setSort, snippets }: {
  papers: Paper[];
  projects: Project[];
  selected: string | null;
  onSelect: (id: string) => void;
  sort: { key: SortKey; dir: 1 | -1 };
  setSort: (s: { key: SortKey; dir: 1 | -1 }) => void;
  snippets?: Map<string, string>; // full-text matches: paper id -> text around the match
}) {
  const body = useRef<HTMLTableSectionElement>(null);
  const projById = new Map(projects.map((p) => [p.id, p]));

  useEffect(() => {
    body.current?.querySelector('tr.sel')?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const Th = ({ k, label, className }: { k: SortKey; label: string; className?: string }) => (
    <th className={className} onClick={() => setSort({ key: k, dir: sort.key === k ? (-sort.dir as 1 | -1) : k === 'addedAt' || k === 'year' ? -1 : 1 })}>
      {label}{sort.key === k ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
    </th>
  );

  if (!papers.length) return <div className="empty">No papers here yet. Paste a DOI / arXiv ID / URL above, or use the bookmarklet.</div>;

  return (
    <div className="table-wrap">
      <table className="papers">
        <thead>
          <tr>
            <Th k="status" label="" className="c-status" />
            <Th k="title" label="Title" />
            <Th k="authors" label="Authors" className="c-authors" />
            <Th k="year" label="Year" className="c-year" />
            <Th k="venue" label="Venue" className="c-venue" />
            <Th k="addedAt" label="Added" className="c-added" />
          </tr>
        </thead>
        <tbody ref={body}>
          {papers.map((p) => (
            <tr key={p.id} className={p.id === selected ? 'sel' : ''} onClick={() => onSelect(p.id)}>
              <td className={`c-status st-${p.status}`} title={p.status}><span className="st" /></td>
              <td className="c-title">
                <span className="t">{p.title || <em>(untitled)</em>}</span>
                {p.pdfFile && <span className="pdf-badge" title="PDF saved">PDF</span>}
                {p.projects.map((id) => projById.get(id)).filter(Boolean).map((pr) => (
                  <span key={pr!.id} className="dot" title={pr!.name} style={{ background: pr!.color }} />
                ))}
                {snippets?.has(p.id) && (
                  <span className="snippet"><span className="in-pdf">in PDF</span>{snippets.get(p.id)}</span>
                )}
              </td>
              <td className="c-authors">{authorsShort(p.authors)}</td>
              <td className="c-year">{p.year}</td>
              <td className="c-venue">{p.venue}</td>
              <td className="c-added">{p.addedAt.slice(0, 10)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
