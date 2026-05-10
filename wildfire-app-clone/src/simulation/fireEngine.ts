export type CellStatus = "unburned" | "burning" | "burned" | "firebreak";

export interface Cell {
  fuel: number;
  moisture: number; // 0 = dry (ignites easily), 1 = wet (resists fire) — driven by NDMI band
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

export function step(
  grid: Grid,
  params: SimParams,
  elevation?: number[][] | null
): Grid {
  const next = cloneGrid(grid);
  const h = grid.length;
  const w = grid[0].length;

  const humidityFactor = 1 - params.humidity / 100;
  const tempFactor = Math.max(0.2, params.temperature / 100);

  // Spotting: each burning cell occasionally throws an ember several cells
  // downwind, igniting a new spot fire. Real wildfires routinely jump
  // firebreaks this way; without it, our prescribed-burn strips would feel
  // too effective vs. reality. Probability scales with wind speed; distance
  // is exponentially distributed (typical spotting range is short, but the
  // tail is long).
  const spotProbPerCell = Math.min(0.04, params.windSpeed / 600);
  const meanSpotDistance = 4 + params.windSpeed / 6; // cells

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

      // Throw an ember (rare). Embers only carry the way the wind blows.
      if (cell.heat > 0.4 && Math.random() < spotProbPerCell) {
        const dist = -Math.log(1 - Math.random()) * meanSpotDistance;
        const sx = Math.round(x + params.windDirX * dist);
        const sy = Math.round(y + params.windDirY * dist);
        if (sx >= 0 && sy >= 0 && sx < w && sy < h) {
          const target = next[sy][sx];
          if (target.status === "unburned" && target.fuel > 25) {
            const dryness = 1 - target.moisture * 0.75;
            // Dry receptive fuel ignites; soaked fuel often won't.
            if (Math.random() < 0.55 * dryness) {
              target.status = "burning";
              target.heat = 0.85;
            }
          }
        }
      }

      for (const [dx, dy] of NEIGHBORS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;

        const neighbor = grid[ny][nx];
        if (neighbor.status !== "unburned" || neighbor.fuel <= 0) continue;

        const windAlignment = dx * params.windDirX + dy * params.windDirY;
        const windBoost = Math.max(0, windAlignment) * (params.windSpeed / 30);

        // Uphill spread is faster; downhill is slower.
        let elevBoost = 1.0;
        if (elevation) {
          const dElev = (elevation[ny]?.[nx] ?? 0) - (elevation[y]?.[x] ?? 0);
          elevBoost =
            dElev > 0
              ? 1 + dElev * 5 // uphill: significant boost
              : Math.max(0.4, 1 + dElev * 1.5); // downhill: moderate penalty
        }

        // Wet cells (high NDMI) resist ignition.
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
  elevation?: number[][] | null
): RiskBreakdown {
  const h = grid.length;
  const w = grid[0]?.length ?? 0;

  let totalFuel = 0;
  let cellCount = 0;
  let highFuelCells = 0;
  for (const row of grid) {
    for (const cell of row) {
      if (cell.status === "firebreak") continue;
      totalFuel += cell.fuel;
      cellCount++;
      if (cell.fuel > 60 && cell.status === "unburned") highFuelCells++;
    }
  }
  const avgFuel = cellCount > 0 ? totalFuel / cellCount : 0;

  const safeHumidity = Math.max(params.humidity, 1);
  const moistureFactor = params.temperature / safeHumidity;
  const windFactor = Math.pow(Math.max(params.windSpeed, 1), 1.2);

  let slopeFactor = 1.0;
  if (elevation && elevation.length === h && elevation[0]?.length === w) {
    let slopeSum = 0;
    let slopeN = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const dx = elevation[y][x + 1] - elevation[y][x - 1];
        const dy = elevation[y + 1][x] - elevation[y - 1][x];
        slopeSum += Math.sqrt(dx * dx + dy * dy);
        slopeN++;
      }
    }
    const avgSlope = slopeN > 0 ? slopeSum / slopeN : 0;
    slopeFactor = 1 + Math.min(0.6, avgSlope * 18);
  }

  const continuity = largestConnectedFuel(grid);
  const continuityRatio = cellCount > 0 ? continuity / cellCount : 0;
  const continuityFactor = 0.7 + continuityRatio * 0.9;

  const fuelLoad =
    (avgFuel / 100) * (1 + (highFuelCells / Math.max(cellCount, 1)) * 0.6);

  const rawRisk =
    fuelLoad * moistureFactor * windFactor * slopeFactor * continuityFactor;
  const maxExpectedRisk = 6800;
  const pct = (rawRisk / maxExpectedRisk) * 100;
  const score = Math.min(Math.max(Math.round(pct), 0), 100);

  return {
    score,
    factors: {
      fuelLoad: clamp01(fuelLoad / 1.6),
      weather: clamp01(moistureFactor / 8),
      wind: clamp01(windFactor / 90),
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
  if (score <= 25) return { label: "LOW", color: "#3fb950" };
  if (score <= 50) return { label: "MODERATE", color: "#d29922" };
  if (score <= 75) return { label: "HIGH", color: "#f85149" };
  return { label: "EXTREME", color: "#a371f7" };
}

export interface BurnPlan {
  stripCount?: number;
  stripWidth?: number;
  reductionStrength?: number;
}

export function runControlledBurn(grid: Grid, plan: BurnPlan = {}): Grid {
  const { stripCount = 4, stripWidth = 2, reductionStrength = 0.85 } = plan;
  const next = cloneGrid(grid);
  const h = grid.length;
  const w = grid[0].length;

  const spacing = Math.floor(h / (stripCount + 1));

  for (let s = 1; s <= stripCount; s++) {
    const stripY = s * spacing;
    for (let dy = 0; dy < stripWidth; dy++) {
      const y = stripY + dy;
      if (y < 0 || y >= h) continue;
      for (let x = 0; x < w; x++) {
        const cell = next[y][x];
        if (cell.status === "firebreak") continue;
        cell.fuel = cell.fuel * (1 - reductionStrength);
        cell.status = "burned";
        cell.heat = 0;
      }
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

// ─────────────────────────────────────────────────────────────────────────
// Live state + worst-case forecast
// ─────────────────────────────────────────────────────────────────────────

export interface LiveStats {
  burning: number;
  burned: number;
  unburned: number;
  firebreak: number;
  totalCells: number;
  burningPct: number;
  burnedPct: number;
  fireFront: number; // # burning cells touching unburned fuel
}

export function liveStats(grid: Grid): LiveStats {
  const h = grid.length;
  const w = grid[0]?.length ?? 0;
  let burning = 0;
  let burned = 0;
  let unburned = 0;
  let firebreak = 0;
  let fireFront = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = grid[y][x];
      if (c.status === "burning") {
        burning++;
        // count if any 4-neighbor is unburned fuel (defines the active front)
        if (
          (y > 0 && grid[y - 1][x].status === "unburned" && grid[y - 1][x].fuel > 0) ||
          (y < h - 1 && grid[y + 1][x].status === "unburned" && grid[y + 1][x].fuel > 0) ||
          (x > 0 && grid[y][x - 1].status === "unburned" && grid[y][x - 1].fuel > 0) ||
          (x < w - 1 && grid[y][x + 1].status === "unburned" && grid[y][x + 1].fuel > 0)
        ) {
          fireFront++;
        }
      } else if (c.status === "burned") {
        burned++;
      } else if (c.status === "firebreak") {
        firebreak++;
      } else {
        unburned++;
      }
    }
  }
  const totalCells = burning + burned + unburned + firebreak;
  return {
    burning,
    burned,
    unburned,
    firebreak,
    totalCells,
    burningPct: totalCells ? burning / totalCells : 0,
    burnedPct: totalCells ? burned / totalCells : 0,
    fireFront,
  };
}

const EXTREME_PARAMS: SimParams = {
  windSpeed: 32,
  windDirX: 1,
  windDirY: 0,
  humidity: 8,
  temperature: 100,
};

/**
 * Estimate "if we don't intervene, how much of the landscape would burn
 * under hot/dry/windy conditions?" Runs N short rollouts from random
 * high-fuel ignition points and returns the mean burned fraction.
 *
 * This is the objective the burn-plan optimizer minimizes (post-treatment)
 * and what the sidebar shows users as the headline forecast number.
 */
export function projectWorstCase(
  grid: Grid,
  elevation: number[][] | null = null,
  options: {
    rollouts?: number;
    maxTicks?: number;
    ignitionsPerRollout?: number;
    seed?: number;
  } = {}
): number {
  const {
    rollouts = 6,
    maxTicks = 140,
    ignitionsPerRollout = 3,
  } = options;
  const h = grid.length;
  const w = grid[0]?.length ?? 0;
  if (!h || !w) return 0;

  // Pre-compute candidate ignition cells: high fuel, currently unburned.
  const candidates: Array<[number, number]> = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = grid[y][x];
      if (c.status === "unburned" && c.fuel > 50) candidates.push([x, y]);
    }
  }
  if (!candidates.length) return 0;

  let totalBurnedFrac = 0;
  for (let r = 0; r < rollouts; r++) {
    let g = cloneGrid(grid);
    // Random extreme wind direction per rollout for variance.
    const angle = (r / Math.max(rollouts, 1)) * Math.PI * 2;
    const params: SimParams = {
      ...EXTREME_PARAMS,
      windDirX: Math.cos(angle),
      windDirY: Math.sin(angle),
    };
    // Seed N ignitions
    for (let i = 0; i < ignitionsPerRollout; i++) {
      const [ix, iy] = candidates[Math.floor(Math.random() * candidates.length)];
      g = ignite(g, ix, iy);
    }
    // Run until quiescent or budget exhausted.
    for (let t = 0; t < maxTicks; t++) {
      if (!isAnyBurning(g)) break;
      g = step(g, params, elevation);
    }
    const stats = liveStats(g);
    totalBurnedFrac += stats.burnedPct;
  }
  return totalBurnedFrac / rollouts;
}
