# ============================================
# dataset_export_random_gee.py
# ============================================
#
# MPS-FRIENDLY RANDOM PATCH EXPORTER
#
# Exports RANDOM GeoTIFF patches from:
# - California
# - Australia
# - Indonesia
# - Siberia
#
# Features:
# - Sentinel-2 RGB + NIR
# - NDVI
# - DEM
# - Landcover
# - Historical burned mask
#
# Designed for:
# - Apple Silicon MPS
# - Prithvi encoder
# - lightweight training
#
# ============================================

import ee
import geemap
import os
import random

# ============================================
# INIT
# ============================================

PROJECT_ID = 'fire-help-495802'

ee.Initialize(project=PROJECT_ID)

# ============================================
# CONFIG
# ============================================

EXPORT_ROOT = "dataset"

PATCH_SIZE = 128
SCALE = 100

PATCHES_PER_REGION = {
    "california": 0,
    "australia": 100,
    "indonesia": 100,
    "siberia": 100,
}

REGIONS = {
    "california": ee.Geometry.Rectangle(
        [-124.5, 32.5, -114.0, 42.0]
    ),

    "australia": ee.Geometry.Rectangle(
        [113.0, -44.0, 154.0, -10.0]
    ),

    "indonesia": ee.Geometry.Rectangle(
        [95.0, -11.0, 141.0, 6.0]
    ),

    "siberia": ee.Geometry.Rectangle(
        [60.0, 50.0, 160.0, 75.0]
    ),
}

os.makedirs(EXPORT_ROOT, exist_ok=True)

# ============================================
# DATA SOURCES
# ============================================

sentinel = (
    ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
    .filterDate("2023-01-01", "2023-12-31")
)

dem = ee.Image("USGS/SRTMGL1_003").select("elevation")

landcover = (
    ee.ImageCollection("ESA/WorldCover/v200")
    .first()
    .select("Map")
)

fires = (
    ee.ImageCollection("MODIS/061/MCD64A1")
    .filterDate("2020-01-01", "2023-12-31")
)

# ============================================
# CLOUD MASK
# ============================================

def mask_s2(image):

    qa = image.select("QA60")

    cloud = qa.bitwiseAnd(1 << 10).eq(0)
    cirrus = qa.bitwiseAnd(1 << 11).eq(0)

    return image.updateMask(
        cloud.And(cirrus)
    )

# ============================================
# BUILD STACK
# ============================================

def build_stack(region):

    s2 = (
        sentinel
        .filterBounds(region)
        .map(mask_s2)
        .median()
        .select(["B2", "B3", "B4", "B8"])
    )

    ndvi = (
        s2.normalizedDifference(["B8", "B4"])
        .rename("NDVI")
    )

    fire_mask = (
        fires
        .filterBounds(region)
        .select("BurnDate")
        .max()
        .gt(0)
        .rename("burned")
    )

    stacked = ee.Image.cat([
        s2,
        ndvi,
        dem.rename("DEM"),
        landcover.rename("landcover"),
        fire_mask
    ])

    return stacked.clip(region)

# ============================================
# RANDOM PATCH EXPORT
# ============================================

def export_random_patches(region_name, region_geom):

    print(f"\n=== {region_name} ===")

    out_dir = os.path.join(
        EXPORT_ROOT,
        region_name
    )

    os.makedirs(out_dir, exist_ok=True)

    image = build_stack(region_geom)

    bounds = region_geom.bounds().coordinates().getInfo()[0]

    xmin = min(p[0] for p in bounds)
    xmax = max(p[0] for p in bounds)

    ymin = min(p[1] for p in bounds)
    ymax = max(p[1] for p in bounds)

    num_patches = PATCHES_PER_REGION[region_name]

    patch_meters = PATCH_SIZE * SCALE

    approx_deg = patch_meters / 111000

    saved = 0
    attempts = 0

    while saved < num_patches:

        attempts += 1

        lon = random.uniform(xmin, xmax)
        lat = random.uniform(ymin, ymax)

        patch = ee.Geometry.Rectangle([
            lon,
            lat,
            lon + approx_deg,
            lat + approx_deg
        ])

        try:

            out_path = os.path.join(
                out_dir,
                f"patch_{saved}.tif"
            )

            geemap.ee_export_image(
                image,
                filename=out_path,
                scale=SCALE,
                region=patch,
                file_per_band=False
            )

            print(f"saved {saved}")

            saved += 1

        except Exception as e:

            print(e)

            continue

    print(
        f"{region_name}: "
        f"{saved}/{attempts} successful"
    )

# ============================================
# RUN
# ============================================

for name, geom in REGIONS.items():

    export_random_patches(
        name,
        geom
    )

print("\nDONE")