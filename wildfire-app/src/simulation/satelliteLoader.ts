import type { Cell, Grid } from "./fireEngine";

/**
 * Loads an NDVI-colorized PNG (Sentinel Hub visualization output) and
 * converts it into a fire-engine Grid by sampling per-pixel color.
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
 * Reduces an NDVI-colorized ImageData buffer to a fire-engine Grid.
 * Slope and aspect default to 0 (unavailable from image path).
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

      row.push({ fuel, moisture: 0, slope: 0, aspect: 0, status, heat: 0 });
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
 * Builds a normalized (0–1) elevation grid directly from a Float32 band array,
 * avoiding the lossy elevation → 8-bit grayscale → float round-trip.
 *
 * Previously, parseTiff painted elevation to an 8-bit grayscale ImageData and
 * then read it back here via elevationFromImageData. That quantizes potentially
 * thousands of meters of elevation range into 256 levels (~4m resolution for
 * a 1000m span), discarding sub-step variation and introducing banding
 * artifacts in the displacement map.
 */
export function elevationFromFloat32(
  elevBand: ArrayLike<number>,
  pixelW: number,
  pixelH: number,
  gridW: number,
  gridH: number,
  eMin: number,
  eMax: number
): number[][] {
  const span = eMax > eMin ? eMax - eMin : 1;
  const blockW = pixelW / gridW;
  const blockH = pixelH / gridH;
  const result: number[][] = [];

  for (let gy = 0; gy < gridH; gy++) {
    const row: number[] = [];
    for (let gx = 0; gx < gridW; gx++) {
      const x0 = Math.floor(gx * blockW);
      const y0 = Math.floor(gy * blockH);
      const x1 = Math.min(pixelW, Math.floor((gx + 1) * blockW));
      const y1 = Math.min(pixelH, Math.floor((gy + 1) * blockH));
      let sum = 0;
      let n = 0;
      for (let py = y0; py < y1; py++) {
        for (let px = x0; px < x1; px++) {
          const v = elevBand[py * pixelW + px];
          if (Number.isFinite(v)) {
            sum += (v - eMin) / span;
            n++;
          }
        }
      }
      row.push(n > 0 ? Math.max(0, Math.min(1, sum / n)) : 0);
    }
    result.push(row);
  }
  return result;
}

/**
 * Legacy path: derive elevation from an 8-bit grayscale ImageData.
 * Kept for backwards compatibility with callers that don't have the float band.
 * Prefer elevationFromFloat32 whenever the raw TIFF band is available.
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
 * Generates a synthetic elevation grid using simple noise.
 * Used for RANDOM FOREST mode where there's no satellite image.
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
 * Builds a fire-engine Grid from raw 7-band GeoTIFF arrays, including
 * the slope and aspect bands that were previously discarded.
 *
 * - Fuel: NLCD land-cover scaled by NDVI vegetation density
 * - Moisture: NDMI → 0 (dry) to 1 (wet)
 * - Slope: degrees from TIFF Band 2 (was ignored before)
 * - Aspect: degrees 0–360 from TIFF Band 3 (was ignored before)
 */
export function gridFromBands(
  ndvi: ArrayLike<number>,
  ndmi: ArrayLike<number>,
  landCover: ArrayLike<number>,
  slope: ArrayLike<number>, // NEW: Band 2, degrees
  aspect: ArrayLike<number>, // NEW: Band 3, degrees 0-360
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
        lcSum = 0;
      let slopeSum = 0,
        aspectSinSum = 0,
        aspectCosSum = 0;
      let count = 0,
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

          const sl = slope[idx];
          if (Number.isFinite(sl)) slopeSum += sl;

          // Aspect: circular mean to handle 0/360 wraparound correctly.
          const asp = aspect[idx];
          if (Number.isFinite(asp)) {
            const rad = (asp * Math.PI) / 180;
            aspectSinSum += Math.sin(rad);
            aspectCosSum += Math.cos(rad);
          }

          count++;
        }
      }

      if (count === 0) {
        row.push({
          fuel: 0,
          moisture: 0,
          slope: 0,
          aspect: 0,
          status: "firebreak",
          heat: 0,
        });
        continue;
      }

      const avgNdvi = ndviSum / count;
      const avgNdmi = ndmiSum / count;
      const avgLc = Math.round(lcSum / count);
      const waterRatio = waterCount / count;

      const avgSlope = slopeSum / count;
      // Recover circular mean of aspect.
      const avgAspect =
        (Math.atan2(aspectSinSum / count, aspectCosSum / count) * 180) /
        Math.PI;
      const normalizedAspect = (avgAspect + 360) % 360;

      const baseFuel = landCoverToFuel(avgLc);
      const ndviScale = Math.max(0.2, Math.min(1.5, 0.5 + avgNdvi));
      const fuel = Math.max(0, Math.min(100, baseFuel * ndviScale));

      const moisture = Math.max(0, Math.min(1, (avgNdmi + 1) / 2));

      const isWaterCell = waterRatio > 0.5 || avgLc === 11;
      const status: Cell["status"] =
        isWaterCell || fuel < 5 ? "firebreak" : "unburned";

      row.push({
        fuel: isWaterCell ? 0 : fuel,
        moisture,
        slope: avgSlope,
        aspect: normalizedAspect,
        status,
        heat: 0,
      });
    }
    grid.push(row);
  }
  return grid;
}

// NLCD 2021 class → base fuel value (0-100).
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
      return 85; // Evergreen Forest
    case 43:
      return 80; // Mixed Forest
    case 52:
      return 65; // Shrub/Scrub
    case 71:
      return 50; // Herbaceous/Grassland
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

function colorToFuel(r: number, g: number, b: number): number {
  if (r > 235 && g > 235 && b > 235) return 8;
  if (r < 8 && g < 8 && b < 8) return 5;
  const denom = Math.max(r + g, 1);
  const axis = (g - r) / denom;
  return Math.max(5, Math.min(100, 50 + axis * 80));
}
