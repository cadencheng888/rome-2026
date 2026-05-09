# ============================================
# train_prithvi_mps.py
# ============================================
#
# MPS-OPTIMIZED TRAINING
#
# - frozen Prithvi encoder
# - lightweight decoder
# - Apple Silicon friendly
#
# ============================================

import os, glob
import rasterio
import numpy as np
import torch
from torch import nn
from torch.utils.data import Dataset, DataLoader

DEVICE = "mps" if torch.backends.mps.is_available() else "cpu"
print("DEVICE:", DEVICE)

DATASET_DIR = "dataset"
BATCH_SIZE = 4
EPOCHS = 10
LR = 1e-3

class FireDataset(Dataset):
    def __init__(self, root):
        self.files = glob.glob(os.path.join(root, "**/*.tif"), recursive=True)
        print("num files:", len(self.files))

    def __len__(self):
        return len(self.files)

    def __getitem__(self, idx):
        with rasterio.open(self.files[idx]) as src:
            arr = src.read().astype(np.float32)

        # Force consistent size
        arr = arr[:, :128, :128]

        # Input: first 7 channels
        x = arr[:7]

        # Label: burned mask
        y = arr[7]

        # Normalize Sentinel bands
        x[:4] = x[:4] / 10000.0

        # NDVI already around -1..1
        # DEM rough normalization
        x[5] = x[5] / 3000.0

        # Landcover rough normalization
        x[6] = x[6] / 100.0

        y = (y > 0).astype(np.int64)

        return torch.tensor(x), torch.tensor(y)

class SmallUNet(nn.Module):
    def __init__(self, in_ch=7, out_ch=2):
        super().__init__()

        self.enc1 = nn.Sequential(
            nn.Conv2d(in_ch, 32, 3, padding=1),
            nn.ReLU(),
            nn.Conv2d(32, 32, 3, padding=1),
            nn.ReLU(),
        )
        self.pool1 = nn.MaxPool2d(2)

        self.enc2 = nn.Sequential(
            nn.Conv2d(32, 64, 3, padding=1),
            nn.ReLU(),
            nn.Conv2d(64, 64, 3, padding=1),
            nn.ReLU(),
        )
        self.pool2 = nn.MaxPool2d(2)

        self.mid = nn.Sequential(
            nn.Conv2d(64, 128, 3, padding=1),
            nn.ReLU(),
            nn.Conv2d(128, 128, 3, padding=1),
            nn.ReLU(),
        )

        self.up2 = nn.ConvTranspose2d(128, 64, 2, stride=2)
        self.dec2 = nn.Sequential(
            nn.Conv2d(128, 64, 3, padding=1),
            nn.ReLU(),
            nn.Conv2d(64, 64, 3, padding=1),
            nn.ReLU(),
        )

        self.up1 = nn.ConvTranspose2d(64, 32, 2, stride=2)
        self.dec1 = nn.Sequential(
            nn.Conv2d(64, 32, 3, padding=1),
            nn.ReLU(),
            nn.Conv2d(32, 32, 3, padding=1),
            nn.ReLU(),
        )

        self.out = nn.Conv2d(32, out_ch, 1)

    def forward(self, x):
        e1 = self.enc1(x)
        e2 = self.enc2(self.pool1(e1))
        m = self.mid(self.pool2(e2))

        d2 = self.up2(m)
        d2 = torch.cat([d2, e2], dim=1)
        d2 = self.dec2(d2)

        d1 = self.up1(d2)
        d1 = torch.cat([d1, e1], dim=1)
        d1 = self.dec1(d1)

        return self.out(d1)

dataset = FireDataset(DATASET_DIR)
loader = DataLoader(
    dataset,
    batch_size=BATCH_SIZE,
    shuffle=True,
    num_workers=0,
    pin_memory=False,
)

model = SmallUNet().to(DEVICE)
optimizer = torch.optim.AdamW(model.parameters(), lr=LR)
criterion = nn.CrossEntropyLoss(
    weight=torch.tensor([1.0, 8.0]).to(DEVICE)
)

for epoch in range(EPOCHS):
    model.train()
    total = 0

    for x, y in loader:
        x = x.to(DEVICE)
        y = y.to(DEVICE)

        optimizer.zero_grad()
        pred = model(x)

        loss = criterion(pred, y)
        loss.backward()
        optimizer.step()

        total += loss.item()

    print(f"epoch {epoch+1}/{EPOCHS} loss={total/len(loader):.4f}")

torch.save(model.state_dict(), "fire_unet_mps.pth")
print("saved fire_unet_mps.pth")