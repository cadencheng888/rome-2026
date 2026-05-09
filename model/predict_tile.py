"""
Predict burn suitability for a single multi-band GeoTIFF tile.

Expected input format (bands 1..10):
  0 B2, 1 B3, 2 B4, 3 B8, 4 B11, 5 NDVI, 6 NDMI, 7 slope, 8 temp, 9 wind

Output:
  1-band Float32 GeoTIFF with values in [0,1] and the same georeferencing.

Notes:
  - No resizing is performed (resolution is preserved).
  - Inference is done with sliding-window + overlap + feather blending to avoid seams.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from typing import Tuple

import numpy as np
import rasterio
import torch
import matplotlib.pyplot as plt

from train import BurnUNet


def pick_device() -> str:
    if torch.cuda.is_available():
        return "cuda"
    if torch.backends.mps.is_available():
        return "mps"
    return "cpu"


@dataclass(frozen=True)
class NormConfig:
    sentinel_scale: float = 10000.0


def normalize_inputs(x: np.ndarray, cfg: NormConfig) -> np.ndarray:
    """
    x: [10, H, W] float32
    normalization matches training in `model/train.py` and `model/test_model.py`.
    """
    x = x.astype(np.float32, copy=False)

    # Sentinel reflectance
    x[:5] /= cfg.sentinel_scale

    # NDVI, NDMI (-1..1 -> 0..1)
    x[5] = (x[5] + 1.0) / 2.0
    x[6] = (x[6] + 1.0) / 2.0

    # slope (deg)
    x[7] /= 45.0

    # temp (C) with training mapping: (temp + 20) / 60
    x[8] = (x[8] + 20.0) / 60.0

    # wind (m/s)
    x[9] /= 15.0

    return np.clip(x, 0.0, 1.0)


def cosine_window(n: int) -> np.ndarray:
    """2D cosine window for feather blending."""
    w1 = np.hanning(n).astype(np.float32)
    w2 = np.outer(w1, w1)
    w2 /= w2.max() if w2.max() > 0 else 1.0
    return w2


def predict_sliding(
    model: torch.nn.Module,
    x: np.ndarray,
    device: str,
    patch: int = 128,
    stride: int = 96,
    batch: int = 8,
) -> np.ndarray:
    """
    x: [10,H,W] normalized float32
    returns: [H,W] float32 in [0,1]
    """
    _, h, w = x.shape
    pred_acc = np.zeros((h, w), dtype=np.float32)
    w_acc = np.zeros((h, w), dtype=np.float32)
    win = cosine_window(patch)

    ys = list(range(0, max(1, h - patch + 1), stride))
    xs = list(range(0, max(1, w - patch + 1), stride))
    if ys[-1] != h - patch:
        ys.append(h - patch)
    if xs[-1] != w - patch:
        xs.append(w - patch)

    patches = []
    locs: list[Tuple[int, int]] = []

    def flush():
        if not patches:
            return
        tensor = torch.from_numpy(np.stack(patches)).to(device=device, dtype=torch.float32)
        with torch.no_grad():
            out = model(tensor)
            out = torch.sigmoid(out)[:, 0]  # [B,patch,patch]
        out_np = out.detach().cpu().numpy().astype(np.float32, copy=False)
        for (yy, xx), p in zip(locs, out_np):
            pred_acc[yy : yy + patch, xx : xx + patch] += p * win
            w_acc[yy : yy + patch, xx : xx + patch] += win
        patches.clear()
        locs.clear()

    for yy in ys:
        for xx in xs:
            patches.append(x[:, yy : yy + patch, xx : xx + patch])
            locs.append((yy, xx))
            if len(patches) >= batch:
                flush()
    flush()

    w_acc[w_acc == 0] = 1.0
    pred = pred_acc / w_acc
    return np.clip(pred, 0.0, 1.0)


from pathlib import Path
import os

def main() -> None:

    ap = argparse.ArgumentParser()

    ap.add_argument(
        "--input_dir",
        required=True,
        help="Folder containing tif tiles"
    )

    ap.add_argument(
        "--output_dir",
        required=True,
        help="Folder to save predictions"
    )

    ap.add_argument(
        "--weights",
        default="model/burn_suitability_unet_v3.pth"
    )

    ap.add_argument(
        "--patch",
        type=int,
        default=128
    )

    ap.add_argument(
        "--stride",
        type=int,
        default=96
    )

    ap.add_argument(
        "--batch",
        type=int,
        default=8
    )

    ap.add_argument(
        "--plot",
        action="store_true"
    )

    ap.add_argument(
        "--plot_threshold",
        type=float,
        default=0.5
    )

    args = ap.parse_args()

    device = pick_device()

    model = BurnUNet().to(device)

    model.load_state_dict(
        torch.load(
            args.weights,
            map_location=device
        )
    )

    model.eval()

    input_dir = Path(args.input_dir)
    output_dir = Path(args.output_dir)

    output_dir.mkdir(
        parents=True,
        exist_ok=True
    )

    tif_files = sorted(
        input_dir.rglob("*.tif")
    )

    print(f"Found {len(tif_files)} tif files")

    for tif_path in tif_files:

        print(f"\nProcessing: {tif_path}")

        with rasterio.open(tif_path) as src:

            if src.count < 10:
                print(
                    f"Skipping {tif_path.name}, only {src.count} bands"
                )
                continue

            x = src.read(
                list(range(1, 11))
            ).astype(np.float32)

            profile = src.profile

        x = normalize_inputs(
            x,
            NormConfig()
        )

        pred = predict_sliding(
            model=model,
            x=x,
            device=device,
            patch=args.patch,
            stride=args.stride,
            batch=args.batch,
        )

        relative = tif_path.relative_to(input_dir)

        out_path = output_dir / relative

        out_path.parent.mkdir(
            parents=True,
            exist_ok=True
        )

        profile_out = profile.copy()

        profile_out.update(
            count=1,
            dtype="float32",
            nodata=None,
            compress="deflate",
            predictor=3
        )

        with rasterio.open(
            out_path,
            "w",
            **profile_out
        ) as dst:

            dst.write(
                pred.astype(np.float32),
                1
            )

        print(f"Saved: {out_path}")

        if args.plot:

            rgb = np.stack(
                [x[2], x[1], x[0]],
                axis=-1
            )

            rgb = np.clip(rgb, 0.0, 1.0)

            mask = pred >= float(
                args.plot_threshold
            )

            plt.figure(figsize=(14, 5))

            plt.subplot(1, 3, 1)
            plt.imshow(rgb)
            plt.title("RGB")
            plt.axis("off")

            plt.subplot(1, 3, 2)
            plt.imshow(
                pred,
                cmap="inferno",
                vmin=0,
                vmax=1
            )
            plt.title("Prediction")
            plt.axis("off")

            plt.subplot(1, 3, 3)
            plt.imshow(rgb)
            plt.imshow(
                mask,
                cmap="Greens",
                alpha=0.45
            )
            plt.title("Thresholded")
            plt.axis("off")

            plt.tight_layout()
            plt.show()

if __name__ == "__main__":
    main()
