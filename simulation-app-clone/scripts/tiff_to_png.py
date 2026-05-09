#!/usr/bin/env python3
"""
Convert a 2-band float GeoTIFF (band 0 = elevation in meters, band 1 = NDVI in
[-1, 1]) into the two PNGs the simulation app loads from /public:

    public/ndvi.png       — NDVI colorized in a Sentinel-style palette
    public/elevation.png  — grayscale heightmap (red channel = height)
    public/elevation.json — { minMeters, maxMeters, width, height }

NaN pixels (outside the footprint) become transparent in the NDVI output and
black in the elevation output, which is what satelliteLoader.ts already
treats as "no data / firebreak".

Usage:
    python scripts/tiff_to_png.py path/to/file.tif
    python scripts/tiff_to_png.py path/to/file.tif --out simulation-app/public
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np
import tifffile
from PIL import Image


# Fire-risk NDVI ramp. Red = high NDVI = dense canopy = high fuel = high fire
# susceptibility. Green = low NDVI = sparse / bare = low fuel. Blue = water.
# Mirror of NDVI_RAMP in src/tiffLoader.ts and inverse of colorToFuel.
NDVI_RAMP = [
    (-1.00,  20,  40,  90),   # deep blue   — water / very negative
    (-0.20,  60, 100, 160),   # blue        — water edge
    ( 0.00,  90, 200,  90),   # green       — bare / sparse (low fuel)
    ( 0.15, 150, 220,  85),   # light green
    ( 0.30, 220, 220,  80),   # yellow
    ( 0.45, 245, 180,  70),   # yellow-orange
    ( 0.60, 245, 130,  60),   # orange
    ( 0.75, 230,  80,  50),   # red-orange
    ( 0.90, 200,  40,  40),   # red
    ( 1.00, 130,  20,  20),   # dark red    — dense canopy (extreme fuel)
]


def ndvi_to_rgb(ndvi: np.ndarray) -> np.ndarray:
    """Map an NDVI float array to an (H, W, 3) uint8 RGB array."""
    stops = np.array([s[0] for s in NDVI_RAMP])
    rs = np.array([s[1] for s in NDVI_RAMP], dtype=np.float32)
    gs = np.array([s[2] for s in NDVI_RAMP], dtype=np.float32)
    bs = np.array([s[3] for s in NDVI_RAMP], dtype=np.float32)
    n = np.clip(ndvi, -1.0, 1.0)
    r = np.interp(n, stops, rs)
    g = np.interp(n, stops, gs)
    b = np.interp(n, stops, bs)
    return np.stack([r, g, b], axis=-1).astype(np.uint8)


def convert(tiff_path: Path, out_dir: Path) -> None:
    arr = tifffile.imread(tiff_path)
    if arr.ndim != 3 or arr.shape[-1] != 2:
        sys.exit(f"expected (H, W, 2) float TIFF, got shape {arr.shape}")

    elev = arr[..., 0].astype(np.float32)
    ndvi = arr[..., 1].astype(np.float32)
    h, w = elev.shape

    valid = np.isfinite(elev) & np.isfinite(ndvi)
    print(f"  size:      {w}×{h}")
    print(f"  valid:     {valid.sum():,} / {valid.size:,} px ({100 * valid.mean():.1f}%)")
    if valid.any():
        print(f"  elevation: {elev[valid].min():.1f} – {elev[valid].max():.1f} m")
        print(f"  ndvi:      {ndvi[valid].min():+.3f} – {ndvi[valid].max():+.3f}")

    # --- NDVI PNG (RGBA so NaN can be transparent) ---
    rgb = ndvi_to_rgb(np.where(valid, ndvi, 0.0))
    alpha = np.where(valid, 255, 0).astype(np.uint8)
    rgba = np.dstack([rgb, alpha])
    ndvi_path = out_dir / "ndvi.png"
    Image.fromarray(rgba, mode="RGBA").save(ndvi_path, optimize=True)
    print(f"  wrote      {ndvi_path}")

    # --- Elevation PNG (grayscale, NaN → 0 = same convention as bay_ndvi_elev) ---
    e_min = float(elev[valid].min()) if valid.any() else 0.0
    e_max = float(elev[valid].max()) if valid.any() else 1.0
    span = max(e_max - e_min, 1e-6)
    norm = np.where(valid, (elev - e_min) / span, 0.0)
    gray = (np.clip(norm, 0, 1) * 255).astype(np.uint8)
    elev_path = out_dir / "elevation.png"
    Image.fromarray(gray, mode="L").save(elev_path, optimize=True)
    print(f"  wrote      {elev_path}")

    # --- elevation.json (consumed by App.tsx if you want real meters anywhere) ---
    meta = {"minMeters": e_min, "maxMeters": e_max, "width": w, "height": h}
    meta_path = out_dir / "elevation.json"
    meta_path.write_text(json.dumps(meta, indent=2) + "\n")
    print(f"  wrote      {meta_path}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("tiff", type=Path, help="path to a 2-band (elevation, NDVI) float GeoTIFF")
    ap.add_argument(
        "--out",
        type=Path,
        default=Path(__file__).resolve().parent.parent / "public",
        help="output directory (default: ../public)",
    )
    args = ap.parse_args()

    if not args.tiff.exists():
        sys.exit(f"no such file: {args.tiff}")
    args.out.mkdir(parents=True, exist_ok=True)

    print(f"converting {args.tiff} → {args.out}")
    convert(args.tiff, args.out)


if __name__ == "__main__":
    main()
