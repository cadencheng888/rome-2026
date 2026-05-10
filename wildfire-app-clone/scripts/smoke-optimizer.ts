// Quick end-to-end sanity check for the burn-plan optimizer.
// Builds a synthetic grid (random noise that mostly has high fuel),
// runs the optimizer, and prints summary stats. If this prints
// reasonable numbers (preBurn > postBurn, plan covers a few percent
// of the area), the optimizer is wired up correctly.
//
// Run with:  npx tsx scripts/smoke-optimizer.ts
//        or: node --import tsx scripts/smoke-optimizer.ts

import {
  createGrid,
  isAnyBurning,
  liveStats,
  projectWorstCase,
} from "../src/simulation/fireEngine";
import { optimizeBurnPlan, planToMask } from "../src/simulation/burnPlanOptimizer";

const W = 80;
const H = 70;

const grid = createGrid({ width: W, height: H, fuelDensity: 0.92, firebreakChance: 0.01 });
// Add some moisture variation so the spread isn't trivial.
for (const row of grid) {
  for (const cell of row) {
    cell.moisture = Math.random() * 0.3;
  }
}

// Simple synthetic elevation: a ridge across the middle.
const elevation: number[][] = [];
for (let y = 0; y < H; y++) {
  const row: number[] = [];
  for (let x = 0; x < W; x++) {
    const ridge = Math.exp(-Math.pow((y - H / 2) / 10, 2));
    row.push(ridge * 0.6 + Math.random() * 0.05);
  }
  elevation.push(row);
}

console.log(`grid:        ${W}×${H}`);
console.log(`burnable:    ${grid.flat().filter((c) => c.fuel > 0).length}`);

const startBaseline = Date.now();
const baseline = projectWorstCase(grid, elevation, { rollouts: 6, maxTicks: 100 });
const baselineMs = Date.now() - startBaseline;
console.log(`\nbaseline worst-case: ${(baseline * 100).toFixed(1)}%   (${baselineMs}ms for 6 rollouts)`);

const start = Date.now();
const plan = await optimizeBurnPlan(grid, elevation, {
  stripCount: 3,
  iterations: 30, // shorter for the smoke test
  rolloutsPerEval: 3,
  areaCostWeight: 0.55,
});
const optimizeMs = Date.now() - start;

console.log(`\noptimization:`);
console.log(`  ms:                  ${optimizeMs}`);
console.log(`  strips:              ${plan.strips.length}`);
console.log(`  cells in plan:       ${plan.cellsBurned}`);
console.log(`  burn fraction:       ${(plan.burnFraction * 100).toFixed(2)}%`);
console.log(`  pre-burn worst-case: ${(plan.preBurnWorstCase * 100).toFixed(1)}%`);
console.log(`  post-burn worst-case:${(plan.postBurnWorstCase * 100).toFixed(1)}%`);
console.log(`  benefit (pp):        ${((plan.preBurnWorstCase - plan.postBurnWorstCase) * 100).toFixed(1)}`);

const mask = planToMask(plan.strips, W, H);
let maskCount = 0;
for (const v of mask) if (v) maskCount++;
console.log(`  mask cells:          ${maskCount}`);

// Sanity assertions
const checks = [
  { name: "plan returned", pass: plan.strips.length > 0 },
  { name: "plan has cells", pass: plan.cellsBurned > 0 },
  // mask is the rasterized strip area (used for the visual overlay);
  // cellsBurned counts only cells applyBurnPlan actually wrote (it skips
  // firebreak cells). They can differ slightly when a strip crosses water /
  // pre-existing firebreaks. 50-cell tolerance is generous on 5000+ cells.
  { name: "mask is in same ballpark as cellsBurned", pass: Math.abs(maskCount - plan.cellsBurned) < 50 },
  { name: "burn fraction reasonable", pass: plan.burnFraction > 0.001 && plan.burnFraction < 0.5 },
  { name: "pre-burn ≥ post-burn", pass: plan.preBurnWorstCase >= plan.postBurnWorstCase - 0.05 },
  { name: "no NaN values", pass: Number.isFinite(plan.preBurnWorstCase) && Number.isFinite(plan.postBurnWorstCase) },
];

console.log(`\nchecks:`);
for (const { name, pass } of checks) {
  console.log(`  ${pass ? "✓" : "✗"} ${name}`);
}

const allPass = checks.every((c) => c.pass);
console.log(`\n${allPass ? "ALL PASS" : "FAILURES"}`);
process.exit(allPass ? 0 : 1);

void isAnyBurning;
void liveStats;
