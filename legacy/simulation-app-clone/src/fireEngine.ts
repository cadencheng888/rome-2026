export type CellStatus = 'unburned' | 'burning' | 'burned' | 'firebreak';

export interface Cell {
  fuel: number;
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
        status: isBreak ? 'firebreak' : 'unburned',
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
  if (next[y][x].status === 'unburned' && next[y][x].fuel > 0) {
    next[y][x].status = 'burning';
    next[y][x].heat = 1;
  }
  return next;
}

const NEIGHBORS: Array<[number, number]> = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0],           [1, 0],
  [-1, 1],  [0, 1],  [1, 1],
];

export function step(grid: Grid, params: SimParams): Grid {
  const next = cloneGrid(grid);
  const h = grid.length;
  const w = grid[0].length;

  const humidityFactor = 1 - params.humidity / 100;
  const tempFactor = Math.max(0.2, params.temperature / 100);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const cell = grid[y][x];
      if (cell.status !== 'burning') continue;

      const consume = 0.05 + (cell.heat * 0.03);
      next[y][x].fuel = Math.max(0, cell.fuel - consume * 100);
      next[y][x].heat = Math.max(0, cell.heat - 0.04);

      if (next[y][x].fuel <= 0 || next[y][x].heat <= 0) {
        next[y][x].status = 'burned';
        next[y][x].heat = 0;
      }

      for (const [dx, dy] of NEIGHBORS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;

        const neighbor = grid[ny][nx];
        if (neighbor.status !== 'unburned' || neighbor.fuel <= 0) continue;

        const windAlignment =
          dx * params.windDirX + dy * params.windDirY;
        const windBoost = Math.max(0, windAlignment) * (params.windSpeed / 30);

        const fuelFactor = neighbor.fuel / 100;
        const baseProb = 0.08 * fuelFactor * tempFactor * humidityFactor;
        const prob = baseProb * (1 + windBoost * 2.0);

        if (Math.random() < prob) {
          next[ny][nx].status = 'burning';
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
      if (cell.status === 'firebreak') continue;
      totalFuel += cell.fuel;
      cellCount++;
      if (cell.fuel > 60 && cell.status === 'unburned') highFuelCells++;
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

  const fuelLoad = (avgFuel / 100) * (1 + (highFuelCells / Math.max(cellCount, 1)) * 0.6);

  const rawRisk = fuelLoad * moistureFactor * windFactor * slopeFactor * continuityFactor;
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
      if (cell.fuel < 30 || cell.status === 'firebreak' || cell.status === 'burned') {
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
        if (c.fuel < 30 || c.status === 'firebreak' || c.status === 'burned') continue;
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
  if (score <= 25) return { label: 'LOW', color: '#3fb950' };
  if (score <= 50) return { label: 'MODERATE', color: '#d29922' };
  if (score <= 75) return { label: 'HIGH', color: '#f85149' };
  return { label: 'EXTREME', color: '#a371f7' };
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
        if (cell.status === 'firebreak') continue;
        cell.fuel = cell.fuel * (1 - reductionStrength);
        cell.status = 'burned';
        cell.heat = 0;
      }
    }
  }

  return next;
}

export function isAnyBurning(grid: Grid): boolean {
  for (const row of grid) {
    for (const cell of row) {
      if (cell.status === 'burning') return true;
    }
  }
  return false;
}
