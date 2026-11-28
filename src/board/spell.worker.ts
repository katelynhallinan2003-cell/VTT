import type { Drawing, GridSettings, Rect } from '../types';
import { zonesOf, groundAt } from '../core/height';
import type { Seg } from '../core/walls';
import { spellPicture, type PictureRequest } from '../core/spellPicture';
import type { SpellWorld } from '../core/spellVolume';
export interface SpellScene {
  segs: Seg[];
  draws: Drawing[];
  maps: Rect[];
  grid: GridSettings;
  steppedGround: boolean;
}
let grid: GridSettings, world: SpellWorld;
self.onmessage = ({
  data
}: {
  data: {
    scene?: SpellScene;
    req?: PictureRequest;
  };
}) => {
  if (data.scene) {
    const s = data.scene;
    grid = s.grid;
    const terrain = zonesOf(s.draws, grid);
    const memo = new Map<number, Map<number, number>>();
    let count = 0;
    world = {
      segs: s.segs,
      maps: s.maps,
      steppedGround: s.steppedGround,
      ground: terrain.areas.length ? p => {
        if (count >= 250000) {
          memo.clear();
          count = 0;
        }
        let row = memo.get(p.x);
        if (!row) memo.set(p.x, row = new Map());
        let z = row.get(p.y);
        if (z === undefined) {
          z = groundAt(terrain, p);
          row.set(p.y, z);
          count++;
        }
        return z;
      } : undefined
    };
  }
  if (!data.req) return;
  const picture = spellPicture(data.req, grid, world);
  self.postMessage(picture, {
    transfer: [picture.fill.buffer, picture.outline.buffer, picture.wire.buffer, picture.contact.buffer, picture.surface.rgba.buffer]
  });
};
