import { fromBlob } from 'geotiff';
import type { Grid } from './fireEngine';
import {
  elevationFromImageData,
  gridFromImageData,
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
  const elev = rasters[0];
  const ndvi = rasters[1];
  if (!elev || !ndvi) throw new Error('TIFF read returned empty bands');

  // First pass: NDVI → RGBA (transparent for NaN/non-finite), tracking elev range.
  const rgba = new Uint8ClampedArray(width * height * 4);
  const elevValid = new Uint8Array(width * height);
  let eMin = Infinity;
  let eMax = -Infinity;
  for (let i = 0; i < width * height; i++) {
    const e = elev[i];
    const n = ndvi[i];
    const eOk = Number.isFinite(e);
    const nOk = Number.isFinite(n);
    if (eOk) {
      if (e < eMin) eMin = e;
      if (e > eMax) eMax = e;
      elevValid[i] = 1;
    }
    if (nOk) {
      const [r, g, b] = rampInterp(n);
      rgba[i * 4] = r;
      rgba[i * 4 + 1] = g;
      rgba[i * 4 + 2] = b;
      rgba[i * 4 + 3] = 255;
    }
    // else: alpha stays 0 → loader treats this pixel as no-data
  }

  // Second pass: build a grayscale elevation ImageData (0..255 in red channel).
  const span = eMax > eMin ? eMax - eMin : 1;
  const elevRgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    if (!elevValid[i]) continue;
    const v = Math.round(((elev[i] - eMin) / span) * 255);
    elevRgba[i * 4] = v;
    elevRgba[i * 4 + 1] = v;
    elevRgba[i * 4 + 2] = v;
    elevRgba[i * 4 + 3] = 255;
  }

  const ndviImageData = new ImageData(rgba, width, height);
  const elevImageData = new ImageData(elevRgba, width, height);

  const grid = gridFromImageData(ndviImageData, gridW, gridH);
  const elevation = elevationFromImageData(elevImageData, gridW, gridH);

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
