import { useEffect, useRef, useState } from 'react';
import type { Library } from '../api.ts';
import { Icon } from '../icons.tsx';
import Modal from './Modal.tsx';

// Searchable tag list: type to filter, ↑/↓ + Enter or click to show that tag's papers.
export default function TagsDialog({ lib, active, onPick, onClose }: {
  lib: Library;
  active?: string;
  onPick: (tag: string | null) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const counts = new Map<string, number>();
  for (const p of lib.papers) for (const t of p.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  const tags = [...counts].filter(([t]) => t.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  useEffect(() => setCursor(0), [q]);
  useEffect(() => { listRef.current?.children[cursor]?.scrollIntoView({ block: 'nearest' }); }, [cursor]);

  const pick = (t: string | null) => { onPick(t); onClose(); };

  return (
    <Modal title="Tags" onClose={onClose}>
      <label className="input-icon">
        {Icon.search}
        <input
          autoFocus
          placeholder={`Search ${counts.size} tags…`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, tags.length - 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
            if (e.key === 'Enter' && tags[cursor]) pick(tags[cursor][0]);
          }}
        />
      </label>
      <ul className="modal-list" ref={listRef}>
        {tags.map(([t, n], i) => (
          <li key={t} className={`${i === cursor ? 'cursor' : ''} ${t === active ? 'active' : ''}`}
            onMouseEnter={() => setCursor(i)} onClick={() => pick(t)}>
            <span className="hash">#</span>
            <span className="grow">{t}</span>
            <span className="count">{n}</span>
          </li>
        ))}
        {!tags.length && <li className="none">{counts.size ? 'No matching tags' : 'No tags yet — add them in a paper’s details.'}</li>}
      </ul>
      {active && <button className="btn ghost modal-foot" onClick={() => pick(null)}>Clear tag filter (#{active})</button>}
    </Modal>
  );
}
