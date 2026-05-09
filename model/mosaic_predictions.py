"""
Mosaic many predicted suitability tiles into one seamless raster.

This uses mean blending in overlap areas, which produces seam-free results
when tiles have sufficient overlap.
"""

from __future__ import annotations

import argparse
import glob
import os
from typing import List

import numpy as np
import rasterio
from rasterio.merge import merge


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--inputs", required=True, help="Glob pattern or directory of predicted .tif tiles")
    ap.add_argument("--output", required=True, help="Output mosaic GeoTIFF (1 band)")
    ap.add_argument("--compress", default="deflate", choices=["deflate", "lzw", "none"])
    args = ap.parse_args()

    pattern = args.inputs
    if os.path.isdir(pattern):
        pattern = os.path.join(pattern, "*.tif")

    paths = sorted(glob.glob(pattern))
    if not paths:
        raise SystemExit(f"No inputs matched: {args.inputs}")

    srcs: List[rasterio.io.DatasetReader] = []
    try:
        for p in paths:
            srcs.append(rasterio.open(p))

        mosaic, transform = merge(srcs, method="mean")  # [1,H,W]
        out = mosaic[0].astype(np.float32, copy=False)

        profile = srcs[0].profile.copy()
        profile.update(
            count=1,
            dtype="float32",
            transform=transform,
            height=out.shape[0],
            width=out.shape[1],
            nodata=None,
        )
        if args.compress != "none":
            profile.update(compress=args.compress, predictor=3)

        with rasterio.open(args.output, "w", **profile) as dst:
            dst.write(out, 1)
    finally:
        for s in srcs:
            try:
                s.close()
            except Exception:
                pass


if __name__ == "__main__":
    main()
