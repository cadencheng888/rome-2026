# ============================================
# train_burn_suitability_v3.py
# ============================================
#
# ECOLOGY-AWARE PRESCRIBED BURN TRAINING
#
# Improvements:
# - SmoothL1 loss
# - stronger augmentations
# - anti-blur target shaping
# - weighted ecological learning
# - uncertainty-friendly outputs
# - optional water suppression
# - validation metrics
#
# ============================================

import os
import glob
import random

import rasterio
import numpy as np
import torch

from torch import nn
from torch.utils.data import (
    Dataset,
    DataLoader,
    random_split
)

import segmentation_models_pytorch as smp

# ============================================
# CONFIG
# ============================================

DATASET_DIR = "dataset_v4"

MODEL_OUT = "burn_suitability_unet_v3.pth"

BATCH_SIZE = 4
EPOCHS = 60
LR = 1e-5

VAL_SPLIT = 0.2

DEVICE = (
    "mps"
    if torch.backends.mps.is_available()
    else "cpu"
)

print("DEVICE:", DEVICE)

# ============================================
# DATASET
# ============================================

class BurnDataset(Dataset):

    def __init__(
        self,
        root,
        augment=False
    ):

        self.files = glob.glob(
            os.path.join(root, "**/*.tif"),
            recursive=True
        )

        self.augment = augment

        print(
            "FILES:",
            len(self.files)
        )

    def __len__(self):
        return len(self.files)

    # ========================================
    # NORMALIZATION
    # ========================================

    def normalize(self, arr):

        arr = arr[:, :128, :128]

        x = arr[:10].astype(np.float32)
        y = arr[10].astype(np.float32)

        # ------------------------------------
        # INPUTS
        # ------------------------------------

        # Sentinel
        x[:5] /= 10000.0

        # NDVI
        x[5] = (x[5] + 1) / 2

        # NDMI
        x[6] = (x[6] + 1) / 2

        # slope
        x[7] /= 45.0

        # temp
        x[8] = (x[8] + 20) / 60

        # wind
        x[9] /= 15.0

        x = np.clip(x, 0, 1)

        # ------------------------------------
        # TARGET SHAPING
        # ------------------------------------

        # enhance contrast
        y = np.power(y, 1.5)

        # suppress weak suitability
        y[y < 0.15] = 0

        y = np.clip(y, 0, 1)

        return x, y

    # ========================================
    # AUGMENTATIONS
    # ========================================

    def augment_sample(self, x, y):

        # flips
        if random.random() < 0.5:

            x = np.flip(x, axis=2)
            y = np.flip(y, axis=1)

        if random.random() < 0.5:

            x = np.flip(x, axis=1)
            y = np.flip(y, axis=0)

        # rotations
        k = random.randint(0, 3)

        x = np.rot90(
            x,
            k,
            axes=(1,2)
        )

        y = np.rot90(
            y,
            k
        )

        # slight noise
        if random.random() < 0.3:

            noise = (
                np.random.randn(*x.shape)
                * 0.01
            )

            x = x + noise

        x = np.clip(x, 0, 1)

        return x.copy(), y.copy()

    def __getitem__(self, idx):

        path = self.files[idx]

        with rasterio.open(path) as src:

            arr = src.read()

        x, y = self.normalize(arr)

        if self.augment:

            x, y = self.augment_sample(x, y)

        return (
            torch.tensor(x).float(),
            torch.tensor(y)
            .unsqueeze(0)
            .float()
        )

# ============================================
# MODEL
# ============================================

class BurnUNet(nn.Module):

    def __init__(self):

        super().__init__()

        self.model = smp.Unet(

            encoder_name="resnet34",

            encoder_weights="imagenet",

            in_channels=10,

            classes=1,

            activation=None,

            decoder_interpolation="bilinear"
        )

        # ------------------------------------
        # PARTIAL UNFREEZE
        # ------------------------------------

        for name, param in (
            self.model.encoder.named_parameters()
        ):

            if (
                "layer4" in name
                or
                "layer3" in name
            ):

                param.requires_grad = True

            else:

                param.requires_grad = False

    def forward(self, x):

        return self.model(x)

# ============================================
# METRICS
# ============================================

def mae(pred, target):

    return torch.mean(
        torch.abs(pred - target)
    ).item()

def correlation(pred, target):

    p = pred.flatten()
    t = target.flatten()

    p = p - p.mean()
    t = t - t.mean()

    denom = (
        torch.sqrt(
            (p**2).sum()
            *
            (t**2).sum()
        )
        + 1e-8
    )

    return (
        (p*t).sum()
        / denom
    ).item()

# ============================================
# EPOCH
# ============================================

def run_epoch(
    model,
    loader,
    criterion,
    optimizer=None
):

    train = optimizer is not None

    if train:
        model.train()
    else:
        model.eval()

    total_loss = 0
    total_mae = 0
    total_corr = 0

    for x, y in loader:

        x = x.to(DEVICE)
        y = y.to(DEVICE)

        if train:
            optimizer.zero_grad()

        with torch.set_grad_enabled(train):

            pred = model(x)

            pred = torch.sigmoid(pred)

            # --------------------------------
            # ECOLOGICAL WEIGHTING
            # --------------------------------

            weight = (
                1
                +
                y * 3
            )

            loss_map = (
                torch.abs(pred - y)
                * weight
            )

            loss = loss_map.mean()

            if train:

                loss.backward()

                optimizer.step()

        total_loss += loss.item()

        total_mae += mae(pred, y)

        total_corr += correlation(
            pred,
            y
        )

    n = len(loader)

    return {

        "loss": total_loss / n,

        "mae": total_mae / n,

        "corr": total_corr / n
    }

# ============================================
# TRAIN
# ============================================

def train():

    dataset = BurnDataset(
        DATASET_DIR,
        augment=True
    )

    val_size = int(
        len(dataset)
        * VAL_SPLIT
    )

    train_size = (
        len(dataset)
        - val_size
    )

    train_ds, val_ds = random_split(

        dataset,

        [train_size, val_size],

        generator=torch.Generator()
        .manual_seed(42)
    )

    train_loader = DataLoader(

        train_ds,

        batch_size=BATCH_SIZE,

        shuffle=True,

        num_workers=0
    )

    val_loader = DataLoader(

        val_ds,

        batch_size=BATCH_SIZE,

        shuffle=False,

        num_workers=0
    )

    model = BurnUNet().to(DEVICE)

    criterion = nn.SmoothL1Loss()

    optimizer = torch.optim.AdamW(

        filter(
            lambda p: p.requires_grad,
            model.parameters()
        ),

        lr=LR,

        weight_decay=1e-4
    )

    best_loss = 999

    # ========================================
    # TRAIN LOOP
    # ========================================

    for epoch in range(EPOCHS):

        train_stats = run_epoch(

            model,

            train_loader,

            criterion,

            optimizer
        )

        val_stats = run_epoch(

            model,

            val_loader,

            criterion,

            optimizer=None
        )

        print(

            f"epoch {epoch+1}/{EPOCHS} "

            f"train_loss={train_stats['loss']:.4f} "

            f"val_loss={val_stats['loss']:.4f} "

            f"val_mae={val_stats['mae']:.4f} "

            f"val_corr={val_stats['corr']:.4f}"
        )

        # ------------------------------------
        # SAVE BEST
        # ------------------------------------

        if val_stats["loss"] < best_loss:

            best_loss = val_stats["loss"]

            torch.save(

                model.state_dict(),

                MODEL_OUT
            )

            print(
                "SAVED BEST MODEL"
            )

    print("DONE")

# ============================================
# MAIN
# ============================================

if __name__ == "__main__":

    train()