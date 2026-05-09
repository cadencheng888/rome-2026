# ============================================
# dataset_export_v4_weather.py
# ============================================
#
# GLOBAL PRESCRIBED-BURN SUITABILITY DATASET
#
# Features:
# - Sentinel-2 RGB + NIR + SWIR
# - NDVI
# - NDMI
# - Slope
# - Temperature
# - Wind speed
#
# Target:
# - ecological + operational
#   burn suitability heatmap
#
# MPS-friendly
#
# ============================================

import ee
import geemap
import os
import random

# ============================================
# INIT
# ============================================

PROJECT = 'fire-help-495802'

ee.Initialize(project=PROJECT)

# ============================================
# CONFIG
# ============================================

EXPORT_ROOT = "dataset_v4"

PATCH_SIZE = 128
SCALE = 100

PATCHES_PER_REGION = 100

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

    # "siberia": ee.Geometry.Rectangle(
    #     [60.0, 50.0, 160.0, 75.0]
    # ),
}

os.makedirs(EXPORT_ROOT, exist_ok=True)

# ============================================
# DATA SOURCES
# ============================================

sentinel = (
    ee.ImageCollection(
        "COPERNICUS/S2_SR_HARMONIZED"
    )
    .filterDate(
        "2023-01-01",
        "2023-12-31"
    )
)

dem = ee.Image(
    "USGS/SRTMGL1_003"
)

era5 = (
    ee.ImageCollection(
        "ECMWF/ERA5_LAND/DAILY_AGGR"
    )
    .filterDate(
        "2023-01-01",
        "2023-12-31"
    )
)

# ============================================
# CLOUD MASK
# ============================================

def mask_s2(image):

    qa = image.select("QA60")

    cloud = qa.bitwiseAnd(
        1 << 10
    ).eq(0)

    cirrus = qa.bitwiseAnd(
        1 << 11
    ).eq(0)

    return image.updateMask(
        cloud.And(cirrus)
    )

# ============================================
# BUILD STACK
# ============================================

def build_stack(region):

    # ========================================
    # SENTINEL
    # ========================================

    s2 = (
        sentinel
        .filterBounds(region)
        .map(mask_s2)
        .median()
        .select([
            "B2",   # blue
            "B3",   # green
            "B4",   # red
            "B8",   # nir
            "B11"   # swir
        ])
    )

    # ========================================
    # NDVI
    # ========================================

    ndvi = (
        s2.normalizedDifference(
            ["B8", "B4"]
        )
        .rename("NDVI")
    )

    # ========================================
    # NDMI
    # ========================================

    ndmi = (
        s2.normalizedDifference(
            ["B8", "B11"]
        )
        .rename("NDMI")
    )

    # ========================================
    # SLOPE
    # ========================================

    slope = (
        ee.Terrain.slope(dem)
        .rename("slope")
    )

    # ========================================
    # WEATHER
    # ========================================

    weather = (
        era5
        .filterBounds(region)
        .median()
    )

    # Kelvin -> Celsius
    temp = (
        weather.select(
            "temperature_2m"
        )
        .subtract(273.15)
        .rename("temp")
    )

    # wind speed magnitude
    wind = (
        weather.select(
            "u_component_of_wind_10m"
        )
        .hypot(
            weather.select(
                "v_component_of_wind_10m"
            )
        )
        .rename("wind")
    )

    # ========================================
    # ECOLOGICAL SUITABILITY
    # ========================================

    # vegetation / biomass
    veg_score = (
        ndvi.clamp(0,1)
    )

    # dryness proxy
    # lower NDMI = drier
    dryness_score = (
        ee.Image(1)
        .subtract(
            ndmi.clamp(0,1)
        )
    )

    # flatter terrain safer
    slope_score = (
        ee.Image(1)
        .subtract(
            slope.divide(45)
        )
    ).clamp(0,1)

    # moderate wind useful
    wind_score = (
        wind.divide(8)
    ).clamp(0,1)

    # hotter temps dry fuels
    temp_score = (
        temp.subtract(10)
        .divide(25)
    ).clamp(0,1)

    # ========================================
    # FINAL SUITABILITY
    # ========================================

    suitability = (

        veg_score.multiply(0.35)

        .add(
            dryness_score.multiply(0.30)
        )

        .add(
            slope_score.multiply(0.10)
        )

        .add(
            wind_score.multiply(0.15)
        )

        .add(
            temp_score.multiply(0.10)
        )

    ).rename("suitability")

    # ========================================
    # STACK
    # ========================================

    stack = ee.Image.cat([

        s2,

        ndvi,
        ndmi,

        slope,

        temp,
        wind,

        suitability

    ])

    return (
        stack
        .clip(region)
        .unmask(0)
    )

# ============================================
# EXPORT RANDOM PATCHES
# ============================================

def export_region(name, region):

    print(f"\n=== {name} ===")

    outdir = os.path.join(
        EXPORT_ROOT,
        name
    )

    os.makedirs(outdir, exist_ok=True)

    image = build_stack(region)

    bounds = (
        region.bounds()
        .coordinates()
        .getInfo()[0]
    )

    xmin = min(p[0] for p in bounds)
    xmax = max(p[0] for p in bounds)

    ymin = min(p[1] for p in bounds)
    ymax = max(p[1] for p in bounds)

    saved = 0
    attempts = 0

    while saved < PATCHES_PER_REGION:

        attempts += 1

        lon = random.uniform(
            xmin,
            xmax
        )

        lat = random.uniform(
            ymin,
            ymax
        )

        deg = (
            PATCH_SIZE * SCALE
        ) / 111000

        patch = ee.Geometry.Rectangle([
            lon,
            lat,
            lon + deg,
            lat + deg
        ])

        try:

            stats = (
                image.select("NDVI")
                .reduceRegion(
                    reducer=ee.Reducer.mean(),
                    geometry=patch,
                    scale=SCALE,
                    maxPixels=1e8
                )
                .getInfo()
            )

            if stats["NDVI"] is None:
                continue

            # reject barren regions
            if stats["NDVI"] < 0.2:
                continue

            outpath = os.path.join(
                outdir,
                f"{saved}.tif"
            )

            geemap.ee_export_image(
                image,
                filename=outpath,
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
        f"{name}: "
        f"{saved}/{attempts}"
    )

# ============================================
# RUN
# ============================================

for name, geom in REGIONS.items():

    export_region(
        name,
        geom
    )

print("\nDONE")