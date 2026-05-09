"""
Convert a suitability GeoTIFF into a GeoJSON polygon overlay for the globe.

This extracts contiguous "burn suitable" regions (thresholded raster),
filters tiny components, and emits GeoJSON features in EPSG:4326.
"""

from __future__ import annotations

import argparse
import json
from typing import Any, Dict

import numpy as np
import rasterio
from rasterio.features import shapes


def feature_collection(features: list[Dict[str, Any]]) -> Dict[str, Any]:
    return {"type": "FeatureCollection", "features": features}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True, help="Input suitability GeoTIFF (1 band)")
    ap.add_argument("--output", required=True, help="Output GeoJSON path")
    ap.add_argument("--threshold", type=float, required=True, help="Suitability threshold (e.g. 0.50)")
    ap.add_argument("--min_pixels", type=int, default=200, help="Filter out tiny regions")
    ap.add_argument("--simplify", type=float, default=0.0, help="(reserved) simplify tolerance in degrees")
    args = ap.parse_args()

    with rasterio.open(args.input) as src:
        if src.count != 1:
            raise ValueError(f"Expected 1-band suitability raster; got {src.count} bands")
        if (src.crs is not None) and (str(src.crs).upper() not in ("EPSG:4326", "WGS84")):
            # Globe overlay expects lon/lat. We keep it strict to avoid subtle mistakes.
            raise ValueError(f"Expected EPSG:4326 input for globe overlay; got {src.crs}")

        arr = src.read(1).astype(np.float32)
        transform = src.transform

    mask = arr >= float(args.threshold)

    feats: list[Dict[str, Any]] = []
    # shapes() yields geojson geom + value; we pass mask so only True pixels contribute
    for geom, value in shapes(arr, mask=mask, transform=transform):
        if value < args.threshold:
            continue
        # crude pixel-count filtering without full connected-components:
        # estimate area by rasterizing bbox footprint (fast), good enough for removing speckles
        # We'll approximate with polygon's bbox area in pixels using transform scale.
        coords = geom.get("coordinates")
        if not coords:
            continue
        # bbox from coordinates
        flat = []
        for ring in coords:
            flat.extend(ring)
        xs = [p[0] for p in flat]
        ys = [p[1] for p in flat]
        if not xs or not ys:
            continue
        minx, maxx = min(xs), max(xs)
        miny, maxy = min(ys), max(ys)
        px_w = abs(transform.a) if transform.a != 0 else 1e-9
        px_h = abs(transform.e) if transform.e != 0 else 1e-9
        approx_pixels = int(((maxx - minx) / px_w) * ((maxy - miny) / px_h))
        if approx_pixels < args.min_pixels:
            continue

        feats.append(
            {
                "type": "Feature",
                "properties": {
                    "threshold": float(args.threshold),
                },
                "geometry": geom,
            }
        )

    out = feature_collection(feats)
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(out, f)


if __name__ == "__main__":
    main()
