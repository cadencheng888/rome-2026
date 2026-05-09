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
  const data = await loadImageData(url);
  return gridFromImageData(data, gridW, gridH);
}

/**
 * Reduces an NDVI-colorized ImageData buffer to a fire-engine Grid by
 * averaging the source pixels covered by each grid cell.
 *
 * Shared by the URL path (PNG in /public) and the in-app upload path
 * (canvas painted from a parsed GeoTIFF), so they always agree on what
 * counts as fuel, water, and no-data.
 */
export function gridFromImageData(
  imgData: ImageData,
  gridW: number,
  gridH: number
): Grid {
  const { data, width: imgW, height: imgH } = imgData;
  const blockW = imgW / gridW;
  const blockH = imgH / gridH;

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
          const idx = (y * imgW + x) * 4;
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

async function loadImageData(url: string): Promise<ImageData> {
  const img = await loadImage(url);
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get 2D canvas context');
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, img.width, img.height);
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
  const data = await loadImageData(url);
  return elevationFromImageData(data, gridW, gridH);
}

/**
 * Reduces a grayscale-elevation ImageData buffer to a normalized (0-1) grid
 * by averaging the red channel of the source pixels each grid cell covers.
 */
export function elevationFromImageData(
  imgData: ImageData,
  gridW: number,
  gridH: number
): number[][] {
  const { data, width: imgW } = imgData;
  const blockW = imgW / gridW;
  const blockH = imgData.height / gridH;
  const result: number[][] = [];

  for (let gy = 0; gy < gridH; gy++) {
    const row: number[] = [];
    for (let gx = 0; gx < gridW; gx++) {
      const x0 = Math.floor(gx * blockW);
      const y0 = Math.floor(gy * blockH);
      const x1 = Math.floor((gx + 1) * blockW);
      const y1 = Math.floor((gy + 1) * blockH);
      let sum = 0,
        n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const idx = (y * imgW + x) * 4;
          sum += data[idx];
          n++;
        }
      }
      row.push(n > 0 ? sum / n / 255 : 0);
    }
    result.push(row);
  }
  return result;
}

function isWater(r: number, g: number, b: number): boolean {
  return b > r + 25 && b > g + 25 && b > 80;
}

/**
<<<<<<< HEAD
 * Maps an NDVI palette color to a fuel value 0-100. The satellite-realistic
 * palette (see NDVI_RAMP in tiffLoader.ts) goes brown → yellow-green → green
 * as NDVI rises, so projecting onto the green-red axis recovers fuel:
 * green dominance → forest / high fuel, red/brown dominance → bare / low fuel.
=======
 * Maps an NDVI palette color to a fuel value 0-100. The fire-risk palette
 * (see NDVI_RAMP in scripts/tiff_to_png.py) goes
 * green → yellow → orange → red as NDVI rises, so projecting the color onto
 * the red-green axis recovers the underlying fuel: red dominance → forest /
 * high fuel, green dominance → bare / low fuel.
>>>>>>> ed36e01633963b7c59b5de87aa4604b761d237ad
 */
function colorToFuel(r: number, g: number, b: number): number {
  if (r > 235 && g > 235 && b > 235) return 8;
  if (r < 8 && g < 8 && b < 8) return 5;

  const denom = Math.max(r + g, 1);
  const axis = (g - r) / denom; // ~ -1 (pure red/brown) … +1 (pure green)
  return Math.max(5, Math.min(100, 50 + axis * 80));
}

// Natural satellite color ramp indexed by green-red axis (-1 = bare, +1 = dense forest)
const NATURAL_RAMP: Array<[number, number, number, number]> = [
  [-1.0, 110,  88,  72],  // barren / rocky
  [-0.5, 190, 158, 100],  // dry bare soil
  [ 0.0, 178, 172, 100],  // very sparse vegetation / sandy
  [ 0.25, 138, 162,  80], // grassland
  [ 0.5,  85, 142,  60],  // shrubs
  [ 0.75, 52, 118,  44],  // light forest
  [ 1.0,  28,  80,  24],  // dense forest
];

function naturalRampInterp(axis: number): [number, number, number] {
  const v = Math.max(-1, Math.min(1, axis));
  for (let i = 1; i < NATURAL_RAMP.length; i++) {
    if (v <= NATURAL_RAMP[i][0]) {
      const [t0, r0, g0, b0] = NATURAL_RAMP[i - 1];
      const [t1, r1, g1, b1] = NATURAL_RAMP[i];
      const f = (v - t0) / (t1 - t0);
      return [
        Math.round(r0 + (r1 - r0) * f),
        Math.round(g0 + (g1 - g0) * f),
        Math.round(b0 + (b1 - b0) * f),
      ];
    }
  }
  const last = NATURAL_RAMP[NATURAL_RAMP.length - 1];
  return [last[1], last[2], last[3]];
}

function recolorPixel(r: number, g: number, b: number, a: number): [number, number, number, number] {
  if (a < 32) return [0, 0, 0, 0];
  if (isWater(r, g, b)) return [32, 72, 125, 255];
  const denom = Math.max(r + g, 1);
  const axis = (g - r) / denom;
  const [nr, ng, nb] = naturalRampInterp(axis);
  return [nr, ng, nb, 255];
}

async function recolorToNatural(imgData: ImageData): Promise<string> {
  const { data, width, height } = imgData;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get 2D canvas context');
  const out = ctx.createImageData(width, height);
  for (let i = 0; i < width * height; i++) {
    const [nr, ng, nb, na] = recolorPixel(
      data[i * 4], data[i * 4 + 1], data[i * 4 + 2], data[i * 4 + 3]
    );
    out.data[i * 4] = nr;
    out.data[i * 4 + 1] = ng;
    out.data[i * 4 + 2] = nb;
    out.data[i * 4 + 3] = na;
  }
  ctx.putImageData(out, 0, 0);
  return new Promise<string>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) reject(new Error('Failed to encode recolored texture'));
      else resolve(URL.createObjectURL(blob));
    }, 'image/png');
  });
}

/**
 * Loads an NDVI false-color PNG, converts it to a fire grid, AND produces a
 * natural-color satellite texture blob URL suitable for the 3D terrain.
 */
export async function loadFuelAndTextureFromImage(
  url: string,
  gridW: number,
  gridH: number
): Promise<{ grid: Grid; naturalTextureUrl: string }> {
  const imgData = await loadImageData(url);
  const grid = gridFromImageData(imgData, gridW, gridH);
  const naturalTextureUrl = await recolorToNatural(imgData);
  return { grid, naturalTextureUrl };
}
