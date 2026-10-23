import { useEffect, useState } from 'react';
import { api, type Library } from '../api.ts';
import Modal from './Modal.tsx';
import { formatKey } from '../../../shared/citekey.ts';

const EXAMPLES = ['[auth:lower][year][veryshorttitle:lower]', '[auth][year]', '[authEtAl][year][shorttitle]', '[authors2:lower]_[year]'];

export default function SettingsDialog({ lib, onClose, toast }: { lib: Library; onClose: () => void; toast: (msg: string) => void }) {
  const [pattern, setPattern] = useState('');
  const [saved, setSaved] = useState('');
  const [bibDir, setBibDir] = useState('');
  useEffect(() => {
    api.settings().then((s) => { setPattern(s.citekeyPattern); setSaved(s.citekeyPattern); });
    api.info().then((i) => setBibDir(i.bibDir), () => {});
  }, []);
  const sample = lib.papers.find((p) => p.authors.length > 2 && p.year) ?? lib.papers[0];

  const save = async () => {
    await api.updateSettings({ citekeyPattern: pattern });
    setSaved(pattern);
    toast('Citation key pattern saved (used for new papers)');
  };
  const regenerate = async () => {
    if (!confirm('Recompute the citation key of EVERY paper with this pattern?\n\nExisting \\cite{…} commands in your LaTeX documents will stop matching changed keys.')) return;
    if (pattern !== saved) await api.updateSettings({ citekeyPattern: pattern });
    const { changed } = await api.regenerateKeys();
    toast(`${changed} citation key(s) changed`);
    onClose();
  };

  return (
    <Modal title="Settings" onClose={onClose}>
      <label className="modal-field">
        Citation key pattern
        <input value={pattern} onChange={(e) => setPattern(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
      </label>
      <div className="chips">
        {EXAMPLES.map((ex) => <button key={ex} className="chip" type="button" onClick={() => setPattern(ex)}>{ex}</button>)}
      </div>
      {sample && <p className="small modal-text">Preview: <code>{formatKey(sample, pattern)}</code> <span className="muted">— {sample.title.slice(0, 60)}</span></p>}
      <p className="muted small modal-text">
        Tokens: <code>[auth]</code> <code>[authEtAl]</code> <code>[authors2]</code> <code>[year]</code> <code>[shorttitle]</code> <code>[veryshorttitle]</code> <code>[venue]</code>, each with optional <code>:lower</code> / <code>:upper</code>.
      </p>
      <div className="modal-actions">
        <button className="btn primary" onClick={save} disabled={!pattern.trim() || pattern === saved}>Save</button>
        <button className="btn" onClick={regenerate} disabled={!pattern.trim()}>Regenerate all keys…</button>
      </div>
      {bibDir && (
        <p className="muted small modal-text">
          Auto-synced BibTeX files (one per folder + <code>library.bib</code>): <code>{bibDir}</code>
        </p>
      )}
    </Modal>
  );
}
