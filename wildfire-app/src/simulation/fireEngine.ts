export type CellStatus =
  | "unburned"
  | "burning"
  | "burned"
  | "firebreak"
  | "residential"
  | "residential_burning"
  | "residential_destroyed";

export interface Cell {
  fuel: number;
  moisture: number;
  status: CellStatus;
  heat: number;
  residential?: boolean;
  water?: boolean;
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
  const cell = next[y][x];
  if (cell.status === "unburned" && cell.fuel > 0) {
    next[y][x].status = "burning";
    next[y][x].heat = 1;
  } else if (cell.status === "residential") {
    next[y][x].status = "residential_burning";
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
      const cell = next[ny][nx];
      if (cell.status === "unburned" && cell.fuel > 0) {
        next[ny][nx].status = "burning";
        next[ny][nx].heat = 0.7 + Math.random() * 0.3;
      } else if (cell.status === "residential") {
        next[ny][nx].status = "residential_burning";
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

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const cell = grid[y][x];
      const isBurning =
        cell.status === "burning" || cell.status === "residential_burning";
      if (!isBurning) continue;

      // Residential burns slower (more fuel, structure takes longer) but intensely
      const burnRate = cell.residential ? 0.025 : 0.05;
      const consume = burnRate + cell.heat * 0.03;
      next[y][x].fuel = Math.max(0, cell.fuel - consume * 100);
      next[y][x].heat = Math.max(0, cell.heat - 0.04);

      if (next[y][x].fuel <= 0 || next[y][x].heat <= 0) {
        next[y][x].status = cell.residential
          ? "residential_destroyed"
          : "burned";
        next[y][x].heat = 0;
      }

      for (const [dx, dy] of NEIGHBORS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;

        const neighbor = grid[ny][nx];
        const neighborIgnitable =
          (neighbor.status === "unburned" && neighbor.fuel > 0) ||
          neighbor.status === "residential";
        if (!neighborIgnitable) continue;

        const windAlignment = dx * params.windDirX + dy * params.windDirY;
        const windBoost = Math.max(0, windAlignment) * (params.windSpeed / 30);

        let elevBoost = 1.0;
        if (elevation) {
          const dElev = (elevation[ny]?.[nx] ?? 0) - (elevation[y]?.[x] ?? 0);
          elevBoost =
            dElev > 0 ? 1 + dElev * 5 : Math.max(0.4, 1 + dElev * 1.5);
        }

        const dryness = 1 - neighbor.moisture * 0.75;
        const fuelFactor = neighbor.fuel / 100;
        // Residential cells are slightly harder to ignite from outside (ember-resistant roofing etc)
        // but once a neighbor is burning the heat is intense
        const residentialFactor = neighbor.residential ? 0.7 : 1.0;
        const baseProb =
          0.08 * fuelFactor * tempFactor * humidityFactor * residentialFactor;
        const prob = baseProb * (1 + windBoost * 2.0) * elevBoost * dryness;

        if (Math.random() < prob) {
          if (neighbor.status === "residential") {
            next[ny][nx].status = "residential_burning";
          } else {
            next[ny][nx].status = "burning";
          }
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

  let totalFuel = 0,
    cellCount = 0,
    highFuelCells = 0;
  for (const row of grid) {
    for (const cell of row) {
      if (cell.status === "firebreak") continue;
      totalFuel += cell.fuel;
      cellCount++;
      if (
        cell.fuel > 60 &&
        (cell.status === "unburned" || cell.status === "residential")
      )
        highFuelCells++;
    }
  }
  const avgFuel = cellCount > 0 ? totalFuel / cellCount : 0;

  const safeHumidity = Math.max(params.humidity, 1);
  const moistureFactor = params.temperature / safeHumidity;
  const windFactor = Math.pow(Math.max(params.windSpeed, 1), 1.2);

  let slopeFactor = 1.0;
  if (elevation && elevation.length === h && elevation[0]?.length === w) {
    let slopeSum = 0,
      slopeN = 0;
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
  const score = Math.min(Math.max(Math.round((rawRisk / 6800) * 100), 0), 100);

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
        cell.status === "burned" ||
        cell.status === "residential_destroyed"
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
        if (
          c.fuel < 30 ||
          c.status === "firebreak" ||
          c.status === "burned" ||
          c.status === "residential_destroyed"
        )
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
        // Never clear residential cells in a controlled burn — crews protect structures
        if (cell.status === "firebreak" || cell.status === "residential")
          continue;
        cell.fuel = cell.fuel * (1 - reductionStrength);
        cell.status = "burned";
        cell.heat = 0;
      }
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

// Like step() but with reduced spread probability to simulate a managed/controlled burn.
export function stepControlled(
  grid: Grid,
  params: SimParams,
  elevation?: number[][] | null
): Grid {
  const reducedParams: SimParams = {
    ...params,
    windSpeed: params.windSpeed * 0.4,
    temperature: Math.max(20, params.temperature * 0.7),
  };
  return step(grid, reducedParams, elevation);
}

export function isAnyBurning(grid: Grid): boolean {
  for (const row of grid) {
    for (const cell of row) {
      if (cell.status === "burning" || cell.status === "residential_burning")
        return true;
    }
  }
  return false;
}

// ── Settlement placement ──────────────────────────────────────────────────────

export interface Settlement {
  type: "town" | "hamlet" | "rural";
  cx: number;
  cy: number;
  cells: Array<{ x: number; y: number }>;
}

/**
 * Stamps residential zones onto an existing grid.
 * Layouts are deterministic in shape but positioned with slight randomness
 * so each map feels unique while ensuring settlements are spread across the terrain.
 */
export function placeSettlements(
  grid: Grid,
  seed = Math.random()
): { grid: Grid; settlements: Settlement[] } {
  const next = cloneGrid(grid);
  const h = next.length;
  const w = next[0].length;
  const settlements: Settlement[] = [];

  // Helper: mark a cell as residential if it's in-bounds, not a firebreak, and not water
  function stamp(x: number, y: number, cells: Array<{ x: number; y: number }>) {
    if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) return;
    if (next[y][x].status === "firebreak") return;
    if (next[y][x].water) return; // never place structures on water
    next[y][x] = {
      ...next[y][x],
      status: "residential",
      fuel: 90 + Math.random() * 10, // structures have lots of fuel
      residential: true,
    };
    cells.push({ x, y });
  }

  // ── Town: dense ~20-cell cluster, upper-left quadrant ────────────────────
  {
    const cx = Math.round(w * 0.22 + ((seed * 7) % 1) * w * 0.1);
    const cy = Math.round(h * 0.28 + ((seed * 13) % 1) * h * 0.1);
    const cells: Array<{ x: number; y: number }> = [];

    // Grid-like town layout: 4×3 block of buildings with gaps (streets)
    const blocks = [
      [0, 0],
      [1, 0],
      [3, 0],
      [4, 0],
      [0, 2],
      [1, 2],
      [2, 2],
      [3, 2],
      [4, 2],
      [0, 4],
      [2, 4],
      [3, 4],
      [4, 4],
      [1, 4],
      [1, 3],
    ];
    for (const [bx, by] of blocks) {
      stamp(cx + bx, cy + by, cells);
    }
    if (cells.length > 0) settlements.push({ type: "town", cx, cy, cells });
  }

  // ── Hamlet 1: small cluster, right side ──────────────────────────────────
  {
    const cx = Math.round(w * 0.72 + ((seed * 3) % 1) * w * 0.08);
    const cy = Math.round(h * 0.35 + ((seed * 17) % 1) * h * 0.1);
    const cells: Array<{ x: number; y: number }> = [];
    const pattern = [
      [0, 0],
      [1, 0],
      [0, 1],
      [2, 1],
      [1, 2],
    ];
    for (const [bx, by] of pattern) stamp(cx + bx, cy + by, cells);
    if (cells.length > 0) settlements.push({ type: "hamlet", cx, cy, cells });
  }

  // ── Hamlet 2: lower-center ────────────────────────────────────────────────
  {
    const cx = Math.round(w * 0.45 + ((seed * 11) % 1) * w * 0.1);
    const cy = Math.round(h * 0.68 + ((seed * 5) % 1) * h * 0.08);
    const cells: Array<{ x: number; y: number }> = [];
    const pattern = [
      [0, 0],
      [2, 0],
      [1, 0],
      [0, 2],
      [1, 1],
    ];
    for (const [bx, by] of pattern) stamp(cx + bx, cy + by, cells);
    if (cells.length > 0) settlements.push({ type: "hamlet", cx, cy, cells });
  }

  // ── Rural ribbon: sparse houses along a diagonal "road" ──────────────────
  {
    const cells: Array<{ x: number; y: number }> = [];
    const startX = Math.round(w * 0.3);
    const startY = Math.round(h * 0.5);
    const count = 6;
    for (let i = 0; i < count; i++) {
      const rx = startX + i * 7 + Math.round((seed * i * 3) % 3);
      const ry = startY + Math.round(Math.sin(i * 1.2) * 3);
      stamp(rx, ry, cells);
      // Occasionally add a second house next to the road
      if (i % 2 === 0) stamp(rx, ry + 2, cells);
    }
    if (cells.length > 0)
      settlements.push({ type: "rural", cx: startX, cy: startY, cells });
  }

  return { grid: next, settlements };
}

/** Count intact and destroyed structures across the grid */
export function countStructures(grid: Grid): {
  total: number;
  destroyed: number;
  intact: number;
} {
  let total = 0,
    destroyed = 0;
  for (const row of grid) {
    for (const cell of row) {
      if (cell.residential) {
        total++;
        if (cell.status === "residential_destroyed") destroyed++;
      }
    }
  }
  return { total, destroyed, intact: total - destroyed };
}
