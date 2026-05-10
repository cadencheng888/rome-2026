import { fromBlob } from "geotiff";
import type { Grid } from "./fireEngine";
import {
  elevationFromFloat32,
  elevationFromImageData,
  gridFromImageData,
  gridFromBands,
} from "./satelliteLoader";

export interface TiffTile {
  ndviUrl: string; // blob URL of the colorized NDVI canvas
  grid: Grid;
  elevation: number[][];
  width: number;
  height: number;
  minMeters: number;
  maxMeters: number;
}

/**
 * Natural earth satellite palette. Blue = water, tan/brown = bare soil,
 * yellow-green = grassland/scrub, dark green = dense forest.
 */
const NDVI_RAMP: Array<[number, number, number, number]> = [
  [-1.0, 15, 55, 130],
  [-0.2, 80, 90, 100],
  [0.0, 170, 150, 90],
  [0.15, 155, 160, 85],
  [0.3, 120, 155, 65],
  [0.45, 85, 140, 55],
  [0.6, 55, 115, 40],
  [0.75, 30, 90, 30],
  [0.9, 18, 65, 22],
  [1.0, 10, 45, 15],
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

  // 7-band format: B0=Elevation, B1=Slope, B2=Aspect, B3=NDVI, B4=NDMI, B5=NBR, B6=LandCover
  // Legacy 2-band format: B0=Elevation, B1=NDVI
  const isMultiBand = samplesPerPixel >= 7;

  const elevBand = rasters[0];
  const slopeBand = isMultiBand ? rasters[1] : null; // degrees
  const aspectBand = isMultiBand ? rasters[2] : null; // degrees 0-360
  const ndviBand = isMultiBand ? rasters[3] : rasters[1];
  const ndmiBand = isMultiBand ? rasters[4] : null;
  const landCoverBand = isMultiBand ? rasters[6] : null;

  if (!elevBand || !ndviBand) throw new Error("TIFF read returned empty bands");

  // -------------------------------------------------------------------------
  // Single pass: build NDVI RGBA texture and compute elevation range.
  // -------------------------------------------------------------------------
  const rgba = new Uint8ClampedArray(width * height * 4);
  let eMin = Infinity;
  let eMax = -Infinity;

  for (let i = 0; i < width * height; i++) {
    const e = elevBand[i];
    const n = ndviBand[i];

    if (Number.isFinite(e)) {
      if (e < eMin) eMin = e;
      if (e > eMax) eMax = e;
    }

    if (Number.isFinite(n)) {
      const [r, g, b] = rampInterp(n);
      rgba[i * 4] = r;
      rgba[i * 4 + 1] = g;
      rgba[i * 4 + 2] = b;
      rgba[i * 4 + 3] = 255;
    }
    // else alpha stays 0 → treated as no-data
  }

  const ndviImageData = new ImageData(rgba, width, height);

  // -------------------------------------------------------------------------
  // Elevation grid — direct from float32 band (no 8-bit round-trip).
  //
  // The old approach converted elevation to an 8-bit grayscale ImageData and
  // read it back. That quantizes a potentially >1000m elevation range into
  // 256 steps (~4m per step for a 1000m span), introducing banding in the
  // displacement map and coarsening the slope model. We now normalize directly
  // from the float band, preserving full sub-meter precision.
  // -------------------------------------------------------------------------
  const elevation = elevationFromFloat32(
    elevBand,
    width,
    height,
    gridW,
    gridH,
    eMin,
    eMax
  );

  // -------------------------------------------------------------------------
  // Fire grid — multi-band path now forwards slope and aspect bands.
  // Previously gridFromBands only received ndvi, ndmi, landCover, so
  // slope and aspect were silently dropped and every cell got slope=0,
  // aspect=0. This meant the fire engine's slope model was always inactive
  // for real-terrain TIFFs.
  // -------------------------------------------------------------------------
  let grid: Grid;
  if (isMultiBand && ndmiBand && landCoverBand && slopeBand && aspectBand) {
    grid = gridFromBands(
      ndviBand,
      ndmiBand,
      landCoverBand,
      slopeBand,
      aspectBand,
      width,
      height,
      gridW,
      gridH
    );
  } else {
    // Legacy 2-band fallback: no slope/aspect data available.
    grid = gridFromImageData(ndviImageData, gridW, gridH);
  }

  // -------------------------------------------------------------------------
  // Render NDVI canvas → blob URL for 3D terrain texture.
  // -------------------------------------------------------------------------
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get 2D canvas context");
  ctx.putImageData(ndviImageData, 0, 0);

  const ndviUrl: string = await new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Failed to encode NDVI canvas to PNG"));
        return;
      }
      resolve(URL.createObjectURL(blob));
    }, "image/png");
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
