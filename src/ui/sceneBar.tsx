import { useEffect } from 'preact/hooks';
import { filterShowing, groupScenes, resolveFilter, scenesIn } from '../core/folders';
import type { TableClient } from '../state/client';
import type { UiState } from '../state/ui';
import { useClient, useUi } from './common';

/**
 * The DM's scene picker: a folder picker (which scenes the list shows) and the scene list itself.
 * Opening a scene in another folder (from the Manage scenes list, a summon, a new scene) moves the folder picker along with it.
 */
export function SceneBar(props: { client: TableClient; ui: UiState; onNew: () => void; onManage: () => void; onNewFolder: () => void }) {
  const { client, ui } = props;
  useClient(client);
  const d = useUi(ui);
  const folders = client.sceneFolders;
  const index = client.sceneIndex;
  const filter = resolveFilter(d.sceneFolder, folders);
  const shown = scenesIn(index, folders, filter);
  const viewId = client.viewSceneId;
  const viewing = index.find((s) => s.id === viewId);
  const visible = !!viewId && shown.some((s) => s.id === viewId);

  // follow the scene being viewed into its folder, but only when the picked folder would hide it
  useEffect(() => {
    if (!viewing) return;
    if (!scenesIn(client.sceneIndex, client.sceneFolders, ui.data.sceneFolder).some((s) => s.id === viewing.id)) ui.set({ sceneFolder: filterShowing(viewing, client.sceneFolders) });
  }, [viewId, viewing?.folder]);

  const sceneOption = (sc: { id: string; name: string }) => <option key={sc.id} value={sc.id}>{sc.name}</option>;
  const emptyText = index.length === 0 ? 'No scenes yet' : filter === 'all' ? 'No scenes' : 'No scenes in this folder';
  return (
    <>
      <select class="folder-select" aria-label="Scene folder" title="Which scenes the list shows. Make folders to prepare many scenes ahead." value={filter}
        onChange={(e) => {
          const el = e.target as HTMLSelectElement;
          if (el.value === '__newfolder') { el.value = filter; props.onNewFolder(); }
          else ui.set({ sceneFolder: el.value });
        }}>
        <option value="all">All scenes</option>
        {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        {folders.length > 0 && <option value="none">Not in a folder</option>}
        <option value="__newfolder">+ New folder…</option>
      </select>
      <select class="scene-select" aria-label="Scene" value={visible ? viewId! : ''}
        onChange={(e) => {
          const el = e.target as HTMLSelectElement;
          const v = el.value;
          if (v === '__new') { el.value = visible ? viewId! : ''; props.onNew(); }
          else if (v === '__manage') { el.value = visible ? viewId! : ''; props.onManage(); }
          else if (v) client.openScene(v);
        }}>
        {!visible && <option value="" disabled>{shown.length ? 'Choose a scene…' : emptyText}</option>}
        {filter === 'all' && folders.length > 0
          ? groupScenes(index, folders).filter((g) => g.scenes.length).map((g) => (
            <optgroup key={g.folder?.id ?? 'none'} label={g.folder?.name ?? 'Not in a folder'}>{g.scenes.map(sceneOption)}</optgroup>
          ))
          : shown.map(sceneOption)}
        <option value="__new">+ New scene…</option>
        {index.length > 0 && <option value="__manage">Manage scenes and folders…</option>}
      </select>
    </>
  );
}
