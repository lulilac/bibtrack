import { useEffect, useState } from 'react';
import { api, type Library, type Project } from '../api.ts';
import { projectPath } from '../../../shared/projects.ts';
import Modal from './Modal.tsx';

// BibTeX for one folder (incl. sub-folders): copy, download, or use the auto-synced file in Dropbox.
export default function BibDialog({ lib, project, onClose, toast }: {
  lib: Library;
  project: Project;
  onClose: () => void;
  toast: (msg: string) => void;
}) {
  const [bib, setBib] = useState('');
  const [bibDir, setBibDir] = useState('');
  useEffect(() => {
    api.exportBib({ project: project.id }).then(setBib);
    api.info().then((i) => setBibDir(i.bibDir), () => {});
  }, [project.id]);
  const path = projectPath(lib.projects, project.id);
  const n = (bib.match(/^@/gm) ?? []).length;
  const fileName = `${path.replace(/ › /g, ' - ').replace(/[\\/:*?"<>|]+/g, '_')}.bib`;
  return (
    <Modal title={`BibTeX · ${path}`} onClose={onClose} wide>
      <p className="muted small modal-text">{n} entries, including sub-folders.</p>
      <textarea className="bib-preview" readOnly value={bib} rows={12} />
      <div className="modal-actions">
        <button className="btn primary" disabled={!n}
          onClick={() => navigator.clipboard.writeText(bib).then(() => { toast(`Copied ${n} BibTeX entries`); onClose(); })}>
          Copy to clipboard
        </button>
        <a className="btn" href={`/api/export.bib?download=1&project=${project.id}`} onClick={onClose}>Download .bib</a>
      </div>
      {bibDir && (
        <p className="muted small modal-text">
          Always up to date in Dropbox: <code>{bibDir}/{fileName}</code> — point your LaTeX project at it.
        </p>
      )}
    </Modal>
  );
}
