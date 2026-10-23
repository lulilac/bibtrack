import type { Project } from './types.ts';

// A project's id plus the ids of all its sub-projects (at any depth).
export function subtreeIds(projects: Project[], rootId: string): Set<string> {
  const ids = new Set([rootId]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const p of projects) if (p.parentId && ids.has(p.parentId) && !ids.has(p.id)) { ids.add(p.id); grew = true; }
  }
  return ids;
}

// Projects in display order (depth-first, siblings by name) with their depth.
export function projectTree(projects: Project[]): { project: Project; depth: number }[] {
  const ids = new Set(projects.map((p) => p.id));
  const children = new Map<string, Project[]>();
  for (const p of projects) {
    const parent = p.parentId && ids.has(p.parentId) ? p.parentId : '';
    children.set(parent, [...(children.get(parent) ?? []), p]);
  }
  const out: { project: Project; depth: number }[] = [];
  const walk = (parent: string, depth: number) => {
    for (const p of (children.get(parent) ?? []).sort((a, b) => a.name.localeCompare(b.name))) {
      out.push({ project: p, depth });
      walk(p.id, depth + 1);
    }
  };
  walk('', 0);
  return out;
}

export function projectPath(projects: Project[], id: string): string {
  const byId = new Map(projects.map((p) => [p.id, p]));
  const names: string[] = [];
  for (let p = byId.get(id); p && names.length < 20; p = p.parentId ? byId.get(p.parentId) : undefined) names.unshift(p.name);
  return names.join(' › ');
}
