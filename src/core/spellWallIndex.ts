import type { Vec } from '../types';
import type { Seg } from './walls';
interface Entry {
  wall: Seg;
  order: number;
}
interface Node {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  entries?: Entry[];
  left?: Node;
  right?: Node;
}
function bounds(entries: Entry[]): Node {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const {
    wall: {
      a,
      b
    }
  } of entries) {
    x0 = Math.min(x0, a.x, b.x);
    y0 = Math.min(y0, a.y, b.y);
    x1 = Math.max(x1, a.x, b.x);
    y1 = Math.max(y1, a.y, b.y);
  }
  return {
    x0,
    y0,
    x1,
    y1
  };
}
function split(entries: Entry[]): Node {
  const node = bounds(entries);
  if (entries.length <= 8) {
    node.entries = entries;
    return node;
  }
  const axis = node.x1 - node.x0 >= node.y1 - node.y0 ? 'x' : 'y';
  entries.sort((l, r) => l.wall.a[axis] + l.wall.b[axis] - (r.wall.a[axis] + r.wall.b[axis]));
  const mid = entries.length >> 1;
  node.left = split(entries.slice(0, mid));
  node.right = split(entries.slice(mid));
  return node;
}
/** Visit only groups touched by this finite ray. Preserve the authored order
 * for the first blocker because the wrapping solver tries that blocker’s ends. */
export function indexSpellWalls(walls: Seg[]) {
  const tree = split(walls.map((wall, order) => ({
    wall,
    order
  })));
  return (from: Vec, to: Vec, blocks: (s: Seg) => boolean): Seg | undefined => {
    const dx = to.x - from.x,
      dy = to.y - from.y,
      margin = 1e-5;
    let best: Entry | undefined;
    function visit(n: Node) {
      let lo = 0,
        hi = 1;
      if (dx) {
        const p = (n.x0 - margin - from.x) / dx,
          q = (n.x1 + margin - from.x) / dx;
        lo = Math.max(lo, Math.min(p, q));
        hi = Math.min(hi, Math.max(p, q));
      } else if (from.x < n.x0 - margin || from.x > n.x1 + margin) return;
      if (dy) {
        const p = (n.y0 - margin - from.y) / dy,
          q = (n.y1 + margin - from.y) / dy;
        lo = Math.max(lo, Math.min(p, q));
        hi = Math.min(hi, Math.max(p, q));
      } else if (from.y < n.y0 - margin || from.y > n.y1 + margin) return;
      if (lo > hi) return;
      if (n.entries) {
        for (const e of n.entries) if ((!best || e.order < best.order) && blocks(e.wall)) best = e;
      } else {
        visit(n.left!);
        visit(n.right!);
      }
    }
    visit(tree);
    return best?.wall;
  };
}
