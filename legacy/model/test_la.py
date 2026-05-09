import torch
import torch.nn.functional as F
import numpy as np
import rasterio
import matplotlib.pyplot as plt

from pathlib import Path


# ============================================
# CONFIG
# ============================================

MODEL_PATH = "burn_suitability_unet_v3.pth"
TIF_PATH = "AUSTRALIA_CONTROLLED_BURN_REGION.tif"

PATCH_SIZE = 128
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

# threshold for visualization
THRESHOLD = 0.5


# ============================================
# LOAD MODEL
# ============================================

# --------------------------------------------
# IMPORTANT:
# Replace this with YOUR model class
# --------------------------------------------

from train import BurnUNet  # <- change if needed

model = BurnUNet()
model.load_state_dict(
    torch.load(MODEL_PATH, map_location=DEVICE)
)

model.to(DEVICE)
model.eval()

print("Loaded model.")


# ============================================
# LOAD TIF
# ============================================

with rasterio.open(TIF_PATH) as src:
    img = src.read()  # [C, H, W]

print("Raw tif shape:", img.shape)

# expected:
# [10, 512, 512] (we don't need sustainbility)

img = img[:10].astype(np.float32)


# ============================================
# OPTIONAL NORMALIZATION
# Match whatever training used
# ============================================

# Sentinel bands
img[0:5] /= 3000.0

# slope
img[7] /= 45.0

# temp
img[8] = (img[8] - 10) / 25.0

# wind
img[9] /= 8.0

img = np.clip(img, 0, 1)


# ============================================
# PATCH INFERENCE
# ============================================

C, H, W = img.shape

prediction_map = np.zeros((H, W), dtype=np.float32)

for y in range(0, H, PATCH_SIZE):
    for x in range(0, W, PATCH_SIZE):

        patch = img[
            :,
            y:y + PATCH_SIZE,
            x:x + PATCH_SIZE
        ]

        # safety
        if patch.shape[1] != PATCH_SIZE or patch.shape[2] != PATCH_SIZE:
            continue

        tensor = torch.tensor(
            patch,
            dtype=torch.float32
        ).unsqueeze(0).to(DEVICE)

        with torch.no_grad():

            pred = model(tensor)

            # if model outputs logits
            pred = torch.sigmoid(pred)

            pred = pred[0, 0].cpu().numpy()

        prediction_map[
            y:y + PATCH_SIZE,
            x:x + PATCH_SIZE
        ] = pred

        print(f"Done patch x={x}, y={y}")


# ============================================
# VISUALIZATION
# ============================================

binary = (prediction_map > THRESHOLD).astype(np.float32)

rgb = np.transpose(img[[2, 1, 0]], (1, 2, 0))
rgb = np.clip(rgb, 0, 1)

plt.figure(figsize=(18, 6))

# --------------------------------------------
# RGB
# --------------------------------------------

plt.subplot(1, 3, 1)
plt.imshow(rgb)
plt.title("RGB")
plt.axis("off")

# --------------------------------------------
# Raw prediction
# --------------------------------------------

plt.subplot(1, 3, 2)
plt.imshow(prediction_map, cmap="inferno", vmin=0, vmax=1)
plt.title("Predicted Burn Suitability")
plt.colorbar()
plt.axis("off")

# --------------------------------------------
# Thresholded
# --------------------------------------------

plt.subplot(1, 3, 3)
plt.imshow(rgb)
plt.imshow(
    binary,
    cmap="Reds",
    alpha=0.45
)
plt.title(f"Thresholded > {THRESHOLD}")
plt.axis("off")

plt.tight_layout()
plt.show()


# ============================================
# OPTIONAL SAVE OUTPUT
# ============================================

np.save("prediction_map.npy", prediction_map)

print("Saved prediction_map.npy")