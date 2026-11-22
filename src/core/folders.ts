// Scene folders: groups of scenes so a long campaign can be prepared in advance. Pure helpers (no database, no screen).
import type { SceneFolder, SceneIndexEntry } from '../types';

/** What the scene picker is showing: every scene, only the scenes in no folder, or one folder's scenes (by id). */
export type FolderFilter = 'all' | 'none' | string;

export const MAX_FOLDER_NAME = 60;

export function cleanFolderName(raw: unknown): string {
  return typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, MAX_FOLDER_NAME) : '';
}

/** A folder as stored (`{name, order}` under its id). */
export function normalizeFolder(id: string, raw: unknown): SceneFolder {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return { id, name: cleanFolderName(r.name) || 'Folder', order: Number.isFinite(Number(r.order)) ? Number(r.order) : 0 };
}

/** A scene's folder, ignoring ids that no longer belong to any folder (those scenes count as not being in one). */
export function folderOf(entry: SceneIndexEntry, folders: SceneFolder[]): string | null {
  return entry.folder && folders.some((f) => f.id === entry.folder) ? entry.folder : null;
}

/** The filter to use when the stored one points at a folder that is gone. */
export function resolveFilter(filter: FolderFilter, folders: SceneFolder[]): FolderFilter {
  if (filter === 'all' || filter === 'none') return filter;
  return folders.some((f) => f.id === filter) ? filter : 'all';
}

/** The scenes a filter lets through, in their usual order. */
export function scenesIn(index: SceneIndexEntry[], folders: SceneFolder[], filter: FolderFilter): SceneIndexEntry[] {
  const f = resolveFilter(filter, folders);
  if (f === 'all') return index;
  return index.filter((s) => (f === 'none' ? folderOf(s, folders) === null : folderOf(s, folders) === f));
}

/** The filter that shows a given scene: its folder, or "none". */
export function filterShowing(entry: SceneIndexEntry | undefined, folders: SceneFolder[]): FolderFilter {
  if (!entry) return 'all';
  return folderOf(entry, folders) ?? 'none';
}

/** Scenes grouped for a list: one group per folder (in folder order, empty ones too), then the scenes in no folder. */
export function groupScenes(index: SceneIndexEntry[], folders: SceneFolder[]): { folder: SceneFolder | null; scenes: SceneIndexEntry[] }[] {
  const sorted = [...folders].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  const groups = sorted.map((folder) => ({ folder: folder as SceneFolder | null, scenes: index.filter((s) => folderOf(s, folders) === folder.id) }));
  groups.push({ folder: null, scenes: index.filter((s) => folderOf(s, folders) === null) });
  return groups;
}

/** A free name for a new folder: "Act 1" stays "Act 1" unless it is taken, then "Act 1 (2)". */
export function uniqueFolderName(name: string, folders: SceneFolder[]): string {
  const base = cleanFolderName(name) || 'New folder';
  const taken = new Set(folders.map((f) => f.name.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  let n = 2;
  while (taken.has(`${base} (${n})`.toLowerCase())) n++;
  return `${base} (${n})`.slice(0, MAX_FOLDER_NAME + 6);
}
