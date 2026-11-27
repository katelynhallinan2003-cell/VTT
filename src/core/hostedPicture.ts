import { loadImage } from './images';

export class MissingHostedPicture extends Error {}

export async function fetchPicture(url: string, cache: RequestCache = 'default') {
  const response = await fetch(url, { mode: 'cors', cache, signal: AbortSignal.timeout(15000) });
  if (response.status === 404 || response.status === 410) throw new MissingHostedPicture('The hosted picture is missing.');
  if (!response.ok) throw new Error('Image host returned HTTP ' + response.status);
  const blob = await response.blob();
  const image = await loadImage(blob);
  if (image.naturalWidth === 180 && image.naturalHeight === 180) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 180;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(image, 0, 0);
    const matches = (x: number, y: number) => {
      const [r, g, b] = ctx.getImageData(x, y, 1, 1).data;
      return Math.abs(r - 39) < 8 && Math.abs(g - 167) < 8 && Math.abs(b - 224) < 8;
    };
    const letters = ctx.getImageData(25, 50, 130, 80).data;
    let white = 0;
    for (let i = 0; i < letters.length; i += 4) {
      if (letters[i] > 230 && letters[i + 1] > 230 && letters[i + 2] > 230) white++;
    }
    if (white > 150 && white < 1800 && matches(8, 8) && matches(170, 170) && matches(90, 28)) throw new MissingHostedPicture('ImgBB image not found');
  }
  return { blob, image };
}
