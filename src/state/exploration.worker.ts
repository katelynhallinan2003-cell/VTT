import { explorationScene, type ExplorationJob, type ExplorationScene } from '../core/exploration';

let solve: ReturnType<typeof explorationScene>;
self.onmessage = ({ data }: MessageEvent<{ id: number; scene?: ExplorationScene; job: ExplorationJob }>) => {
  try {
    if (data.scene) solve = explorationScene(data.scene);
    self.postMessage({ id: data.id, ops: solve(data.job) });
  } catch (error) {
    self.postMessage({ id: data.id, error: String(error) });
  }
};
