"""
Controlled Burn Optimizer — GeoTIFF Exporter
---------------------------------------------
Exports a 7-band GeoTIFF from Google Earth Engine for use in a
controlled burn optimizer / wildfire simulator.

Band Stack:
    Band 1 — Elevation    (meters, SRTM)
    Band 2 — Slope        (degrees, derived from DEM)
    Band 3 — Aspect       (degrees 0–360, derived from DEM)
    Band 4 — NDVI         (−1 to 1, fuel density/load)
    Band 5 — NDMI         (−1 to 1, fuel moisture — lower = drier = higher risk)
    Band 6 — NBR          (−1 to 1, pre-burn baseline; diff post-burn for severity)
    Band 7 — Land Cover   (NLCD class integer, resampled to float)

Requirements:
    pip install earthengine-api geemap

Authentication (first time only):
    earthengine authenticate

Usage:
    python burn_optimizer_export.py \\
        --project your-gcp-project \\
        --name "Los_Padres" \\
        --lat 34.8 \\
        --lon -119.8 \\
        --side 50
"""

import ee
import os
import time
import argparse


# ---------------------------------------------------------------------------
# NLCD Land Cover class reference (Band 7)
# ---------------------------------------------------------------------------
# 11  — Open Water
# 21  — Developed, Open Space
# 22  — Developed, Low Intensity
# 23  — Developed, Medium Intensity
# 24  — Developed, High Intensity
# 31  — Barren Land
# 41  — Deciduous Forest       ← crown fire risk
# 42  — Evergreen Forest       ← crown fire risk, high resin content
# 43  — Mixed Forest
# 52  — Shrub/Scrub            ← high fire risk, fast spread
# 71  — Herbaceous/Grassland   ← fastest spread, high cure rate
# 81  — Hay/Pasture
# 82  — Cultivated Crops
# 90  — Woody Wetlands
# 95  — Emergent Herbaceous Wetlands


def authenticate(project=None):
    """Authenticate with Google Earth Engine (first time only)."""
    try:
        ee.Initialize(project=project)
    except Exception:
        ee.Authenticate()
        ee.Initialize(project=project)


def export_burn_optimizer(
    name,
    lat,
    lon,
    side_km=50,
    start_date="2024-06-01",
    end_date="2024-09-30",
    scale=30,
    output_dir="./outputs",
    cloud_threshold=10,
    project=None,
):
    """
    Export a 7-band GeoTIFF optimized for controlled burn planning.

    Bands:
        1 — Elevation   (m)
        2 — Slope       (degrees)
        3 — Aspect      (degrees, 0=N, 90=E, 180=S, 270=W)
        4 — NDVI        (fuel density)
        5 — NDMI        (fuel moisture)
        6 — NBR         (pre-burn baseline)
        7 — Land Cover  (NLCD 2021 class)

    Args:
        name             (str):   Location name, used for output filename
        lat              (float): Latitude of center point
        lon              (float): Longitude of center point
        side_km          (float): Side length in km of the square AOI
        start_date       (str):   Start date for Sentinel-2 (YYYY-MM-DD)
        end_date         (str):   End date for Sentinel-2 (YYYY-MM-DD)
        scale            (int):   Pixel resolution in meters (10, 20, or 30)
        output_dir       (str):   Local directory to save the GeoTIFF
        cloud_threshold  (int):   Max cloud cover % for Sentinel-2 images
        project          (str):   Google Cloud project ID

    Returns:
        str: GEE task description / filename prefix
    """
    authenticate(project=project)
    os.makedirs(output_dir, exist_ok=True)

    # --- Area of Interest ---
    half_deg = (side_km / 2) / 111.0
    aoi = ee.Geometry.Rectangle([
        lon - half_deg, lat - half_deg,
        lon + half_deg, lat + half_deg
    ])

    print(f"📍 Location:    {name} ({lat}, {lon})")
    print(f"📐 Area:        {side_km} km × {side_km} km square")
    print(f"📅 Date range:  {start_date} → {end_date}")
    print(f"🔍 Resolution:  {scale}m per pixel")
    print(f"\n🛰️  Building band stack...")

    # -----------------------------------------------------------------------
    # Band 1 — Elevation
    # Band 2 — Slope        (degrees)
    # Band 3 — Aspect       (degrees 0–360)
    # All derived from SRTM DEM
    # -----------------------------------------------------------------------
    dem = ee.Image("USGS/SRTMGL1_003").toFloat()
    terrain = ee.Terrain.products(dem)

    elevation = dem.rename("Elevation")
    slope     = terrain.select("slope").toFloat().rename("Slope")
    aspect    = terrain.select("aspect").toFloat().rename("Aspect")

    print("   ✓ Elevation, Slope, Aspect  (SRTM DEM)")

    # -----------------------------------------------------------------------
    # Sentinel-2 median composite for vegetation indices
    # -----------------------------------------------------------------------
    s2 = (
        ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
        .filterDate(start_date, end_date)
        .filterBounds(aoi)
        .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", cloud_threshold))
        .median()
    )

    # Band 4 — NDVI: (B8 - B4) / (B8 + B4)
    # High = dense healthy vegetation (more fuel)
    # Low  = sparse / stressed vegetation
    ndvi = (
        s2.normalizedDifference(["B8", "B4"])
        .toFloat()
        .rename("NDVI")
    )
    print("   ✓ NDVI  — fuel density  (Sentinel-2 B8/B4)")

    # Band 5 — NDMI: (B8 - B11) / (B8 + B11)
    # High = moist vegetation (lower fire risk)
    # Low  = dry vegetation  (higher fire risk / burn-ready)
    ndmi = (
        s2.normalizedDifference(["B8", "B11"])
        .toFloat()
        .rename("NDMI")
    )
    print("   ✓ NDMI  — fuel moisture (Sentinel-2 B8/B11)")

    # Band 6 — NBR: (B8 - B12) / (B8 + B12)
    # Pre-burn baseline; subtract post-burn NBR to get dNBR (burn severity)
    # Also identifies already-stressed / recently burned areas
    nbr = (
        s2.normalizedDifference(["B8", "B12"])
        .toFloat()
        .rename("NBR")
    )
    print("   ✓ NBR   — pre-burn baseline (Sentinel-2 B8/B12)")

    # Band 7 — Land Cover (NLCD 2021)
    # Differentiates fuel types: grass (71), shrub (52), forest (41/42/43), etc.
    # See NLCD class reference at the top of this file.
    nlcd = (
        ee.ImageCollection("USGS/NLCD_RELEASES/2021_REL/NLCD")
        .first()
        .select("landcover")
        .toFloat()
        .rename("LandCover")
    )
    print("   ✓ Land Cover — fuel type (NLCD 2021)")

    # -----------------------------------------------------------------------
    # Combine all 7 bands and clip to AOI
    # -----------------------------------------------------------------------
    combined = (
        elevation
        .addBands(slope)
        .addBands(aspect)
        .addBands(ndvi)
        .addBands(ndmi)
        .addBands(nbr)
        .addBands(nlcd)
        .clip(aoi)
    )

    # -----------------------------------------------------------------------
    # Export to Google Drive
    # -----------------------------------------------------------------------
    safe_name = name.replace(" ", "_")
    task_description = f"{safe_name}"

    print(f"\n⬆️  Submitting export task to Google Drive...")

    task = ee.batch.Export.image.toDrive(
        image=combined,
        description=task_description,
        folder="GEE_Exports",
        fileNamePrefix=task_description,
        scale=scale,
        region=aoi,
        crs="EPSG:4326",
        maxPixels=int(1e13),
        fileFormat="GeoTIFF",
    )

    task.start()
    print(f"✅ Task submitted: {task_description}")
    print(f"   Task ID: {task.id}")

    # --- Poll until complete ---
    print("\n⏳ Waiting for export to complete...")
    while True:
        status = task.status()
        state = status["state"]

        if state == "COMPLETED":
            print("✅ Export complete!")
            print(f"   File: Google Drive → GEE_Exports/{task_description}.tif")
            print(f"\n📦 Band reference:")
            print(f"   Band 1 — Elevation   (meters)")
            print(f"   Band 2 — Slope       (degrees)")
            print(f"   Band 3 — Aspect      (degrees, 0=N 90=E 180=S 270=W)")
            print(f"   Band 4 — NDVI        (-1 to 1, fuel density)")
            print(f"   Band 5 — NDMI        (-1 to 1, fuel moisture)")
            print(f"   Band 6 — NBR         (-1 to 1, pre-burn baseline)")
            print(f"   Band 7 — Land Cover  (NLCD 2021 class integer)")
            break
        elif state == "FAILED":
            print(f"❌ Export failed: {status.get('error_message', 'Unknown error')}")
            break
        elif state in ("READY", "RUNNING"):
            print(f"   Status: {state}... (checking again in 15s)")
            time.sleep(15)
        else:
            print(f"   Status: {state}")
            time.sleep(15)

    return task_description


# ---------------------------------------------------------------------------
# CLI interface
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Export 7-band controlled burn optimizer GeoTIFF from Google Earth Engine"
    )
    parser.add_argument("--project",    required=True,             help="Google Cloud project ID")
    parser.add_argument("--name",       required=True,             help="Location name (used in filename)")
    parser.add_argument("--lat",        required=True, type=float, help="Latitude of center point")
    parser.add_argument("--lon",        required=True, type=float, help="Longitude of center point")
    parser.add_argument("--side",       default=25,    type=float, help="Side length of square AOI in km (default: 25)")
    parser.add_argument("--start",      default="2024-06-01",      help="Start date YYYY-MM-DD (default: 2024-06-01)")
    parser.add_argument("--end",        default="2024-09-30",      help="End date YYYY-MM-DD (default: 2024-09-30)")
    parser.add_argument("--scale",      default=30,    type=int,   help="Resolution in meters (default: 30)")
    parser.add_argument("--output-dir", default="./outputs",       help="Local output directory (default: ./outputs)")
    parser.add_argument("--cloud",      default=10,    type=int,   help="Max cloud %% for Sentinel-2 (default: 10)")

    args = parser.parse_args()

    export_burn_optimizer(
        name=args.name,
        lat=args.lat,
        lon=args.lon,
        side_km=args.side,
        start_date=args.start,
        end_date=args.end,
        scale=args.scale,
        output_dir=args.output_dir,
        cloud_threshold=args.cloud,
        project=args.project,
    )


if __name__ == "__main__":
    main()