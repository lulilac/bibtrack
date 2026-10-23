import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import type { Library, Paper, Project } from '../shared/types.ts';

export const libraryDir = () => process.env.BIBTRACK_DIR ?? path.join(os.homedir(), 'Dropbox', 'bibtrack');

const emptyLibrary = (): Library => ({ version: 1, projects: [], papers: [], deleted: {} });

const newer = <T extends { updatedAt: string }>(a: T, b: T) => (b.updatedAt > a.updatedAt ? b : a);

// Merge two libraries item by item: newest updatedAt wins, tombstones win over older edits.
export function mergeLibraries(a: Library, b: Library): Library {
  const deleted = { ...a.deleted };
  for (const [id, t] of Object.entries(b.deleted ?? {})) if (!deleted[id] || t > deleted[id]) deleted[id] = t;
  const mergeList = <T extends { id: string; updatedAt: string }>(x: T[], y: T[]) => {
    const m = new Map<string, T>();
    for (const it of [...x, ...y]) m.set(it.id, m.has(it.id) ? newer(m.get(it.id)!, it) : it);
    return [...m.values()].filter((it) => !deleted[it.id] || it.updatedAt > deleted[it.id]);
  };
  return {
    version: 1,
    projects: mergeList(a.projects, b.projects ?? []),
    papers: mergeList(a.papers, b.papers ?? []),
    deleted,
    settings: a.settings ?? b.settings,
  };
}

export class Store extends EventEmitter {
  readonly dir: string;
  readonly file: string;
  readonly pdfDir: string;
  private lib: Library = emptyLibrary();
  private mtime = 0;
  private writing = false;

  constructor(dir: string) {
    super();
    this.dir = dir;
    this.file = path.join(dir, 'library.json');
    this.pdfDir = path.join(dir, 'pdfs');
    fs.mkdirSync(this.pdfDir, { recursive: true });
    if (!fs.existsSync(this.file)) this.write(emptyLibrary());
    this.reload();
    this.absorbConflicts();
    this.watch();
  }

  get library(): Library {
    this.reloadIfChanged();
    return this.lib;
  }

  private read(file: string): Library {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { ...emptyLibrary(), ...data };
  }

  private reload() {
    try {
      this.lib = this.read(this.file);
      this.mtime = fs.statSync(this.file).mtimeMs;
    } catch (e) {
      // Partially-synced or corrupt file: keep the in-memory copy, try again on next change.
      console.warn('[store] could not read library.json:', (e as Error).message);
    }
  }

  private reloadIfChanged() {
    try {
      if (fs.statSync(this.file).mtimeMs !== this.mtime) {
        this.reload();
        return true;
      }
    } catch {}
    return false;
  }

  private write(lib: Library) {
    const tmp = path.join(this.dir, `.library.${process.pid}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(lib, null, 1));
    this.writing = true;
    fs.renameSync(tmp, this.file);
    this.lib = lib;
    this.mtime = fs.statSync(this.file).mtimeMs;
    setTimeout(() => (this.writing = false), 200);
  }

  // Apply a mutation on the freshest on-disk state, then persist.
  mutate<R>(fn: (lib: Library) => R): R {
    this.reloadIfChanged();
    const lib = structuredClone(this.lib);
    const result = fn(lib);
    this.write(lib);
    this.emit('change');
    return result;
  }

  // Dropbox writes "library (host's conflicted copy 2026-10-22).json" when two machines
  // edit before syncing. Merge those back in and remove them.
  private absorbConflicts() {
    const conflicts = fs
      .readdirSync(this.dir)
      .filter((f) => f.startsWith('library') && f.endsWith('.json') && f !== 'library.json' && /conflict/i.test(f));
    if (!conflicts.length) return;
    this.mutate((lib) => {
      let merged = lib;
      for (const f of conflicts) {
        try {
          merged = mergeLibraries(merged, this.read(path.join(this.dir, f)));
          console.log(`[store] merged ${f}`);
        } catch (e) {
          console.warn(`[store] skipping ${f}:`, (e as Error).message);
          continue;
        }
      }
      Object.assign(lib, merged);
    });
    for (const f of conflicts) fs.rmSync(path.join(this.dir, f), { force: true });
  }

  private watch() {
    let timer: NodeJS.Timeout | undefined;
    fs.watch(this.dir, (_ev, name) => {
      if (!name || !name.endsWith('.json')) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (name !== 'library.json') return this.absorbConflicts();
        if (!this.writing && this.reloadIfChanged()) this.emit('change');
      }, 150);
    });
  }
}

export type { Library, Paper, Project };
