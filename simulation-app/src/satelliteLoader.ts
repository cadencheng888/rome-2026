import type { Cell, Grid } from './fireEngine';

/**
 * Loads an NDVI-colorized PNG (Sentinel Hub visualization output) and
 * converts it into a fire-engine Grid by sampling per-pixel color.
 *
 * The Sentinel Hub default NDVI palette roughly maps:
 *   dark green       -> high NDVI (forest)        -> high fuel
 *   bright green     -> moderate-high NDVI        -> high fuel
 *   yellow/yellow-green -> moderate NDVI (grass)  -> medium fuel
 *   orange / red     -> low NDVI (sparse / dry)   -> low fuel
 *   white            -> very low NDVI (bare soil) -> very low fuel
 *   transparent (a≈0) -> no data / outside scene  -> firebreak
 *   strong blue      -> water                     -> firebreak
 */
export async function loadFuelFromImage(
  url: string,
  gridW: number,
  gridH: number
): Promise<Grid> {
  const img = await loadImage(url);

  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get 2D canvas context');
  ctx.drawImage(img, 0, 0);

  const { data } = ctx.getImageData(0, 0, img.width, img.height);

  const blockW = img.width / gridW;
  const blockH = img.height / gridH;

  const grid: Grid = [];
  for (let gy = 0; gy < gridH; gy++) {
    const row: Cell[] = [];
    for (let gx = 0; gx < gridW; gx++) {
      const x0 = Math.floor(gx * blockW);
      const y0 = Math.floor(gy * blockH);
      const x1 = Math.floor((gx + 1) * blockW);
      const y1 = Math.floor((gy + 1) * blockH);

      let fuelSum = 0;
      let validPixels = 0;
      let totalPixels = 0;
      let waterPixels = 0;

      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const idx = (y * img.width + x) * 4;
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];
          const a = data[idx + 3];
          totalPixels++;

          if (a < 32) continue;

          if (isWater(r, g, b)) {
            waterPixels++;
            validPixels++;
            continue;
          }

          fuelSum += colorToFuel(r, g, b);
          validPixels++;
        }
      }

      const validRatio = totalPixels > 0 ? validPixels / totalPixels : 0;
      const waterRatio = validPixels > 0 ? waterPixels / validPixels : 0;
      const burnablePixels = validPixels - waterPixels;

      let fuel: number;
      let status: Cell['status'];

      if (validRatio < 0.25) {
        fuel = 0;
        status = 'firebreak';
      } else if (waterRatio > 0.5) {
        fuel = 0;
        status = 'firebreak';
      } else {
        fuel = burnablePixels > 0 ? fuelSum / burnablePixels : 0;
        status = fuel < 5 ? 'firebreak' : 'unburned';
      }

      row.push({ fuel, status, heat: 0 });
    }
    grid.push(row);
  }

  return grid;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
    img.src = url;
  });
}

/**
 * Loads an image and returns a normalized elevation grid (0-1 per cell)
 * using the red channel as the height signal. Bright pixels = high elevation.
 *
 * For the NDVI image: white snow peaks → high, green forest → low,
 * which roughly matches actual topography.
 */
export async function loadElevationMap(
  url: string,
  gridW: number,
  gridH: number
): Promise<number[][]> {
  const img = await loadImage(url);
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get 2D canvas context');
  ctx.drawImage(img, 0, 0);
  const { data } = ctx.getImageData(0, 0, img.width, img.height);

  const blockW = img.width / gridW;
  const blockH = img.height / gridH;
  const result: number[][] = [];

  for (let gy = 0; gy < gridH; gy++) {
    const row: number[] = [];
    for (let gx = 0; gx < gridW; gx++) {
      const x0 = Math.floor(gx * blockW);
      const y0 = Math.floor(gy * blockH);
      const x1 = Math.floor((gx + 1) * blockW);
      const y1 = Math.floor((gy + 1) * blockH);
      let sum = 0, n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const idx = (y * img.width + x) * 4;
          sum += data[idx];
          n++;
        }
      }
      row.push(n > 0 ? (sum / n) / 255 : 0);
    }
    result.push(row);
  }
  return result;
}

/**
 * Generates a synthetic elevation grid using simple noise — used for the
 * RANDOM FOREST mode where there's no satellite image to derive heights from.
 */
export function syntheticElevationMap(gridW: number, gridH: number): number[][] {
  const result: number[][] = [];
  for (let y = 0; y < gridH; y++) {
    const row: number[] = [];
    for (let x = 0; x < gridW; x++) {
      const a = Math.sin(x * 0.06) * Math.cos(y * 0.05);
      const b = Math.sin(x * 0.13 + y * 0.09) * 0.5;
      const c = Math.cos(x * 0.025 - y * 0.03) * 0.7;
      const v = (a + b + c + 2.2) / 4.4;
      row.push(Math.max(0, Math.min(1, v)));
    }
    result.push(row);
  }
  return result;
}

function isWater(r: number, g: number, b: number): boolean {
  return b > r + 25 && b > g + 25 && b > 80;
}

/**
 * Maps an NDVI palette color to a fuel value 0-100.
 * Uses a combination of green dominance and overall hue position.
 */
function colorToFuel(r: number, g: number, b: number): number {
  if (r > 235 && g > 235 && b > 235) return 8;
  if (r < 8 && g < 8 && b < 8) return 5;

  const greenDominance = (g - Math.max(r, b)) / 255;
  if (greenDominance > 0.05) {
    const intensity = g / 255;
    return Math.min(100, 55 + greenDominance * 200 + intensity * 20);
  }

  const yellowness = (Math.min(r, g) - b) / 255;
  if (yellowness > 0.1 && Math.abs(r - g) < 80) {
    return Math.min(80, 35 + yellowness * 120);
  }

  if (r > g + 15) {
    const redness = (r - g) / 255;
    return Math.max(8, 35 - redness * 60);
  }

  const luminance = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
  return 10 + luminance * 25;
}
