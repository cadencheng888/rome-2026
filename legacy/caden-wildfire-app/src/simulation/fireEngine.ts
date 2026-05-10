import { computeFireBehavior, rosAtAngle, rosChHr } from "./rothermel";
import type { FireBehavior, FuelMoisture } from "./rothermel";
import { getFuelModel } from "./fuelModels";

export type CellStatus = "unburned" | "burning" | "burned" | "firebreak";

export interface Cell {
  fuel: number;
  moisture: number; // 0 = dry, 1 = wet — from NDMI band
  slope: number;    // degrees, from TIFF slope band (0 if unavailable)
  aspect: number;   // degrees 0–360 (0=N, 90=E), from TIFF aspect band
  status: CellStatus;
  heat: number;
}

export type Grid = Cell[][];

export interface SimParams {
  windSpeed: number;        // mph (mid-flame at the fuel-bed canopy)
  windDirX: number;
  windDirY: number;
  humidity: number;         // %
  temperature: number;      // °F
  fuelModelCode: string;    // FBFM40 code (e.g., "TL3")
  fuelMoisture: FuelMoisture;
}

export interface GridOptions {
  width: number;
  height: number;
  fuelDensity?: number;
  firebreakChance?: number;
}

// Each grid cell ≈ 10 m on a side (Sentinel-2 native NDVI resolution).
// One sim tick advances time by 1 simulated minute.
const CELL_SIZE_FT = 33;
const TICK_MIN = 1;

export function createGrid(opts: GridOptions): Grid {
  const { width, height, fuelDensity = 0.85, firebreakChance = 0.02 } = opts;
  const grid: Grid = [];
  for (let y = 0; y < height; y++) {
    const row: Cell[] = [];
    for (let x = 0; x < width; x++) {
      const isBreak = Math.random() < firebreakChance;
      const hasFuel = !isBreak && Math.random() < fuelDensity;
      row.push({
        fuel: hasFuel ? 60 + Math.random() * 40 : 0,
        moisture: 0,
        slope: 0,
        aspect: 0,
        status: isBreak ? "firebreak" : "unburned",
        heat: 0,
      });
    }
    grid.push(row);
  }
  return grid;
}

export function cloneGrid(grid: Grid): Grid {
  return grid.map((row) => row.map((c) => ({ ...c })));
}

export function ignite(grid: Grid, x: number, y: number): Grid {
  if (y < 0 || y >= grid.length || x < 0 || x >= grid[0].length) return grid;
  const next = cloneGrid(grid);
  if (next[y][x].status === "unburned" && next[y][x].fuel > 0) {
    next[y][x].status = "burning";
    next[y][x].heat = 1;
  }
  return next;
}

export function igniteCluster(
  grid: Grid,
  x: number,
  y: number,
  radius = 2,
): Grid {
  const next = cloneGrid(grid);
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > radius * radius) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (ny < 0 || ny >= next.length || nx < 0 || nx >= next[0].length)
        continue;
      if (next[ny][nx].status === "unburned" && next[ny][nx].fuel > 0) {
        next[ny][nx].status = "burning";
        next[ny][nx].heat = 0.7 + Math.random() * 0.3;
      }
    }
  }
  return next;
}

const NEIGHBORS: Array<[number, number]> = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

// Slope-percent felt in the spread direction, given the source cell's slope (deg)
// and aspect (downslope direction in deg, 0=N, 90=E).
function directionalSlopePct(
  slopeDeg: number,
  aspectDeg: number,
  dx: number,
  dy: number,
): number {
  if (slopeDeg < 0.5) return 0;
  const aspectRad = (aspectDeg * Math.PI) / 180;
  // Downslope unit vector in image space (+x east, +y south).
  const downX = Math.sin(aspectRad);
  const downY = Math.cos(aspectRad);
  // Upslope = -down. Alignment of spread direction with upslope.
  const len = Math.hypot(dx, dy) || 1;
  const sx = dx / len;
  const sy = dy / len;
  const alignment = -(sx * downX + sy * downY); // +1 = up, -1 = down
  if (alignment <= 0) return 0;
  // Convert slope-deg to slope-percent (rise/run × 100).
  const slopePct = Math.tan((slopeDeg * Math.PI) / 180) * 100;
  return slopePct * alignment;
}

// Mean slope across the grid in percent (rise/run × 100), used for the
// system-level (panel display) Rothermel call.
export function meanSlopePct(grid: Grid | null): number {
  if (!grid) return 0;
  let sum = 0;
  let n = 0;
  for (const row of grid) {
    for (const c of row) {
      if (c.slope > 0) {
        sum += Math.tan((c.slope * Math.PI) / 180) * 100;
        n++;
      }
    }
  }
  return n > 0 ? sum / n : 0;
}

// Compute the system-level fire behavior at current params and a representative
// slope. This is what the panel and prescription check display.
export function systemBehavior(
  params: SimParams,
  slopePct: number,
): FireBehavior {
  const fm = getFuelModel(params.fuelModelCode);
  return computeFireBehavior(
    fm,
    params.fuelMoisture,
    params.windSpeed,
    slopePct,
  );
}

function spreadProb(
  behavior: FireBehavior,
  windDirX: number,
  windDirY: number,
  dx: number,
  dy: number,
  slopePct: number,
  fuelFactor: number,
  dryness: number,
  suppression = 1,
): number {
  if (behavior.ros <= 0) return 0;
  // Angle between heading (wind) direction and neighbor offset.
  const lu = Math.hypot(windDirX, windDirY) || 1;
  const lv = Math.hypot(dx, dy) || 1;
  const cos = (windDirX * dx + windDirY * dy) / (lu * lv);
  const theta = Math.acos(Math.max(-1, Math.min(1, cos)));
  let R = rosAtAngle(behavior, theta); // ft/min, heading-relative

  // Local slope kicker on top of the system phi_s already in `behavior`.
  if (slopePct > 0) {
    R *= 1 + Math.min(2, slopePct / 30);
  }

  const cellRun = CELL_SIZE_FT * lv; // diagonals are √2× longer
  const p = Math.min(1, (R * TICK_MIN) / cellRun);
  return p * fuelFactor * dryness * suppression;
}

export function step(
  grid: Grid,
  params: SimParams,
  _elevation?: number[][] | null,
): Grid {
  const next = cloneGrid(grid);
  const h = grid.length;
  const w = grid[0].length;

  const slopePct = meanSlopePct(grid);
  const behavior = systemBehavior(params, slopePct);
  if (behavior.reactionIntensity <= 0) {
    // Below extinction — fire does not propagate, just burns out.
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c = grid[y][x];
        if (c.status !== "burning") continue;
        next[y][x].fuel = Math.max(0, c.fuel - 5 * TICK_MIN);
        next[y][x].heat = Math.max(0, c.heat - 0.04 * TICK_MIN);
        if (next[y][x].fuel <= 0 || next[y][x].heat <= 0) {
          next[y][x].status = "burned";
          next[y][x].heat = 0;
        }
      }
    }
    return next;
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const cell = grid[y][x];
      if (cell.status !== "burning") continue;

      // Burnout per minute. Higher reaction intensity → faster consumption.
      const consume = 0.06 + cell.heat * 0.03;
      next[y][x].fuel = Math.max(0, cell.fuel - consume * 100 * TICK_MIN);
      next[y][x].heat = Math.max(0, cell.heat - 0.04 * TICK_MIN);

      if (next[y][x].fuel <= 0 || next[y][x].heat <= 0) {
        next[y][x].status = "burned";
        next[y][x].heat = 0;
      }

      for (const [dx, dy] of NEIGHBORS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;

        const neighbor = grid[ny][nx];
        if (neighbor.status !== "unburned" || neighbor.fuel <= 0) continue;

        const fuelFactor = neighbor.fuel / 100;
        const dryness = 1 - neighbor.moisture * 0.6;
        const localSlopePct = directionalSlopePct(
          cell.slope,
          cell.aspect,
          dx,
          dy,
        );

        const p = spreadProb(
          behavior,
          params.windDirX,
          params.windDirY,
          dx,
          dy,
          localSlopePct,
          fuelFactor,
          dryness,
        );

        if (Math.random() < p) {
          next[ny][nx].status = "burning";
          next[ny][nx].heat = 1;
        }
      }
    }
  }

  return next;
}

// Prescribed-fire stepper. Same physics, but with a holding-crew suppression
// coefficient to represent active control by qualified crew, lower-intensity
// ignition (backing/flanking strips), and contained spread.
export function stepControlled(
  grid: Grid,
  params: SimParams,
  _elevation?: number[][] | null,
): Grid {
  const next = cloneGrid(grid);
  const h = grid.length;
  const w = grid[0].length;

  const slopePct = meanSlopePct(grid);
  const behavior = systemBehavior(params, slopePct);

  // Calibrated so that an Rx-window scenario keeps spread <1 cell/min average.
  const SUPPRESSION = 0.4;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const cell = grid[y][x];
      if (cell.status !== "burning") continue;

      const consume = 0.04 + cell.heat * 0.02;
      next[y][x].fuel = Math.max(0, cell.fuel - consume * 100 * TICK_MIN);
      next[y][x].heat = Math.max(0, cell.heat - 0.03 * TICK_MIN);

      if (next[y][x].fuel <= 0 || next[y][x].heat <= 0) {
        next[y][x].status = "burned";
        next[y][x].heat = 0;
      }

      if (behavior.reactionIntensity <= 0) continue;

      for (const [dx, dy] of NEIGHBORS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;

        const neighbor = grid[ny][nx];
        if (neighbor.status !== "unburned" || neighbor.fuel <= 0) continue;

        const fuelFactor = neighbor.fuel / 100;
        const dryness = 1 - neighbor.moisture * 0.6;
        const localSlopePct = directionalSlopePct(
          cell.slope,
          cell.aspect,
          dx,
          dy,
        );

        const p = spreadProb(
          behavior,
          params.windDirX,
          params.windDirY,
          dx,
          dy,
          localSlopePct,
          fuelFactor,
          dryness,
          SUPPRESSION,
        );

        if (Math.random() < p) {
          next[ny][nx].status = "burning";
          next[ny][nx].heat = 0.5 + Math.random() * 0.3;
        }
      }
    }
  }

  return next;
}

// ── Risk scoring (Burning Index, NFDRS-style) ────────────────────────────────

export interface RiskBreakdown {
  score: number;
  factors: {
    fuelLoad: number;
    weather: number;
    wind: number;
    slope: number;
    continuity: number;
  };
  behavior: FireBehavior;
  rosChHr: number;
  flameLengthFt: number;
  meanSlopePct: number;
}

export function calculateRisk(
  grid: Grid,
  params: SimParams,
  elevation?: number[][] | null,
): number {
  return calculateRiskBreakdown(grid, params, elevation).score;
}

export function calculateRiskBreakdown(
  grid: Grid,
  params: SimParams,
  _elevation?: number[][] | null,
): RiskBreakdown {
  const slopePct = meanSlopePct(grid);
  const behavior = systemBehavior(params, slopePct);

  // NFDRS-style Burning Index ≈ 10 × flame length (ft).
  const score = Math.max(
    0,
    Math.min(100, Math.round(behavior.flameLength * 10)),
  );

  // Bar-graph factors — informational only.
  const fm = getFuelModel(params.fuelModelCode);
  const totalLoad =
    fm.w0_d1 + fm.w0_d10 + fm.w0_d100 + fm.w0_lh + fm.w0_lw;
  const fuelLoad = Math.min(1, totalLoad / 1.377); // 30 t/ac upper bound
  const weather = clamp01(
    (params.temperature - 40) / 60 + (60 - params.humidity) / 60,
  );
  const wind = clamp01(behavior.windFactor / 50);
  const slopeBar = clamp01(slopePct / 60);

  let continuity = 0;
  if (grid.length > 0) {
    const total = grid.length * grid[0].length;
    continuity = total > 0 ? clamp01(largestConnectedFuel(grid) / total) : 0;
  }

  return {
    score,
    factors: {
      fuelLoad,
      weather,
      wind,
      slope: slopeBar,
      continuity,
    },
    behavior,
    rosChHr: rosChHr(behavior.ros),
    flameLengthFt: behavior.flameLength,
    meanSlopePct: slopePct,
  };
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function largestConnectedFuel(grid: Grid): number {
  const h = grid.length;
  const w = grid[0]?.length ?? 0;
  const seen = new Uint8Array(w * h);
  let maxCluster = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (seen[y * w + x]) continue;
      const cell = grid[y][x];
      if (
        cell.fuel < 30 ||
        cell.status === "firebreak" ||
        cell.status === "burned"
      ) {
        seen[y * w + x] = 1;
        continue;
      }
      let size = 0;
      const stack: number[] = [y * w + x];
      while (stack.length) {
        const idx = stack.pop()!;
        if (seen[idx]) continue;
        seen[idx] = 1;
        const cx = idx % w;
        const cy = (idx - cx) / w;
        const c = grid[cy][cx];
        if (c.fuel < 30 || c.status === "firebreak" || c.status === "burned")
          continue;
        size++;
        if (cx > 0) stack.push(idx - 1);
        if (cx < w - 1) stack.push(idx + 1);
        if (cy > 0) stack.push(idx - w);
        if (cy < h - 1) stack.push(idx + w);
      }
      if (size > maxCluster) maxCluster = size;
    }
  }
  return maxCluster;
}

export function riskCategory(score: number): { label: string; color: string } {
  if (score <= 25) return { label: "LOW", color: "#3fb950" };
  if (score <= 50) return { label: "MODERATE", color: "#e3b341" };
  if (score <= 75) return { label: "HIGH", color: "#e8822a" };
  return { label: "VERY HIGH", color: "#f85149" };
}

// ── Controlled burn fuel-treatment optimizer ─────────────────────────────────
// Renamed from BurnPlan to BurnStripPlan to avoid collision with the PMS 484
// burn-plan document type defined in burnPlan.ts.

export interface BurnStripPlan {
  stripCount?: number;
  stripWidth?: number;
  reductionStrength?: number;
  windDirX?: number;
  windDirY?: number;
}

export function runControlledBurn(
  grid: Grid,
  plan: BurnStripPlan = {},
): Grid {
  const { stripCount = 4, stripWidth = 2, reductionStrength = 0.85 } = plan;
  const next = cloneGrid(grid);
  const h = grid.length;
  const w = grid[0].length;

  // Phase 1 — ridgeline anchors (top 3% slope cells).
  const slopes: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = grid[y][x];
      if (c.status !== "firebreak") slopes.push(c.slope);
    }
  }
  slopes.sort((a, b) => a - b);
  const ridgeThreshold =
    slopes.length > 0 ? slopes[Math.floor(slopes.length * 0.97)] : Infinity;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = next[y][x];
      if (c.status === "firebreak") continue;
      if (c.slope >= ridgeThreshold && ridgeThreshold < Infinity) {
        c.fuel = 0;
        c.status = "burned";
        c.heat = 0;
      }
    }
  }

  // Phase 2 — wind-perpendicular fuel strips.
  const windX = plan.windDirX ?? 0;
  const windY = plan.windDirY ?? 1;
  const useVerticalStrips = Math.abs(windX) >= Math.abs(windY);

  if (useVerticalStrips) {
    const colFuel: number[] = new Array(w).fill(0);
    for (let x = 0; x < w; x++)
      for (let y = 0; y < h; y++)
        if (grid[y][x].status !== "firebreak") colFuel[x] += grid[y][x].fuel;
    const colOrder = Array.from({ length: w }, (_, i) => i).sort(
      (a, b) => colFuel[b] - colFuel[a],
    );
    const spacing = Math.floor(w / (stripCount + 1));
    const chosen = new Set<number>();
    for (let s = 1; s <= stripCount; s++) {
      const anchor = s * spacing;
      let best = anchor;
      let bestFuel = -1;
      for (const cand of colOrder) {
        if (Math.abs(cand - anchor) <= spacing / 2 && colFuel[cand] > bestFuel) {
          bestFuel = colFuel[cand];
          best = cand;
        }
      }
      chosen.add(best);
    }
    for (const cx of chosen) {
      for (let dx = 0; dx < stripWidth; dx++) {
        const x = cx + dx;
        if (x < 0 || x >= w) continue;
        for (let y = 0; y < h; y++) {
          const c = next[y][x];
          if (c.status === "firebreak") continue;
          c.fuel = 0;
          c.status = "burned";
          c.heat = 0;
        }
      }
    }
  } else {
    const rowFuel: number[] = new Array(h).fill(0);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (grid[y][x].status !== "firebreak") rowFuel[y] += grid[y][x].fuel;
    const rowOrder = Array.from({ length: h }, (_, i) => i).sort(
      (a, b) => rowFuel[b] - rowFuel[a],
    );
    const spacing = Math.floor(h / (stripCount + 1));
    const chosen = new Set<number>();
    for (let s = 1; s <= stripCount; s++) {
      const anchor = s * spacing;
      let best = anchor;
      let bestFuel = -1;
      for (const cand of rowOrder) {
        if (Math.abs(cand - anchor) <= spacing / 2 && rowFuel[cand] > bestFuel) {
          bestFuel = rowFuel[cand];
          best = cand;
        }
      }
      chosen.add(best);
    }
    for (const ry of chosen) {
      for (let dy = 0; dy < stripWidth; dy++) {
        const y = ry + dy;
        if (y < 0 || y >= h) continue;
        for (let x = 0; x < w; x++) {
          const c = next[y][x];
          if (c.status === "firebreak") continue;
          c.fuel = 0;
          c.status = "burned";
          c.heat = 0;
        }
      }
    }
  }

  // Phase 3 — high-fuel cluster thinning (top 8% reduce by reductionStrength/2).
  const fuelValues: number[] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = next[y][x];
      if (c.status === "unburned" && c.fuel > 0) fuelValues.push(c.fuel);
    }
  fuelValues.sort((a, b) => a - b);
  const thinThreshold =
    fuelValues.length > 0
      ? fuelValues[Math.floor(fuelValues.length * 0.92)]
      : Infinity;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = next[y][x];
      if (c.status !== "unburned" || c.fuel < thinThreshold) continue;
      c.fuel = c.fuel * (1 - reductionStrength * 0.5);
    }
  }

  return next;
}

export function isAnyBurning(grid: Grid): boolean {
  for (const row of grid) {
    for (const cell of row) {
      if (cell.status === "burning") return true;
    }
  }
  return false;
}
