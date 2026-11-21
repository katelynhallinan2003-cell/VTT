/** Generates a demo "dungeon" map (with a baked-in 70px grid) so demo mode has something to play on. */
export async function makeSampleMap(): Promise<{ blob: Blob; w: number; h: number }> {
  const cell = 70;
  const cols = 32;
  const rows = 22;
  const w = cols * cell;
  const h = rows * cell;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;

  // rock background with noise
  g.fillStyle = '#2b2a2e';
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = `rgba(${40 + Math.random() * 30},${38 + Math.random() * 28},${44 + Math.random() * 30},0.5)`;
    g.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 6, 2 + Math.random() * 6);
  }

  const rooms: [number, number, number, number][] = [
    [2, 2, 8, 6], [13, 3, 7, 5], [23, 2, 7, 7], [3, 12, 6, 7], [13, 13, 9, 7], [25, 13, 5, 6],
  ];
  const floor = (x: number, y: number, ww: number, hh: number) => {
    const grad = g.createLinearGradient(x * cell, y * cell, (x + ww) * cell, (y + hh) * cell);
    grad.addColorStop(0, '#9a8f7a');
    grad.addColorStop(1, '#847a68');
    g.fillStyle = grad;
    g.fillRect(x * cell, y * cell, ww * cell, hh * cell);
    for (let i = 0; i < ww * hh * 6; i++) {
      g.fillStyle = `rgba(0,0,0,${Math.random() * 0.07})`;
      g.fillRect(x * cell + Math.random() * ww * cell, y * cell + Math.random() * hh * cell, 4 + Math.random() * 14, 4 + Math.random() * 14);
    }
    g.strokeStyle = '#1b1a1d';
    g.lineWidth = 8;
    g.strokeRect(x * cell, y * cell, ww * cell, hh * cell);
  };
  // corridors first, rooms on top
  floor(10, 4, 3, 2); floor(20, 5, 3, 2); floor(5, 8, 2, 4); floor(7, 14, 6, 2); floor(22, 15, 3, 2);
  floor(15, 8, 2, 5); floor(26, 9, 2, 4);
  for (const r of rooms) floor(...r);

  // a pillar / table or two
  g.fillStyle = '#5b4a38';
  g.fillRect(15 * cell, 5 * cell, 3 * cell, cell);
  g.beginPath(); g.arc(8 * cell, 16.5 * cell, cell * 0.9, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#6b6f78';
  for (const [px, py] of [[15, 15], [19, 15], [15, 18], [19, 18]]) {
    g.beginPath(); g.arc((px + 0.5) * cell, (py + 0.5) * cell, cell * 0.4, 0, Math.PI * 2); g.fill();
  }

  // baked-in grid
  g.strokeStyle = 'rgba(0,0,0,0.28)';
  g.lineWidth = 2;
  g.beginPath();
  for (let x = 0; x <= cols; x++) { g.moveTo(x * cell, 0); g.lineTo(x * cell, h); }
  for (let y = 0; y <= rows; y++) { g.moveTo(0, y * cell); g.lineTo(w, y * cell); }
  g.stroke();

  const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), 'image/png'));
  return { blob, w, h };
}

/** A simple generated token portrait: coloured disc with initials. */
export async function makeSampleToken(label: string, color: string): Promise<Blob> {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(100, 90, 20, 128, 128, 140);
  grad.addColorStop(0, color);
  grad.addColorStop(1, '#101218');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = 'rgba(255,255,255,0.92)';
  g.font = '700 120px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(label.slice(0, 2).toUpperCase(), 128, 136);
  return await new Promise((r) => c.toBlob((b) => r(b!), 'image/png'));
}
