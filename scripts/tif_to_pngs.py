"""
Convert bay_ndvi_elev.tif (2-band float32: [elevation_m, ndvi]) into the two
PNGs that simulation-app loads at runtime:

  simulation-app/public/ndvi.png       Sentinel-Hub-style NDVI palette (RGBA)
  simulation-app/public/elevation.png  Grayscale height (R=G=B=height, A=255)

NaN pixels in the source become transparent in ndvi.png (the loader maps
low-alpha pixels to firebreak/no-data) and zero in elevation.png.
"""

import sys
from pathlib import Path

import numpy as np
import tifffile
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
TIF = ROOT / "bay_ndvi_elev.tif"
OUT_DIR = ROOT / "simulation-app" / "public"

# Downsample target. Original is 2773x2397; this keeps detail without bloating
# the bundle and matches what loadFuelFromImage / loadElevationMap need.
TARGET_W = 1100


def block_mean(a: np.ndarray, factor: int) -> np.ndarray:
    """Mean-pool by integer factor, ignoring NaNs."""
    h, w = a.shape[:2]
    h2 = (h // factor) * factor
    w2 = (w // factor) * factor
    a = a[:h2, :w2]
    new_shape = (h2 // factor, factor, w2 // factor, factor) + a.shape[2:]
    return np.nanmean(a.reshape(new_shape), axis=(1, 3))


def ndvi_to_rgb(ndvi: np.ndarray) -> np.ndarray:
    """Sentinel-Hub-default NDVI palette. ndvi in [-1, 1]; out (H,W,3) uint8."""
    # Stops: (ndvi_threshold, RGB)  — interpolate linearly between adjacent stops.
    stops = [
        (-1.0, (5, 24, 82)),       # deep blue (water)
        (-0.2, (50, 90, 160)),     # blue
        (-0.1, (180, 180, 180)),   # gray (bare/cloud)
        (0.0, (200, 170, 120)),    # tan
        (0.1, (210, 140, 60)),     # orange
        (0.2, (245, 200, 60)),     # yellow
        (0.3, (200, 220, 60)),     # yellow-green
        (0.45, (140, 200, 60)),    # bright green
        (0.6, (60, 160, 50)),      # green
        (0.8, (20, 110, 30)),      # dark green
        (1.0, (5, 60, 15)),        # very dark green
    ]
    xs = np.array([s[0] for s in stops])
    cs = np.array([s[1] for s in stops], dtype=np.float32)
    flat = np.clip(ndvi, -1.0, 1.0).reshape(-1)
    idx = np.searchsorted(xs, flat, side="right") - 1
    idx = np.clip(idx, 0, len(stops) - 2)
    x0 = xs[idx]
    x1 = xs[idx + 1]
    t = ((flat - x0) / (x1 - x0)).clip(0, 1)[:, None]
    rgb = cs[idx] * (1 - t) + cs[idx + 1] * t
    return rgb.reshape(*ndvi.shape, 3).astype(np.uint8)


def main() -> None:
    if not TIF.exists():
        sys.exit(f"missing {TIF}")
    arr = tifffile.imread(TIF)
    if arr.ndim != 3 or arr.shape[-1] != 2:
        sys.exit(f"expected (H,W,2), got {arr.shape}")
    elev = arr[..., 0].astype(np.float32)
    ndvi = arr[..., 1].astype(np.float32)

    # Downsample by an integer factor (NaN-aware).
    h0, w0 = elev.shape
    factor = max(1, w0 // TARGET_W)
    if factor > 1:
        elev = block_mean(elev, factor)
        ndvi = block_mean(ndvi, factor)
    h, w = elev.shape
    print(f"output size: {w}x{h} (factor {factor} from {w0}x{h0})")

    valid = ~np.isnan(ndvi)

    # --- NDVI PNG (RGBA, NaN -> alpha 0) ---
    ndvi_filled = np.where(valid, ndvi, 0.0)
    rgb = ndvi_to_rgb(ndvi_filled)
    alpha = np.where(valid, 255, 0).astype(np.uint8)
    rgba = np.dstack([rgb, alpha])
    Image.fromarray(rgba, "RGBA").save(OUT_DIR / "ndvi.png")
    print(f"wrote {OUT_DIR/'ndvi.png'}")

    # --- Elevation PNG (grayscale via R=G=B, NaN -> 0) ---
    e_valid = elev[valid]
    lo = float(np.percentile(e_valid, 1))
    hi = float(np.percentile(e_valid, 99))
    if hi <= lo:
        hi = lo + 1.0
    norm = np.clip((elev - lo) / (hi - lo), 0.0, 1.0)
    norm = np.where(valid, norm, 0.0)
    e8 = (norm * 255).astype(np.uint8)
    e_rgb = np.dstack([e8, e8, e8])
    Image.fromarray(e_rgb, "RGB").save(OUT_DIR / "elevation.png")
    print(f"wrote {OUT_DIR/'elevation.png'}  (elev range ~ {lo:.1f}m .. {hi:.1f}m)")

    # Print aspect so we can update GRID_W/GRID_H if needed.
    print(f"image aspect (w/h): {w/h:.4f}")


if __name__ == "__main__":
    main()
