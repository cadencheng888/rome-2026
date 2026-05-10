import type { Cell, Grid } from "./fireEngine";

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
      let status: Cell["status"];

      if (validRatio < 0.25) {
        fuel = 0;
        status = "firebreak";
      } else if (waterRatio > 0.5) {
        fuel = 0;
        status = "firebreak";
      } else {
        fuel = burnablePixels > 0 ? fuelSum / burnablePixels : 0;
        status = fuel < 5 ? "firebreak" : "unburned";
      }

      row.push({ fuel, moisture: 0, status, heat: 0 });
    }
    grid.push(row);
  }

  return grid;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
    img.src = url;
  });
}

async function loadImageData(url: string): Promise<ImageData> {
  const img = await loadImage(url);
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get 2D canvas context");
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

/**
 * Generates a synthetic elevation grid using simple noise — used for the
 * RANDOM FOREST mode where there's no satellite image to derive heights from.
 */
export function syntheticElevationMap(
  gridW: number,
  gridH: number
): number[][] {
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

/**
 * Builds a fire-engine Grid directly from raw 7-band GeoTIFF arrays.
 * Fuel is derived from NLCD land-cover class scaled by NDVI density.
 * Moisture is derived from NDMI: high NDMI (wet) → moisture≈1, low NDMI (dry) → moisture≈0.
 */
export function gridFromBands(
  ndvi: ArrayLike<number>,
  ndmi: ArrayLike<number>,
  landCover: ArrayLike<number>,
  pixelW: number,
  pixelH: number,
  gridW: number,
  gridH: number
): Grid {
  const blockW = pixelW / gridW;
  const blockH = pixelH / gridH;
  const grid: Grid = [];

  for (let gy = 0; gy < gridH; gy++) {
    const row: Cell[] = [];
    for (let gx = 0; gx < gridW; gx++) {
      const x0 = Math.floor(gx * blockW);
      const y0 = Math.floor(gy * blockH);
      const x1 = Math.min(pixelW, Math.floor((gx + 1) * blockW));
      const y1 = Math.min(pixelH, Math.floor((gy + 1) * blockH));

      let ndviSum = 0,
        ndmiSum = 0,
        lcSum = 0,
        count = 0,
        waterCount = 0;

      for (let py = y0; py < y1; py++) {
        for (let px = x0; px < x1; px++) {
          const idx = py * pixelW + px;
          const n = ndvi[idx];
          if (!Number.isFinite(n)) continue;
          ndviSum += n;
          const m = ndmi[idx];
          ndmiSum += Number.isFinite(m) ? m : 0;
          const lc = landCover[idx];
          lcSum += lc;
          if (lc === 11) waterCount++;
          count++;
        }
      }

      if (count === 0) {
        row.push({ fuel: 0, moisture: 0, status: "firebreak", heat: 0 });
        continue;
      }

      const avgNdvi = ndviSum / count;
      const avgNdmi = ndmiSum / count;
      const avgLc = Math.round(lcSum / count);
      const waterRatio = waterCount / count;

      // Base fuel from land-cover type, scaled by NDVI vegetation density.
      const baseFuel = landCoverToFuel(avgLc);
      const ndviScale = Math.max(0.2, Math.min(1.5, 0.5 + avgNdvi));
      const fuel = Math.max(0, Math.min(100, baseFuel * ndviScale));

      // NDMI: -1..1 → moisture 0 (dry) to 1 (wet)
      const moisture = Math.max(0, Math.min(1, (avgNdmi + 1) / 2));

      const isWaterCell = waterRatio > 0.5 || avgLc === 11;
      const status: Cell["status"] =
        isWaterCell || fuel < 5 ? "firebreak" : "unburned";

      row.push({ fuel: isWaterCell ? 0 : fuel, moisture, status, heat: 0 });
    }
    grid.push(row);
  }
  return grid;
}

// NLCD 2021 class → base fuel value (0-100).
// Crown-fire fuels (evergreen/deciduous forest) score highest; developed and water score 0.
function landCoverToFuel(nlcdClass: number): number {
  switch (nlcdClass) {
    case 11:
      return 0; // Open Water
    case 21:
      return 5; // Developed, Open Space
    case 22:
      return 3; // Developed, Low Intensity
    case 23:
      return 2; // Developed, Medium Intensity
    case 24:
      return 0; // Developed, High Intensity
    case 31:
      return 10; // Barren Land
    case 41:
      return 75; // Deciduous Forest
    case 42:
      return 85; // Evergreen Forest (high resin = crown fire risk)
    case 43:
      return 80; // Mixed Forest
    case 52:
      return 65; // Shrub/Scrub (fast spread)
    case 71:
      return 50; // Herbaceous/Grassland (fastest spread, high cure rate)
    case 81:
      return 40; // Hay/Pasture
    case 82:
      return 30; // Cultivated Crops
    case 90:
      return 20; // Woody Wetlands
    case 95:
      return 15; // Emergent Herbaceous Wetlands
    default:
      return 40; // Unknown → moderate
  }
}

function isWater(r: number, g: number, b: number): boolean {
  return b > r + 25 && b > g + 25 && b > 80;
}

/**
 * Maps a natural-satellite palette color to a fuel value 0-100.
 * The palette (see NDVI_RAMP in tiffLoader.ts) uses green = dense forest =
 * high fuel, tan/brown = bare soil = low fuel.  Green dominance → high fuel.
 */
function colorToFuel(r: number, g: number, b: number): number {
  if (r > 235 && g > 235 && b > 235) return 8;
  if (r < 8 && g < 8 && b < 8) return 5;

  const denom = Math.max(r + g, 1);
  const axis = (g - r) / denom; // ~ -1 (tan/red) … +1 (green forest)
  return Math.max(5, Math.min(100, 50 + axis * 80));
}
