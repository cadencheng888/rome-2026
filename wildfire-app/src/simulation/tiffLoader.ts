import { fromBlob } from 'geotiff';
import type { Grid } from './fireEngine';
import {
  elevationFromImageData,
  gridFromImageData,
<<<<<<< Updated upstream
=======
  gridFromBands,
>>>>>>> Stashed changes
} from './satelliteLoader';

export interface TiffTile {
  ndviUrl: string;          // blob URL of the colorized NDVI canvas
  grid: Grid;
  elevation: number[][];
  width: number;
  height: number;
  minMeters: number;
  maxMeters: number;
}

/**
<<<<<<< Updated upstream
 * Fire-risk NDVI palette. Mirrors scripts/tiff_to_png.py. Red maps to
 * high NDVI (dense canopy = lots of fuel = high fire susceptibility);
 * green maps to low NDVI (bare / sparse = low fuel); blue stays water.
 * satelliteLoader.colorToFuel inverts the red-green axis to recover fuel.
 */
const NDVI_RAMP: Array<[number, number, number, number]> = [
  [-1.0,  20,  40,  90],
  [-0.2,  60, 100, 160],
  [ 0.0,  90, 200,  90],
  [ 0.15, 150, 220,  85],
  [ 0.3, 220, 220,  80],
  [ 0.45, 245, 180,  70],
  [ 0.6, 245, 130,  60],
  [ 0.75, 230,  80,  50],
  [ 0.9, 200,  40,  40],
  [ 1.0, 130,  20,  20],
=======
 * Natural earth satellite palette. Blue = water, tan/brown = bare soil,
 * yellow-green = grassland/scrub, dark green = dense forest.
 * High NDVI → green (dense canopy = high fuel). satelliteLoader.colorToFuel
 * uses green dominance to recover fuel (green-dominant → high fuel).
 */
const NDVI_RAMP: Array<[number, number, number, number]> = [
  [-1.0,  15,  55, 130],  // deep water blue
  [-0.2,  80,  90, 100],  // rocky / coastal gray
  [ 0.0, 170, 150,  90],  // sandy bare soil
  [ 0.15, 155, 160,  85], // sparse scrub / khaki
  [ 0.3, 120, 155,  65],  // savanna / light grass
  [ 0.45,  85, 140,  55], // grassland / shrub
  [ 0.6,  55, 115,  40],  // mixed vegetation
  [ 0.75,  30,  90,  30], // woodland / forest
  [ 0.9,  18,  65,  22],  // dense forest
  [ 1.0,  10,  45,  15],  // very dense canopy
>>>>>>> Stashed changes
];

function rampInterp(value: number): [number, number, number] {
  const v = Math.max(-1, Math.min(1, value));
  for (let i = 1; i < NDVI_RAMP.length; i++) {
    const [t1] = NDVI_RAMP[i];
    if (v <= t1) {
      const [t0, r0, g0, b0] = NDVI_RAMP[i - 1];
      const [, r1, g1, b1] = NDVI_RAMP[i];
      const f = (v - t0) / (t1 - t0);
      return [r0 + (r1 - r0) * f, g0 + (g1 - g0) * f, b0 + (b1 - b0) * f];
    }
  }
  const last = NDVI_RAMP[NDVI_RAMP.length - 1];
  return [last[1], last[2], last[3]];
}

export async function parseTiff(
  file: File,
  gridW: number,
  gridH: number
): Promise<TiffTile> {
  const tiff = await fromBlob(file);
  const image = await tiff.getImage();
  const width = image.getWidth();
  const height = image.getHeight();
  const samplesPerPixel = image.getSamplesPerPixel();
  if (samplesPerPixel < 2) {
    throw new Error(
      `TIFF must have at least 2 bands (elevation + NDVI); got ${samplesPerPixel}`
    );
  }

  const rasters = (await image.readRasters({ interleave: false })) as
    | Float32Array[]
    | Uint16Array[]
    | number[][];
<<<<<<< Updated upstream
  const elev = rasters[0];
  const ndvi = rasters[1];
  if (!elev || !ndvi) throw new Error('TIFF read returned empty bands');

  // First pass: NDVI → RGBA (transparent for NaN/non-finite), tracking elev range.
=======

  // 7-band format: B0=Elevation, B1=Slope, B2=Aspect, B3=NDVI, B4=NDMI, B5=NBR, B6=LandCover
  // Legacy 2-band format: B0=Elevation, B1=NDVI
  const isMultiBand = samplesPerPixel >= 7;

  const elevBand = rasters[0];
  const ndviBand = isMultiBand ? rasters[3] : rasters[1];
  const ndmiBand = isMultiBand ? rasters[4] : null;
  const landCoverBand = isMultiBand ? rasters[6] : null;

  if (!elevBand || !ndviBand) throw new Error('TIFF read returned empty bands');

  // Build NDVI RGBA texture + elevation range in one pass.
>>>>>>> Stashed changes
  const rgba = new Uint8ClampedArray(width * height * 4);
  const elevValid = new Uint8Array(width * height);
  let eMin = Infinity;
  let eMax = -Infinity;
<<<<<<< Updated upstream
  for (let i = 0; i < width * height; i++) {
    const e = elev[i];
    const n = ndvi[i];
    const eOk = Number.isFinite(e);
    const nOk = Number.isFinite(n);
    if (eOk) {
=======

  for (let i = 0; i < width * height; i++) {
    const e = elevBand[i];
    const n = ndviBand[i];
    if (Number.isFinite(e)) {
>>>>>>> Stashed changes
      if (e < eMin) eMin = e;
      if (e > eMax) eMax = e;
      elevValid[i] = 1;
    }
<<<<<<< Updated upstream
    if (nOk) {
=======
    if (Number.isFinite(n)) {
>>>>>>> Stashed changes
      const [r, g, b] = rampInterp(n);
      rgba[i * 4] = r;
      rgba[i * 4 + 1] = g;
      rgba[i * 4 + 2] = b;
      rgba[i * 4 + 3] = 255;
    }
<<<<<<< Updated upstream
    // else: alpha stays 0 → loader treats this pixel as no-data
  }

  // Second pass: build a grayscale elevation ImageData (0..255 in red channel).
=======
    // else: alpha stays 0 → treated as no-data
  }

  // Grayscale elevation ImageData for displacement mapping.
>>>>>>> Stashed changes
  const span = eMax > eMin ? eMax - eMin : 1;
  const elevRgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    if (!elevValid[i]) continue;
<<<<<<< Updated upstream
    const v = Math.round(((elev[i] - eMin) / span) * 255);
=======
    const v = Math.round(((elevBand[i] - eMin) / span) * 255);
>>>>>>> Stashed changes
    elevRgba[i * 4] = v;
    elevRgba[i * 4 + 1] = v;
    elevRgba[i * 4 + 2] = v;
    elevRgba[i * 4 + 3] = 255;
  }

  const ndviImageData = new ImageData(rgba, width, height);
  const elevImageData = new ImageData(elevRgba, width, height);
<<<<<<< Updated upstream

  const grid = gridFromImageData(ndviImageData, gridW, gridH);
  const elevation = elevationFromImageData(elevImageData, gridW, gridH);

=======
  const elevation = elevationFromImageData(elevImageData, gridW, gridH);

  // Grid: use multi-band builder when all bands are available, else fall back.
  let grid;
  if (isMultiBand && ndmiBand && landCoverBand) {
    grid = gridFromBands(ndviBand, ndmiBand, landCoverBand, width, height, gridW, gridH);
  } else {
    grid = gridFromImageData(ndviImageData, gridW, gridH);
  }

>>>>>>> Stashed changes
  // Render the NDVI canvas to a blob URL for the 3D terrain texture.
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get 2D canvas context');
  ctx.putImageData(ndviImageData, 0, 0);
  const ndviUrl: string = await new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Failed to encode NDVI canvas to PNG'));
        return;
      }
      resolve(URL.createObjectURL(blob));
    }, 'image/png');
  });

  return {
    ndviUrl,
    grid,
    elevation,
    width,
    height,
    minMeters: Number.isFinite(eMin) ? eMin : 0,
    maxMeters: Number.isFinite(eMax) ? eMax : 0,
  };
}
