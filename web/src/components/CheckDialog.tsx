import { useEffect, useState } from 'react';
import { api, authorsShort, type Issue, type Library, type Paper } from '../api.ts';
import Modal from './Modal.tsx';

const LABEL: Record<Issue['kind'], string> = {
  duplicate: 'Possible duplicates',
  suspicious: 'Suspicious values',
  missing: 'Missing fields',
  'no-identifier': 'No DOI / arXiv ID',
  'no-pdf': 'No PDF',
};
const ORDER: Issue['kind'][] = ['duplicate', 'suspicious', 'missing', 'no-identifier', 'no-pdf'];

// JabRef-style integrity check: duplicates (with merge), broken metadata (with a metadata finder).
export default function CheckDialog({ lib, onOpen, onClose, toast }: {
  lib: Library;
  onOpen: (id: string) => void;
  onClose: () => void;
  toast: (msg: string) => void;
}) {
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [kind, setKind] = useState<Issue['kind']>('duplicate');
  const reload = () => api.check().then(setIssues);
  useEffect(() => { reload(); }, [lib]);
  const byId = new Map(lib.papers.map((p) => [p.id, p]));
  const count = (k: Issue['kind']) => issues?.filter((i) => i.kind === k).length ?? 0;
  const shown = issues?.filter((i) => i.kind === kind) ?? [];

  const merge = async (keep: Paper, other: Paper) => {
    await api.mergePapers(keep.id, other.id);
    toast(`Merged into “${keep.title.slice(0, 50)}”`);
  };

  const Row = ({ p, extra }: { p?: Paper; extra?: React.ReactNode }) => p ? (
    <div className="issue-paper">
      <button className="link" onClick={() => { onOpen(p.id); onClose(); }} title="Open">{p.title || '(untitled)'}</button>
      <span className="muted small">{[authorsShort(p.authors), p.year, p.venue].filter(Boolean).join(' · ')}{p.pdfFile ? ' · PDF' : ''}</span>
      {extra}
    </div>
  ) : null;

  return (
    <Modal title="Check library" onClose={onClose} wide>
      <div className="segmented wrap">
        {ORDER.map((k) => (
          <button key={k} className={`seg ${kind === k ? 'on' : ''}`} onClick={() => setKind(k)}>{LABEL[k]} · {count(k)}</button>
        ))}
      </div>
      <ul className="modal-list issues">
        {!issues && <li className="none">Checking…</li>}
        {issues && !shown.length && <li className="none">Nothing to fix here ✓</li>}
        {shown.map((i) => {
          if (i.kind === 'duplicate') {
            const [a, b] = i.ids.map((id) => byId.get(id)!);
            return (
              <li key={i.ids.join()} className="issue">
                <span className="muted small">{i.reason}</span>
                <Row p={a} extra={b && <button className="btn" onClick={() => merge(a, b)}>Keep this, merge other in</button>} />
                <Row p={b} extra={a && <button className="btn" onClick={() => merge(b, a)}>Keep this, merge other in</button>} />
              </li>
            );
          }
          const p = byId.get(i.id);
          const what = i.kind === 'missing' ? `missing ${i.fields.join(', ')}` : i.kind === 'suspicious' ? `${i.field}: “${i.value.slice(0, 60)}”` : '';
          return (
            <li key={i.kind + i.id + ('field' in i ? i.field : '')} className="issue">
              <Row p={p} extra={what && <span className="issue-what small">{what}</span>} />
            </li>
          );
        })}
      </ul>
      {kind !== 'duplicate' && kind !== 'no-pdf' && shown.length > 0 && (
        <p className="muted small modal-text">Open a paper and use <b>Find metadata</b> to fix it from its PDF or Crossref.</p>
      )}
    </Modal>
  );
}
