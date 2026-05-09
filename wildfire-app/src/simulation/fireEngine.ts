export type CellStatus = "unburned" | "burning" | "burned" | "firebreak";

export interface Cell {
  fuel: number;
  moisture: number; // 0 = dry, 1 = wet — from NDMI band
  slope: number; // degrees, from TIFF slope band (0 if unavailable)
  aspect: number; // degrees 0–360 (0=N,90=E,180=S,270=W), from TIFF aspect band
  status: CellStatus;
  heat: number;
}

export type Grid = Cell[][];

export interface SimParams {
  windSpeed: number;
  windDirX: number;
  windDirY: number;
  humidity: number;
  temperature: number;
}

export interface GridOptions {
  width: number;
  height: number;
  fuelDensity?: number;
  firebreakChance?: number;
}

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
  radius = 2
): Grid {
  let next = cloneGrid(grid);
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

/**
 * Converts a slope in degrees and an aspect in degrees (0=N, 90=E, 180=S, 270=W)
 * into an elevation boost multiplier for fire spread from (x,y) toward (nx,ny).
 *
 * This replaces the old raw-elevation-delta approach, which conflated gentle
 * slopes with cliffs and produced boost values that varied with grid resolution.
 * Using the TIFF's actual slope band (in degrees) gives a physically meaningful,
 * resolution-independent result.
 *
 * The aspect tells us which direction the slope faces. We compute how much of
 * the spread direction aligns with the downslope direction; upslope spread
 * is boosted, downslope is penalized.
 */
function slopeBoost(
  slopeDeg: number,
  aspectDeg: number,
  dx: number,
  dy: number
): number {
  if (slopeDeg < 0.5) return 1.0; // effectively flat

  // Aspect convention: 0=N, 90=E → convert to unit vector pointing downslope.
  // In image/grid space: +y is south, +x is east.
  const aspectRad = (aspectDeg * Math.PI) / 180;
  const downX = Math.sin(aspectRad); // east component of downslope
  const downY = Math.cos(aspectRad); // south component of downslope

  // Spread direction vector (not normalized for diagonals — intentional;
  // diagonal spread already travels farther, so we keep consistent units).
  const len = Math.sqrt(dx * dx + dy * dy);
  const spreadX = dx / len;
  const spreadY = dy / len;

  // Alignment: +1 = spreading directly upslope (fire accelerates),
  //            -1 = spreading directly downslope (fire decelerates).
  const alignment = spreadX * downX + spreadY * downY;

  // Slope factor: Rothermel-style. A 30° slope roughly doubles spread rate.
  // alignment=+1 (upslope) → full boost, alignment=-1 (downslope) → penalty.
  const slopeFactor = Math.tan((slopeDeg * Math.PI) / 180);
  const boost = 1.0 + alignment * slopeFactor * 3.5;
  return Math.max(0.3, boost);
}

export function step(
  grid: Grid,
  params: SimParams,
  // elevation kept for API compatibility but slope/aspect from Cell are preferred
  _elevation?: number[][] | null
): Grid {
  const next = cloneGrid(grid);
  const h = grid.length;
  const w = grid[0].length;

  const humidityFactor = 1 - params.humidity / 100;
  const tempFactor = Math.max(0.2, params.temperature / 100);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const cell = grid[y][x];
      if (cell.status !== "burning") continue;

      const consume = 0.05 + cell.heat * 0.03;
      next[y][x].fuel = Math.max(0, cell.fuel - consume * 100);
      next[y][x].heat = Math.max(0, cell.heat - 0.04);

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

        // Wind: boost spread in wind direction.
        const windAlignment = dx * params.windDirX + dy * params.windDirY;
        const windBoost = Math.max(0, windAlignment) * (params.windSpeed / 30);

        // Slope: use the burning cell's slope/aspect to determine uphill/downhill.
        // (The source cell's slope is what drives fire behavior.)
        const elevBoost = slopeBoost(cell.slope, cell.aspect, dx, dy);

        // Moisture: wet cells resist ignition (NDMI-driven).
        const dryness = 1 - neighbor.moisture * 0.75;
        const fuelFactor = neighbor.fuel / 100;
        const baseProb = 0.08 * fuelFactor * tempFactor * humidityFactor;
        const prob = baseProb * (1 + windBoost * 2.0) * elevBoost * dryness;

        if (Math.random() < prob) {
          next[ny][nx].status = "burning";
          next[ny][nx].heat = 1;
        }
      }
    }
  }

  return next;
}

// ---------------------------------------------------------------------------
// Risk scoring
// ---------------------------------------------------------------------------

export interface RiskBreakdown {
  score: number;
  factors: {
    fuelLoad: number;
    weather: number;
    wind: number;
    slope: number;
    continuity: number;
  };
}

export function calculateRisk(
  grid: Grid,
  params: SimParams,
  elevation?: number[][] | null
): number {
  return calculateRiskBreakdown(grid, params, elevation).score;
}

export function calculateRiskBreakdown(
  grid: Grid,
  params: SimParams,
  _elevation?: number[][] | null // no longer used; slope is in cells
): RiskBreakdown {
  const h = grid.length;
  const w = grid[0]?.length ?? 0;

  let totalFuel = 0;
  let totalMoisture = 0;
  let cellCount = 0;
  let highFuelCells = 0;
  let totalSlope = 0;
  let slopeCellCount = 0;

  for (const row of grid) {
    for (const cell of row) {
      if (cell.status === "firebreak") continue;
      totalFuel += cell.fuel;
      totalMoisture += cell.moisture;
      cellCount++;
      if (cell.fuel > 60 && cell.status === "unburned") highFuelCells++;
      if (cell.slope > 0) {
        totalSlope += cell.slope;
        slopeCellCount++;
      }
    }
  }

  const avgFuel = cellCount > 0 ? totalFuel / cellCount : 0;
  const avgMoisture = cellCount > 0 ? totalMoisture / cellCount : 0;

  // Fuel load factor: high fuel + low moisture = higher risk.
  // Previously moisture (NDMI) was ignored here even though it's loaded into cells.
  const drynessFactor = 1 - avgMoisture * 0.6;
  const fuelLoad =
    (avgFuel / 100) *
    (1 + (highFuelCells / Math.max(cellCount, 1)) * 0.6) *
    drynessFactor;

  // Weather: temperature / humidity interaction.
  const safeHumidity = Math.max(params.humidity, 1);
  const moistureFactor = params.temperature / safeHumidity;

  // Wind.
  const windFactor = Math.pow(Math.max(params.windSpeed, 1), 1.2);

  // Slope: use per-cell slope degrees from TIFF band.
  // Average slope in degrees → factor. 30° ≈ +60% risk.
  const avgSlopeDeg = slopeCellCount > 0 ? totalSlope / slopeCellCount : 0;
  const slopeFactor = 1 + Math.min(0.6, avgSlopeDeg / 50);

  // Fuel continuity: fraction of grid covered by largest connected fuel cluster.
  const continuity = largestConnectedFuel(grid);
  const continuityRatio = cellCount > 0 ? continuity / cellCount : 0;
  const continuityFactor = 0.7 + continuityRatio * 0.9;

  // Raw risk score. Instead of a magic-number ceiling, we normalize against a
  // computed reference scenario (calm, moist, flat) so the scale is self-calibrating.
  const rawRisk =
    fuelLoad * moistureFactor * windFactor * slopeFactor * continuityFactor;

  // Reference: avgFuel=100, highFuelRatio=1, moisture=0 → fuelLoad≈1.6
  //            temp=110, humidity=5 → moistureFactor=22
  //            windSpeed=60 → windFactor≈116
  //            slopeDeg=45 → slopeFactor=1.6
  //            continuityRatio=1 → continuityFactor=1.6
  // = 1.6 * 22 * 116 * 1.6 * 1.6 ≈ 10 500
  const maxExpectedRisk = 10_500;
  const pct = (rawRisk / maxExpectedRisk) * 100;
  const score = Math.min(Math.max(Math.round(pct), 0), 100);

  return {
    score,
    factors: {
      fuelLoad: clamp01(fuelLoad / 1.6),
      weather: clamp01(moistureFactor / 22),
      wind: clamp01(windFactor / 116),
      slope: clamp01((slopeFactor - 1) / 0.6),
      continuity: clamp01(continuityRatio),
    },
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
  // Matches real-world fire danger rating signs:
  // Low (green) → Moderate (yellow) → High (orange) → Very High (red)
  if (score <= 25) return { label: "LOW", color: "#3fb950" }; // green
  if (score <= 50) return { label: "MODERATE", color: "#e3b341" }; // yellow
  if (score <= 75) return { label: "HIGH", color: "#e8822a" }; // orange
  return { label: "VERY HIGH", color: "#f85149" }; // red
}

// ---------------------------------------------------------------------------
// Controlled burn optimizer
// ---------------------------------------------------------------------------

export interface BurnPlan {
  stripCount?: number;
  stripWidth?: number;
  reductionStrength?: number;
}

/**
 * Optimized controlled burn planner.
 *
 * OLD behavior: burned evenly-spaced horizontal strips, ignoring terrain,
 * wind direction, and fuel distribution entirely.
 *
 * NEW behavior — three-phase strategy:
 *
 * 1. RIDGELINE ANCHORS — place firebreaks on high-slope ridge cells.
 *    Ridgelines are natural spread accelerators; eliminating fuel there
 *    removes the terrain boost that makes uphill runs so dangerous.
 *
 * 2. WIND-PERPENDICULAR BREAKS — place strips perpendicular to the dominant
 *    wind vector, targeting rows/columns with the highest fuel load.
 *    A break parallel to the wind does almost nothing; one perpendicular
 *    to it forces a fire to cross bare ground to continue spreading.
 *
 * 3. HIGH-FUEL CLUSTER THINNING — reduce (but not zero) fuel in the
 *    highest-density cells not already addressed by steps 1–2.
 *    Thinning preserves some ground cover (erosion control) while
 *    lowering crown-fire risk.
 */
export function runControlledBurn(grid: Grid, plan: BurnPlan = {}): Grid {
  const { stripCount = 4, stripWidth = 2, reductionStrength = 0.85 } = plan;

  const next = cloneGrid(grid);
  const h = grid.length;
  const w = grid[0].length;

  // -------------------------------------------------------------------------
  // Phase 1 — Ridgeline anchors
  // Find the top-N slope cells and clear a firebreak through them.
  // We score each cell by slope; the top 3% are treated as ridgeline anchors.
  // -------------------------------------------------------------------------
  const slopeThresholdPct = 0.97;
  const slopes: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = grid[y][x];
      if (c.status !== "firebreak") slopes.push(c.slope);
    }
  }
  slopes.sort((a, b) => a - b);
  const ridgeThreshold =
    slopes.length > 0
      ? slopes[Math.floor(slopes.length * slopeThresholdPct)]
      : Infinity;

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

  // -------------------------------------------------------------------------
  // Phase 2 — Wind-perpendicular firebreak strips
  //
  // Determine spread axis: the dominant wind direction tells us which grid
  // axis fire will travel along. We place breaks perpendicular to that axis.
  //
  // If |windDirX| >= |windDirY|: wind is primarily east-west → fire spreads
  //   along columns → breaks should be vertical strips (fixed x).
  // Otherwise: wind is primarily north-south → fire spreads along rows →
  //   breaks should be horizontal strips (fixed y).
  //
  // Among all candidate strips, we pick the ones with the highest total
  // burnable fuel (those are the most impactful to remove).
  // -------------------------------------------------------------------------

  // We need the wind from the grid's params — callers set windDirX/Y on SimParams.
  // Since BurnPlan doesn't carry params, we infer dominant axis from the grid's
  // aspect distribution as a fallback proxy for wind when no explicit direction
  // is passed. But the cleaner fix is to accept params in the plan:
  const windX = plan.windDirX ?? 0;
  const windY = plan.windDirY ?? 1; // default: northerly wind (fire spreads south)

  const useVerticalStrips = Math.abs(windX) >= Math.abs(windY);

  if (useVerticalStrips) {
    // Score each column by total fuel.
    const colFuel: number[] = new Array(w).fill(0);
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        const c = grid[y][x];
        if (c.status !== "firebreak") colFuel[x] += c.fuel;
      }
    }
    const colOrder = Array.from({ length: w }, (_, i) => i).sort(
      (a, b) => colFuel[b] - colFuel[a]
    );
    const spacing = Math.floor(w / (stripCount + 1));
    // Pick evenly-distributed columns biased toward high fuel.
    const chosen = new Set<number>();
    for (let s = 1; s <= stripCount; s++) {
      const anchor = s * spacing;
      // Among candidates ±spacing/2 from anchor, pick highest-fuel column.
      let best = anchor;
      let bestFuel = -1;
      for (let candidate of colOrder) {
        if (Math.abs(candidate - anchor) <= spacing / 2) {
          if (colFuel[candidate] > bestFuel) {
            bestFuel = colFuel[candidate];
            best = candidate;
          }
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
    // Score each row by total fuel.
    const rowFuel: number[] = new Array(h).fill(0);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c = grid[y][x];
        if (c.status !== "firebreak") rowFuel[y] += c.fuel;
      }
    }
    const rowOrder = Array.from({ length: h }, (_, i) => i).sort(
      (a, b) => rowFuel[b] - rowFuel[a]
    );
    const spacing = Math.floor(h / (stripCount + 1));
    const chosen = new Set<number>();
    for (let s = 1; s <= stripCount; s++) {
      const anchor = s * spacing;
      let best = anchor;
      let bestFuel = -1;
      for (let candidate of rowOrder) {
        if (Math.abs(candidate - anchor) <= spacing / 2) {
          if (rowFuel[candidate] > bestFuel) {
            bestFuel = rowFuel[candidate];
            best = candidate;
          }
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

  // -------------------------------------------------------------------------
  // Phase 3 — High-fuel cluster thinning
  // Reduce (not zero) fuel in the top-density cells not already cleared.
  // This lowers crown-fire risk while preserving ground cover.
  // Target: top 8% of unburned cells by fuel value, reduce by reductionStrength.
  // -------------------------------------------------------------------------
  const fuelValues: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = next[y][x];
      if (c.status === "unburned" && c.fuel > 0) fuelValues.push(c.fuel);
    }
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
      // Thin rather than zero — partial reduction, not full removal.
      c.fuel = c.fuel * (1 - reductionStrength * 0.5);
    }
  }

  return next;
}

/**
 * Extended plan type used by the optimizer UI.
 * Adds wind direction so the planner can orient breaks correctly.
 */
export interface BurnPlan {
  stripCount?: number;
  stripWidth?: number;
  reductionStrength?: number;
  windDirX?: number;
  windDirY?: number;
}

export function isAnyBurning(grid: Grid): boolean {
  for (const row of grid) {
    for (const cell of row) {
      if (cell.status === "burning") return true;
    }
  }
  return false;
}
