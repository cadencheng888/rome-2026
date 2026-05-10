// Burn-plan optimizer.
//
// We parameterize a candidate prescribed burn as N straight strips, each
// described by (cx, cy, length, angle, width). 5 numbers per strip, 3 strips
// → 15-dimensional search space. That's small enough to attack with simulated
// annealing in pure TypeScript without exotic libraries.
//
// Objective:   benefit = worstCase(landscape, no treatment)
//                       − worstCase(landscape, after this burn)
//                       − areaCost(plan)
//
// We maximize benefit. Both worstCase() values are stochastic, so we use a
// modest number of rollouts and accept the noise; the optimizer's noise
// tolerance comes from re-evaluating the incumbent occasionally.

import type { Grid } from "./fireEngine";
import { cloneGrid, projectWorstCase } from "./fireEngine";

export interface BurnStrip {
  cx: number; // grid coords, [0, 1]
  cy: number;
  length: number; // [0, 1] of the longest dimension
  angle: number; // radians
  width: number; // cells (1..6)
}

export interface OptimizedPlan {
  strips: BurnStrip[];
  cellsBurned: number;
  burnFraction: number;
  preBurnWorstCase: number; // burned fraction in worst-case wildfire BEFORE plan
  postBurnWorstCase: number; // … AFTER plan
  benefit: number; // pre - post (NOT discounted by area cost)
}

interface OptimizeOptions {
  stripCount?: number;
  iterations?: number;
  rolloutsPerEval?: number;
  areaCostWeight?: number;
  seed?: number;
  onProgress?: (info: { iter: number; bestBenefit: number }) => void;
}

/**
 * Apply a burn plan to a grid: every cell within any strip is "burned"
 * (status = burned, fuel = 0). Returns a new grid; original is not mutated.
 */
export function applyBurnPlan(grid: Grid, strips: BurnStrip[]): Grid {
  const next = cloneGrid(grid);
  const h = next.length;
  const w = next[0]?.length ?? 0;
  if (!h || !w) return next;
  const longest = Math.max(w, h);

  for (const strip of strips) {
    const cx = strip.cx * w;
    const cy = strip.cy * h;
    const halfLen = (strip.length * longest) / 2;
    const halfW = strip.width / 2;
    const cosA = Math.cos(strip.angle);
    const sinA = Math.sin(strip.angle);

    // Bounding rect for efficiency; extend by max(halfLen, halfW).
    const rad = Math.ceil(Math.max(halfLen, halfW) + 1);
    const x0 = Math.max(0, Math.floor(cx - rad));
    const x1 = Math.min(w - 1, Math.ceil(cx + rad));
    const y0 = Math.max(0, Math.floor(cy - rad));
    const y1 = Math.min(h - 1, Math.ceil(cy + rad));

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        // Project (x, y) into strip-local coordinates.
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        const along = dx * cosA + dy * sinA;
        const across = -dx * sinA + dy * cosA;
        if (Math.abs(along) <= halfLen && Math.abs(across) <= halfW) {
          const cell = next[y][x];
          if (cell.status === "firebreak") continue;
          cell.fuel = 0;
          cell.status = "burned";
          cell.heat = 0;
        }
      }
    }
  }
  return next;
}

/**
 * Rasterize a plan to a 0/1 mask the same shape as the grid. Used both for
 * UI overlays and for measuring burn area.
 */
export function planToMask(
  strips: BurnStrip[],
  width: number,
  height: number
): Uint8Array {
  const mask = new Uint8Array(width * height);
  if (!width || !height) return mask;
  const longest = Math.max(width, height);
  for (const strip of strips) {
    const cx = strip.cx * width;
    const cy = strip.cy * height;
    const halfLen = (strip.length * longest) / 2;
    const halfW = strip.width / 2;
    const cosA = Math.cos(strip.angle);
    const sinA = Math.sin(strip.angle);
    const rad = Math.ceil(Math.max(halfLen, halfW) + 1);
    const x0 = Math.max(0, Math.floor(cx - rad));
    const x1 = Math.min(width - 1, Math.ceil(cx + rad));
    const y0 = Math.max(0, Math.floor(cy - rad));
    const y1 = Math.min(height - 1, Math.ceil(cy + rad));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        const along = dx * cosA + dy * sinA;
        const across = -dx * sinA + dy * cosA;
        if (Math.abs(along) <= halfLen && Math.abs(across) <= halfW) {
          mask[y * width + x] = 1;
        }
      }
    }
  }
  return mask;
}

function randomStrip(): BurnStrip {
  return {
    cx: Math.random(),
    cy: Math.random(),
    length: 0.15 + Math.random() * 0.55,
    angle: Math.random() * Math.PI,
    width: 2 + Math.random() * 3, // 2..5 cells
  };
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function perturbStrip(s: BurnStrip, sigma: number): BurnStrip {
  return {
    cx: clamp(s.cx + (Math.random() - 0.5) * 0.2 * sigma, 0, 1),
    cy: clamp(s.cy + (Math.random() - 0.5) * 0.2 * sigma, 0, 1),
    length: clamp(s.length + (Math.random() - 0.5) * 0.2 * sigma, 0.1, 0.85),
    angle: s.angle + (Math.random() - 0.5) * 0.6 * sigma,
    width: clamp(s.width + (Math.random() - 0.5) * 1.5 * sigma, 1.5, 6),
  };
}

function clonePlan(strips: BurnStrip[]): BurnStrip[] {
  return strips.map((s) => ({ ...s }));
}

/**
 * Search for a burn plan that maximizes (worst-case-before − worst-case-after)
 * with a soft penalty for total burned area. Simulated annealing over a fixed
 * number of strips.
 */
export async function optimizeBurnPlan(
  grid: Grid,
  elevation: number[][] | null,
  options: OptimizeOptions = {}
): Promise<OptimizedPlan> {
  const {
    stripCount = 3,
    iterations = 60,
    rolloutsPerEval = 4,
    areaCostWeight = 0.6,
    onProgress,
  } = options;

  const h = grid.length;
  const w = grid[0]?.length ?? 0;
  const totalBurnable = (() => {
    let n = 0;
    for (const row of grid) for (const c of row) if (c.fuel > 0) n++;
    return n;
  })();

  // Pre-burn baseline (untreated landscape).
  const pre = projectWorstCase(grid, elevation, {
    rollouts: rolloutsPerEval * 2,
  });

  const evaluate = (strips: BurnStrip[]): { benefit: number; post: number; areaFrac: number } => {
    const treated = applyBurnPlan(grid, strips);
    const post = projectWorstCase(treated, elevation, {
      rollouts: rolloutsPerEval,
    });
    // Area cost: how much of the burnable landscape is in our plan
    let burned = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (treated[y][x].status === "burned" && grid[y][x].status !== "burned") burned++;
      }
    }
    const areaFrac = totalBurnable ? burned / totalBurnable : 0;
    const benefit = pre - post - areaCostWeight * areaFrac;
    return { benefit, post, areaFrac };
  };

  // Initialize with random plans, keep the best as starting incumbent.
  let best = Array.from({ length: stripCount }, randomStrip);
  let bestEval = evaluate(best);

  for (let trial = 0; trial < 6; trial++) {
    const cand = Array.from({ length: stripCount }, randomStrip);
    const ev = evaluate(cand);
    if (ev.benefit > bestEval.benefit) {
      best = cand;
      bestEval = ev;
    }
  }

  let current = clonePlan(best);
  let currentEval = bestEval;

  // Simulated annealing.
  for (let iter = 0; iter < iterations; iter++) {
    const t = 1 - iter / iterations;
    const sigma = 0.6 * t + 0.1;
    const tempSA = 0.05 * t + 0.005;

    // Perturb one random strip; occasionally regenerate a strip from scratch.
    const cand = clonePlan(current);
    const idx = Math.floor(Math.random() * stripCount);
    cand[idx] =
      Math.random() < 0.15 ? randomStrip() : perturbStrip(cand[idx], sigma);

    const ev = evaluate(cand);
    const delta = ev.benefit - currentEval.benefit;
    if (delta > 0 || Math.random() < Math.exp(delta / tempSA)) {
      current = cand;
      currentEval = ev;
      if (ev.benefit > bestEval.benefit) {
        best = clonePlan(cand);
        bestEval = ev;
      }
    }
    onProgress?.({ iter, bestBenefit: bestEval.benefit });

    // Yield to the event loop every few iterations so the UI doesn't freeze
    // when this runs in-browser.
    if (iter % 6 === 0) await new Promise((res) => setTimeout(res, 0));
  }

  // Convert area to cell count for the result.
  const treated = applyBurnPlan(grid, best);
  let cellsBurned = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (treated[y][x].status === "burned" && grid[y][x].status !== "burned") cellsBurned++;
    }
  }

  return {
    strips: best,
    cellsBurned,
    burnFraction: bestEval.areaFrac,
    preBurnWorstCase: pre,
    postBurnWorstCase: bestEval.post,
    benefit: pre - bestEval.post,
  };
}
