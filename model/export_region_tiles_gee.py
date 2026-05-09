"""
Export 10-band model input tiles from Google Earth Engine at 100m.

Outputs GeoTIFF tiles in EPSG:4326 with bands:
  0 B2, 1 B3, 2 B4, 3 B8, 4 B11, 5 NDVI, 6 NDMI, 7 slope, 8 temp, 9 wind

This is designed for *large* AOIs (California / Indonesia / East+South Australia)
by tiling the region into overlapping tiles to avoid maxPixels limits and to
enable seam-free mosaicking later.
"""

from __future__ import annotations

import argparse
import os
from dataclasses import dataclass
from typing import Dict, Tuple

import ee
import geemap


@dataclass(frozen=True)
class Region:
    name: str
    bbox: Tuple[float, float, float, float]  # [xmin, ymin, xmax, ymax] lon/lat


REGIONS: Dict[str, Region] = {
    "california": Region("california", (-124.5, 32.5, -114.0, 42.0)),
    "indonesia": Region("indonesia", (95.0, -11.0, 141.0, 6.0)),
    # East + South Australia (includes VIC/NSW/QLD/SA/TAS coastal band; adjust as needed)
    "aus-east-south": Region("aus-east-south", (135.0, -44.5, 155.0, -10.0)),
}


def ensure_ee(project: str | None) -> None:
    try:
        ee.Initialize(project=project)
    except Exception:
        ee.Authenticate()
        ee.Initialize(project=project)


def mask_s2(image: ee.Image) -> ee.Image:
    qa = image.select("QA60")
    cloud = qa.bitwiseAnd(1 << 10).eq(0)
    cirrus = qa.bitwiseAnd(1 << 11).eq(0)
    return image.updateMask(cloud.And(cirrus))


def build_stack(
    aoi: ee.Geometry,
    year: int = 2023,
    s2_cloud_pct: int = 60,
    s2_use_qa_mask: bool = False,
) -> ee.Image:
    s2_coll = (
        ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
        .filterDate(f"{year}-01-01", f"{year}-12-31")
        .filterBounds(aoi)
        .filter(ee.Filter.lte("CLOUDY_PIXEL_PERCENTAGE", s2_cloud_pct))
    )
    if s2_use_qa_mask:
        s2_coll = s2_coll.map(mask_s2)

    s2_coll = s2_coll.select(["B2", "B3", "B4", "B8", "B11"])

    # Some tiles (open ocean, persistent cloud, etc.) can yield an empty collection.
    # median() on an empty collection returns an image with no bands, which breaks select().
    s2 = ee.Image(
        ee.Algorithms.If(
            s2_coll.size().gt(0),
            s2_coll.median(),
            ee.Image.constant([0, 0, 0, 0, 0]).rename(["B2", "B3", "B4", "B8", "B11"]),
        )
    ).toFloat()

    ndvi = s2.normalizedDifference(["B8", "B4"]).rename("NDVI").toFloat()
    ndmi = s2.normalizedDifference(["B8", "B11"]).rename("NDMI").toFloat()

    dem = ee.Image("USGS/SRTMGL1_003").toFloat()
    slope = ee.Terrain.slope(dem).rename("slope").toFloat()

    era5_coll = (
        ee.ImageCollection("ECMWF/ERA5_LAND/DAILY_AGGR")
        .filterDate(f"{year}-01-01", f"{year}-12-31")
        .filterBounds(aoi)
    )

    era5 = ee.Image(
        ee.Algorithms.If(
            era5_coll.size().gt(0),
            era5_coll.median(),
            ee.Image.constant([0, 0, 0]).rename(
                ["temperature_2m", "u_component_of_wind_10m", "v_component_of_wind_10m"]
            ),
        )
    ).toFloat()

    temp = era5.select("temperature_2m").subtract(273.15).rename("temp").toFloat()
    wind = (
        era5.select("u_component_of_wind_10m")
        .hypot(era5.select("v_component_of_wind_10m"))
        .rename("wind")
        .toFloat()
    )

    stack = ee.Image.cat([s2, ndvi, ndmi, slope, temp, wind]).clip(aoi).unmask(0)
    return stack


def deg_for_pixels(px: int, scale_m: int) -> float:
    # crude conversion: 1 deg ~ 111km in latitude
    return (px * scale_m) / 111_000.0


def export_tiles(
    region: Region,
    out_dir: str,
    scale_m: int,
    tile_px: int,
    overlap_px: int,
    year: int,
    start_tile: int = 0,
    max_tiles: int | None = None,
    mode: str = "drive",
    drive_folder: str | None = "rome-2026-tiles",
    s2_cloud_pct: int = 60,
    s2_use_qa_mask: bool = False,
    tag: str = "",
) -> None:
    xmin, ymin, xmax, ymax = region.bbox
    os.makedirs(out_dir, exist_ok=True)

    step_px = max(1, tile_px - overlap_px)
    tile_deg = deg_for_pixels(tile_px, scale_m)
    step_deg = deg_for_pixels(step_px, scale_m)

    # Iterate tiles in lon/lat degrees grid
    y = ymin
    tile_id = 0
    exported = 0
    while y < ymax:
        x = xmin
        y2 = min(y + tile_deg, ymax)
        while x < xmax:
            x2 = min(x + tile_deg, xmax)
            aoi = ee.Geometry.Rectangle([x, y, x2, y2], proj="EPSG:4326", geodesic=False)
            image = build_stack(
                aoi,
                year=year,
                s2_cloud_pct=s2_cloud_pct,
                s2_use_qa_mask=s2_use_qa_mask,
            )
            out_path = os.path.join(out_dir, f"tile_{tile_id:06d}.tif")

            if tile_id >= start_tile:
                if (max_tiles is not None) and (exported >= max_tiles):
                    return

                if mode == "local":
                    if not os.path.exists(out_path):
                        print(f"download tile {tile_id} -> {out_path}")
                        geemap.ee_export_image(
                            ee_object=image,
                            filename=out_path,
                            scale=scale_m,
                            region=aoi,
                            crs="EPSG:4326",
                            file_per_band=False,
                            # geemap direct-download is limited (~50MB); prefer mode=drive for big tiles
                            timeout=300,
                        )
                    else:
                        print(f"skip existing tile {tile_id}")
                elif mode == "drive":
                    suffix = f"_{tag}" if tag else ""
                    desc = f"{region.name}_scale{scale_m}_px{tile_px}_ov{overlap_px}_y{year}_tile{tile_id:06d}{suffix}"
                    print(f"submit drive export {desc}")
                    geemap.ee_export_image_to_drive(
                        image=image,
                        description=desc,
                        folder=drive_folder,
                        fileNamePrefix=desc,
                        scale=scale_m,
                        region=aoi,
                        crs="EPSG:4326",
                        maxPixels=int(1e13),
                        fileFormat="GeoTIFF",
                    )
                else:
                    raise ValueError(f"Unknown mode: {mode}")

                exported += 1

            tile_id += 1
            x += step_deg
        y += step_deg


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", default=None, help="GCP project for Earth Engine (optional)")
    ap.add_argument("--region", required=True, choices=sorted(REGIONS.keys()))
    ap.add_argument("--out", required=True, help="Output directory for tiles")
    ap.add_argument("--scale", type=int, default=100, help="Resolution in meters (default: 100)")
    ap.add_argument("--tile_px", type=int, default=512, help="Tile size in pixels (default: 512)")
    ap.add_argument("--overlap_px", type=int, default=64, help="Tile overlap in pixels (default: 64)")
    ap.add_argument("--year", type=int, default=2023, help="Data year for composites (default: 2023)")
    ap.add_argument("--start_tile", type=int, default=0, help="Start exporting at this tile index (resume)")
    ap.add_argument("--max_tiles", type=int, default=None, help="Export at most N tiles (for testing)")
    ap.add_argument(
        "--s2_cloud_pct",
        type=int,
        default=60,
        help="Max Sentinel-2 CLOUDY_PIXEL_PERCENTAGE (default: 60)",
    )
    ap.add_argument(
        "--s2_use_qa_mask",
        action="store_true",
        help="Apply QA60 pixel cloud mask (slower, cleaner).",
    )
    ap.add_argument(
        "--tag",
        default="",
        help="Optional suffix to make export descriptions unique (e.g. v3test)",
    )
    ap.add_argument(
        "--mode",
        default="drive",
        choices=["drive", "local"],
        help="Export mode: drive submits GEE tasks; local downloads directly (small only)",
    )
    ap.add_argument(
        "--drive_folder",
        default="rome-2026-tiles",
        help="Google Drive folder name for mode=drive",
    )
    args = ap.parse_args()

    ensure_ee(args.project)
    export_tiles(
        region=REGIONS[args.region],
        out_dir=args.out,
        scale_m=args.scale,
        tile_px=args.tile_px,
        overlap_px=args.overlap_px,
        year=args.year,
        start_tile=args.start_tile,
        max_tiles=args.max_tiles,
        mode=args.mode,
        drive_folder=args.drive_folder,
        s2_cloud_pct=args.s2_cloud_pct,
        s2_use_qa_mask=args.s2_use_qa_mask,
        tag=args.tag,
    )


if __name__ == "__main__":
    main()
