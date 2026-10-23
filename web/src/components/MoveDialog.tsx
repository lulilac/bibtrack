import { useState } from 'react';
import { api, type Library, type Project } from '../api.ts';
import { projectTree, subtreeIds } from '../../../shared/projects.ts';
import Modal from './Modal.tsx';

// Pick a new parent for a folder (or top level). The folder itself and its sub-folders can't be chosen.
export default function MoveDialog({ lib, project, onClose }: { lib: Library; project: Project; onClose: () => void }) {
  const [error, setError] = useState('');
  const own = subtreeIds(lib.projects, project.id);
  const move = (parentId: string) =>
    api.updateProject(project.id, { parentId }).then(onClose, (e) => setError((e as Error).message));
  return (
    <Modal title={`Move “${project.name}” to…`} onClose={onClose}>
      <ul className="modal-list">
        <li className={!project.parentId ? 'active' : ''} onClick={() => move('')}>
          <span className="grow">Top level</span>
        </li>
        {projectTree(lib.projects).map(({ project: p, depth }) => {
          const disabled = own.has(p.id);
          return (
            <li key={p.id} className={`${disabled ? 'disabled' : ''} ${p.id === project.parentId ? 'active' : ''}`}
              style={{ paddingLeft: 10 + depth * 16 }} onClick={() => !disabled && move(p.id)}>
              <span className="dot" style={{ background: p.color }} />
              <span className="grow">{p.name}</span>
            </li>
          );
        })}
      </ul>
      {error && <div className="error small">{error}</div>}
    </Modal>
  );
}
