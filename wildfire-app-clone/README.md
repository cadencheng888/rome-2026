# Wildfire Burn Planner

An interactive globe → 3D landscape → fire-spread simulator with an AI burn-plan optimizer.
Pick a notable wildfire location on the globe; the app loads a satellite tile, runs a simulator
upgraded with slope and ember spotting, and proposes prescribed-burn locations that minimize
the worst-case future fire.

## What it does

1. **Globe** — `globe.gl` Earth with pins at notable wildfire locations.
2. **Simulation** — opens on click. Each location has a bundled GeoTIFF (NDVI + DEM); the app
   parses it in-browser and feeds the per-cell fuel & elevation into a cellular-automaton
   fire engine.
3. **Burn-plan optimizer** — for each location, a black-box optimizer (simulated annealing
   over a 15-parameter strip space) searches for treatments that minimize the worst-case
   wildfire damage. Results are cached in `localStorage` so it only runs once per location.
4. **Live dashboard** — sidebar shows live state, a worst-case forecast (before vs. after
   the suggested treatment), and an "Execute plan" button that applies the burn so you can
   see how the same wildfire behaves on the treated landscape.

## Simulator improvements over the baseline

The fire engine in `src/simulation/fireEngine.ts` includes:

- **Slope-aware spread** — per-neighbor uphill boost (~5×) and downhill damping (~0.4× floor),
  matching the field rule of thumb that fire roughly doubles every 10° upslope.
- **Probabilistic ember spotting** — each burning cell occasionally throws an ember several
  cells downwind. Distance is exponentially distributed; probability scales with wind speed.
  Without this, prescribed-burn strips would be impervious to fire, which is unrealistic.
- **NDMI moisture per cell** — wet cells resist ignition independently of NDVI.
- **`projectWorstCase()`** — runs N rollouts under hot/dry/windy conditions and returns the
  expected burned-area fraction. Used both as the optimizer's objective and as the headline
  number in the sidebar.

## Burn-plan optimizer

`src/simulation/burnPlanOptimizer.ts` parameterizes a candidate prescribed burn as 3 strips,
each with `(cx, cy, length, angle, width)` — a 15-dimensional search space. Simulated
annealing maximizes:

```
benefit = worstCase(landscape, untreated)
        − worstCase(landscape, after burn plan)
        − areaCostWeight × burnFraction
```

Both worst-case values are stochastic (Monte Carlo), so the search is noise-tolerant. The
result is cached client-side keyed by location id.

## Honest caveats

- **NDVI is not fuel.** Sentinel NDVI tells you how green vegetation is *right now*, not how
  much dead biomass is available to burn. The real fix is to layer in LANDFIRE fuel-model
  rasters (Anderson 13 / Scott & Burgan 40) — see issue tracker.
- **The simulator is not Rothermel-grade.** It captures the right qualitative behavior
  (wind, slope, fuel continuity, spotting) but the spread probabilities are tuned, not
  derived from heat balance. Don't use this for real planning.
- **The model is optimal *for the simulator*.** If a real wildfire had different spotting
  distance, fuel moisture, or crown-fire dynamics, the suggested burn might not perform as
  predicted.
- **No real-world validation.** Comparing against MTBS historical burn-severity data or a
  vetted simulator (FlamMap, ELMFIRE) would be the honest next step.

## Running

```bash
npm install
npm run dev
```

Open http://localhost:5190 (port pinned in `package.json` to avoid colliding with sibling
projects). Click a globe pin → simulation loads → optimizer runs → click **Execute plan**
to apply the suggested burn.

## File map

```
src/
├── App.jsx                            ← router (/  vs  /simulation/:id)
├── components/Globe/                  ← globe.gl Earth + pin list
└── simulation/
    ├── SimulationView.tsx             ← top-level for /simulation
    ├── fireEngine.ts                  ← cellular automaton + projectWorstCase
    ├── burnPlanOptimizer.ts           ← 15-dim simulated annealing
    ├── tiffLoader.ts                  ← in-browser GeoTIFF parser
    ├── satelliteLoader.ts             ← color-ramp helpers
    └── components/
        ├── FireScene3D.tsx            ← three.js / r3f scene
        ├── FireCanvas.tsx             ← 2D canvas fallback
        ├── ControlPanel.tsx           ← sidebar (live + forecast + plan + sliders)
        └── RiskGauge.tsx              ← (unused in current sidebar)

public/
├── globe/                             ← Earth textures (local, no CDN)
├── tiffs/                             ← per-location 2-band float TIFFs
└── ...
```
