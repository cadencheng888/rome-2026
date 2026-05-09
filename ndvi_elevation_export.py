"""
NDVI + Elevation GeoTIFF Exporter
----------------------------------
Exports a multi-band GeoTIFF (Band 1 = Elevation, Band 2 = NDVI)
for a given location using Google Earth Engine.

Requirements:
    pip install earthengine-api geemap

Authentication (first time only):
    earthengine authenticate

Usage:
    python ndvi_elevation_export.py

Or import and call export_ndvi_elevation() directly.
"""

import ee
import os
import time
import argparse


def authenticate(project=None):
    """Authenticate with Google Earth Engine (first time only)."""
    try:
        ee.Initialize(project=project)
    except Exception:
        ee.Authenticate()
        ee.Initialize(project=project)


def export_ndvi_elevation(
    name,
    lat,
    lon,
    buffer_km=25,
    start_date="2024-06-01",
    end_date="2024-09-30",
    scale=30,
    output_dir="./outputs",
    cloud_threshold=10,
    project=None,
):
    """
    Export a GeoTIFF with Elevation (Band 1) and NDVI (Band 2).

    Args:
        name          (str):   Location name, used for output filename
        lat           (float): Latitude of center point
        lon           (float): Longitude of center point
        buffer_km     (float): Radius in km around the center point
        start_date    (str):   Start date for Sentinel-2 imagery (YYYY-MM-DD)
        end_date      (str):   End date for Sentinel-2 imagery (YYYY-MM-DD)
        scale         (int):   Pixel resolution in meters (10, 20, or 30)
        output_dir    (str):   Local directory to save the GeoTIFF
        cloud_threshold (int): Max cloud cover % for Sentinel-2 images

    Returns:
        str: Path to the downloaded GeoTIFF file
    """
    authenticate(project=project)

    os.makedirs(output_dir, exist_ok=True)

    # Define area of interest
    center = ee.Geometry.Point([lon, lat])
    aoi = center.buffer(buffer_km * 1000)  # buffer in meters

    print(f"📍 Location:    {name} ({lat}, {lon})")
    print(f"📐 Buffer:      {buffer_km} km radius")
    print(f"📅 Date range:  {start_date} → {end_date}")
    print(f"🔍 Resolution:  {scale}m per pixel")

    # --- Elevation ---
    dem = (
        ee.Image("USGS/SRTMGL1_003")
        .toFloat()
        .rename("Elevation")
    )

    # --- NDVI from Sentinel-2 ---
    s2 = (
        ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
        .filterDate(start_date, end_date)
        .filterBounds(aoi)
        .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", cloud_threshold))
        .median()
    )

    ndvi = (
        s2.normalizedDifference(["B8", "B4"])
        .toFloat()
        .rename("NDVI")
    )

    # --- Combine bands ---
    combined = dem.addBands(ndvi).clip(aoi)

    # --- Export to Google Drive ---
    safe_name = name.replace(" ", "_")
    task_description = f"{safe_name}_NDVI_Elevation"

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
            print(f"   Find your file in Google Drive → GEE_Exports/{task_description}.tif")
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
        description="Export NDVI + Elevation GeoTIFF from Google Earth Engine"
    )
    parser.add_argument("--project",    required=True,           help="Google Cloud project ID")
    parser.add_argument("--name",       required=True,           help="Location name (used in filename)")
    parser.add_argument("--lat",        required=True, type=float, help="Latitude")
    parser.add_argument("--lon",        required=True, type=float, help="Longitude")
    parser.add_argument("--buffer",     default=10,    type=float, help="Buffer radius in km (default: 10)")
    parser.add_argument("--start",      default="2024-06-01",    help="Start date YYYY-MM-DD (default: 2024-06-01)")
    parser.add_argument("--end",        default="2024-09-30",    help="End date YYYY-MM-DD (default: 2024-09-30)")
    parser.add_argument("--scale",      default=30,    type=int,  help="Resolution in meters (default: 30)")
    parser.add_argument("--output-dir", default="./outputs",     help="Local output directory (default: ./outputs)")
    parser.add_argument("--cloud",      default=10,    type=int,  help="Max cloud %% for Sentinel-2 (default: 10)")

    args = parser.parse_args()

    export_ndvi_elevation(
        name=args.name,
        lat=args.lat,
        lon=args.lon,
        buffer_km=args.buffer,
        start_date=args.start,
        end_date=args.end,
        scale=args.scale,
        output_dir=args.output_dir,
        cloud_threshold=args.cloud,
        project=args.project,
    )


if __name__ == "__main__":
    main()