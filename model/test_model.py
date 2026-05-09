# ============================================
# test_burn_candidates_any_tif.py
# ============================================
#
# Works with:
# - any single TIFF path
# - random TIFF from folder
#
# Supports:
# - arbitrary TIFF size
# - automatic resizing
# - burn candidate filtering
#
# ============================================

import argparse

import rasterio
import numpy as np
import matplotlib.pyplot as plt
import torch

from skimage.measure import label
from skimage.transform import resize

from train import BurnUNet

# ============================================
# DEVICE
# ============================================

DEVICE = (
    "mps"
    if torch.backends.mps.is_available()
    else "cpu"
)

print("DEVICE:", DEVICE)

# ============================================
# ARGUMENTS
# ============================================

parser = argparse.ArgumentParser()

parser.add_argument(
    "--tif",
    type=str,
    required=True,
    help="Path to tif file"
)

args = parser.parse_args()

TIF_PATH = args.tif

print("INPUT:", TIF_PATH)

# ============================================
# LOAD MODEL
# ============================================

model = BurnUNet().to(DEVICE)

model.load_state_dict(
    torch.load(
        # "fire_unet_mps.pth",
        "burn_suitability_unet_v3.pth",
        map_location=DEVICE
    )
)

model.eval()

# ============================================
# LOAD TIFF
# ============================================

with rasterio.open(TIF_PATH) as src:

    arr = src.read().astype(np.float32)

print("ORIGINAL SHAPE:", arr.shape)

# ============================================
# REQUIREMENTS
# ============================================

EXPECTED_CHANNELS = 11

if arr.shape[0] < EXPECTED_CHANNELS:

    raise ValueError(
        f"TIFF only has {arr.shape[0]} bands "
        f"but model expects {EXPECTED_CHANNELS}"
    )

# ============================================
# RESIZE
# ============================================

TARGET_SIZE = 128

resized = []

for band in arr:

    resized_band = resize(
        band,
        (TARGET_SIZE, TARGET_SIZE),
        preserve_range=True,
        anti_aliasing=True
    )

    resized.append(resized_band)

arr = np.stack(resized)

print("RESIZED SHAPE:", arr.shape)

# ============================================
# CHANNELS
# ============================================

# 0 B2
# 1 B3
# 2 B4
# 3 B8
# 4 B11
# 5 NDVI
# 6 NDMI
# 7 slope
# 8 temp
# 9 wind
# 10 suitability

x = arr[:10]

# optional target
y = arr[10]

# ============================================
# NORMALIZATION
# ============================================

# Sentinel reflectance
x[:5] /= 10000.0

# NDVI
x[5] = (
    x[5] + 1
) / 2

# NDMI
x[6] = (
    x[6] + 1
) / 2

# slope
x[7] /= 45.0

# temp
x[8] = (
    x[8] + 20
) / 60

# wind
x[9] /= 15.0

x = np.clip(x, 0, 1)

# ============================================
# MODEL PREDICTION
# ============================================

tensor = (
    torch.tensor(x)
    .unsqueeze(0)
    .float()
    .to(DEVICE)
)

with torch.no_grad():

    pred = model(tensor)

    pred = torch.sigmoid(pred)

pred = (
    pred[0,0]
    .cpu()
    .numpy()
)

pred = np.clip(pred, 0, 1)
slope = x[7]
wind = x[9]

escape_risk = (
    slope * 0.6
    +
    wind * 0.4
)
pred = pred * (1 - escape_risk)

# ============================================
# REGION-SPECIFIC THRESHOLDS
# ============================================

path_lower = TIF_PATH.lower()

REGION_THRESHOLDS = {

    # Mediterranean climate
    "california": 0.50,

    # Australia tends to highlight too much
    "australia": 0.45,

    # Rainforest / humid fuels
    "indonesia": 0.75,
}

DEFAULT_THRESHOLD = 0.50

threshold = DEFAULT_THRESHOLD

for region_name, value in REGION_THRESHOLDS.items():

    if region_name in path_lower:

        threshold = value

        print(
            f"Detected region: {region_name}"
        )

        break

print("THRESHOLD:", threshold)

# ============================================
# THRESHOLD
# ============================================

binary = pred > threshold

# ============================================
# CONNECTED COMPONENTS
# ============================================

labels = label(binary)

filtered = np.zeros_like(binary)

MIN_PIXELS = 200

for region_id in np.unique(labels):

    if region_id == 0:
        continue

    mask = labels == region_id

    size = mask.sum()

    if size < MIN_PIXELS:
        continue

    filtered[mask] = 1

# ============================================
# ESCAPE RISK
# ============================================

slope = x[7]
wind = x[9]

escape_risk = (
    slope * 0.6
    +
    wind * 0.4
)

# filtered[
#     escape_risk > 0.70
# ] = 0

# ============================================
# RGB
# ============================================

rgb = arr[[2,1,0]].transpose(1,2,0)

rgb = rgb / rgb.max()

rgb = np.clip(rgb, 0, 1)

# ============================================
# PLOTS
# ============================================

fig, ax = plt.subplots(
    1,
    6,
    figsize=(30,5)
)

# RGB
ax[0].imshow(rgb)
ax[0].set_title("RGB")

# NDVI
ax[1].imshow(
    x[5],
    cmap="YlGn"
)
ax[1].set_title("NDVI")

# # target
# ax[2].imshow(
#     y,
#     cmap="inferno"
# )
# ax[2].set_title("Target Suitability")
# NDMI dryness map
ax[2].imshow(
    1 - x[6],
    cmap="hot"
)
ax[2].set_title("Dryness")

# prediction
ax[3].imshow(
    pred,
    cmap="inferno"
)
ax[3].set_title("Predicted Suitability")

# risk
ax[4].imshow(
    escape_risk,
    cmap="Reds"
)
ax[4].set_title("Escape Risk")

# final candidates
ax[5].imshow(
    filtered,
    cmap="Greens"
)
ax[5].set_title("Burn Candidates")

for a in ax:
    a.axis("off")

plt.tight_layout()
plt.show()

# ============================================
# STATS
# ============================================

candidate_pixels = filtered.sum()

print(
    "\nCandidate pixels:",
    int(candidate_pixels)
)

if candidate_pixels == 0:

    print(
        "NO SAFE CANDIDATE REGIONS FOUND"
    )

else:

    print(
        "SAFE CANDIDATE REGIONS DETECTED"
    )