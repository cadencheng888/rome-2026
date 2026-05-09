# ============================================
# predict_global_burn_suitability.py
# ============================================
#
# GLOBAL PRESCRIBED-BURN SUITABILITY INFERENCE
#
# Features:
# - Sliding-window inference
# - Overlap feather blending
# - Multi-region batch processing
# - Binary burn-region outputs
# - GeoTIFF preservation
# - MPS / CUDA support
#
# Input:
# - 10-band GeoTIFF
#
# Output:
# - 1-band binary burn mask
#
# ============================================


# ============================================
# IMPORTS
# ============================================

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path
from typing import Tuple

import numpy as np
import rasterio
import torch
import matplotlib.pyplot as plt

from train import BurnUNet


# ============================================
# DEVICE SELECTION
# ============================================

def pick_device() -> str:

    if torch.cuda.is_available():
        return "cuda"

    if torch.backends.mps.is_available():
        return "mps"

    return "cpu"


# ============================================
# NORMALIZATION CONFIG
# ============================================

@dataclass(frozen=True)
class NormConfig:

    sentinel_scale: float = 10000.0


# ============================================
# INPUT NORMALIZATION
# ============================================

def normalize_inputs(
    x: np.ndarray,
    cfg: NormConfig
) -> np.ndarray:

    x = x.astype(
        np.float32,
        copy=False
    )

    # Sentinel reflectance
    x[:5] /= cfg.sentinel_scale

    # NDVI / NDMI
    x[5] = (x[5] + 1.0) / 2.0
    x[6] = (x[6] + 1.0) / 2.0

    # Slope
    x[7] /= 45.0

    # Temperature
    x[8] = (x[8] + 20.0) / 60.0

    # Wind
    x[9] /= 15.0

    return np.clip(
        x,
        0.0,
        1.0
    )


# ============================================
# COSINE FEATHER WINDOW
# ============================================

def cosine_window(
    n: int
) -> np.ndarray:

    w1 = np.hanning(n).astype(np.float32)

    w2 = np.outer(w1, w1)

    w2 /= w2.max()

    return w2


# ============================================
# SLIDING WINDOW INFERENCE
# ============================================

def predict_sliding(

    model: torch.nn.Module,
    x: np.ndarray,
    device: str,

    patch: int = 128,
    stride: int = 96,
    batch: int = 8,

) -> np.ndarray:

    _, h, w = x.shape

    pred_acc = np.zeros(
        (h, w),
        dtype=np.float32
    )

    w_acc = np.zeros(
        (h, w),
        dtype=np.float32
    )

    win = cosine_window(patch)

    ys = list(
        range(
            0,
            max(1, h - patch + 1),
            stride
        )
    )

    xs = list(
        range(
            0,
            max(1, w - patch + 1),
            stride
        )
    )

    if ys[-1] != h - patch:
        ys.append(h - patch)

    if xs[-1] != w - patch:
        xs.append(w - patch)

    patches = []

    locs: list[Tuple[int, int]] = []


    # ============================================
    # BATCH FLUSH
    # ============================================

    def flush():

        if not patches:
            return

        tensor = torch.from_numpy(
            np.stack(patches)
        ).to(
            device=device,
            dtype=torch.float32
        )

        with torch.no_grad():

            out = model(tensor)

            out = torch.sigmoid(out)[:, 0]

        out_np = out.detach().cpu().numpy()

        for (yy, xx), p in zip(
            locs,
            out_np
        ):

            pred_acc[
                yy:yy + patch,
                xx:xx + patch
            ] += p * win

            w_acc[
                yy:yy + patch,
                xx:xx + patch
            ] += win

        patches.clear()
        locs.clear()


    # ============================================
    # PATCH EXTRACTION
    # ============================================

    for yy in ys:

        for xx in xs:

            patches.append(
                x[
                    :,
                    yy:yy + patch,
                    xx:xx + patch
                ]
            )

            locs.append((yy, xx))

            if len(patches) >= batch:
                flush()

    flush()

    w_acc[w_acc == 0] = 1.0

    pred = pred_acc / w_acc

    return np.clip(
        pred,
        0.0,
        1.0
    )


# ============================================
# MAIN INFERENCE PIPELINE
# ============================================

def main() -> None:

    ap = argparse.ArgumentParser()

    ap.add_argument(
        "--input_dir",
        required=True
    )

    ap.add_argument(
        "--output_dir",
        required=True
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
        "--threshold",
        type=float,
        default=0.5
    )

    ap.add_argument(
        "--plot",
        action="store_true"
    )

    args = ap.parse_args()


    # ============================================
    # MODEL LOAD
    # ============================================

    device = pick_device()

    model = BurnUNet().to(device)

    model.load_state_dict(
        torch.load(
            args.weights,
            map_location=device
        )
    )

    model.eval()


    # ============================================
    # DIRECTORY SETUP
    # ============================================

    input_dir = Path(args.input_dir)

    output_dir = Path(args.output_dir)

    output_dir.mkdir(
        parents=True,
        exist_ok=True
    )


    # ============================================
    # TILE DISCOVERY
    # ============================================

    tif_files = sorted(
        input_dir.rglob("*.tif")
    )

    print(
        f"Found {len(tif_files)} tif files"
    )


    # ============================================
    # TILE INFERENCE LOOP
    # ============================================

    for tif_path in tif_files:

        print(f"\nProcessing: {tif_path}")

        with rasterio.open(tif_path) as src:

            if src.count < 10:

                print(
                    f"Skipping {tif_path.name}"
                )

                continue

            x = src.read(
                list(range(1, 11))
            ).astype(np.float32)

            profile = src.profile


        # ============================================
        # NORMALIZATION
        # ============================================

        x = normalize_inputs(
            x,
            NormConfig()
        )


        # ============================================
        # MODEL PREDICTION
        # ============================================

        pred = predict_sliding(
            model=model,
            x=x,
            device=device,
            patch=args.patch,
            stride=args.stride,
            batch=args.batch,
        )


        # ============================================
        # THRESHOLDING
        # ============================================

        burn_mask = (
            pred >= args.threshold
        ).astype(np.float32)


        # ============================================
        # OUTPUT SAVE
        # ============================================

        relative = tif_path.relative_to(
            input_dir
        )

        out_path = output_dir / relative

        out_path.parent.mkdir(
            parents=True,
            exist_ok=True
        )

        profile_out = profile.copy()

        profile_out.update(
            count=1,
            dtype="float32",
            nodata=0
        )

        with rasterio.open(
            out_path,
            "w",
            **profile_out
        ) as dst:

            dst.write(
                burn_mask,
                1
            )

        print(f"Saved: {out_path}")


        # ============================================
        # VISUALIZATION
        # ============================================

        if args.plot:

            rgb = np.stack(
                [x[2], x[1], x[0]],
                axis=-1
            )

            rgb = np.clip(
                rgb,
                0.0,
                1.0
            )

            plt.figure(
                figsize=(18, 6)
            )


            # RGB
            plt.subplot(1, 3, 1)

            plt.imshow(rgb)

            plt.title("RGB")

            plt.axis("off")


            # Continuous prediction
            plt.subplot(1, 3, 2)

            plt.imshow(
                pred,
                cmap="inferno",
                vmin=0,
                vmax=1
            )

            plt.title(
                "Burn Suitability"
            )

            plt.colorbar()

            plt.axis("off")


            # Binary overlay
            plt.subplot(1, 3, 3)

            plt.imshow(rgb)

            plt.imshow(
                burn_mask,
                cmap="Greens",
                alpha=0.45
            )

            plt.title(
                f"Burn Regions ≥ {args.threshold}"
            )

            plt.axis("off")

            plt.tight_layout()

            plt.show()


if __name__ == "__main__":

    main()