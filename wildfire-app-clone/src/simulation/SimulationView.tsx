import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  cloneGrid,
  ignite,
  liveStats,
  projectWorstCase,
  step,
} from "./fireEngine";
import type { Grid, LiveStats, SimParams } from "./fireEngine";
import {
  applyBurnPlan,
  optimizeBurnPlan,
  planToMask,
} from "./burnPlanOptimizer";
import type { OptimizedPlan } from "./burnPlanOptimizer";
import { FireCanvas } from "./components/FireCanvas";
import { FireScene3D } from "./components/FireScene3D";
import { ControlPanel } from "./components/ControlPanel";
import { parseTiff } from "./tiffLoader";

const GRID_W = 120;
const GRID_H = 104;
const TICK_MS = 80;

const INITIAL_PARAMS: SimParams = {
  windSpeed: 12,
  windDirX: 1,
  windDirY: 0,
  humidity: 25,
  temperature: 88,
};

type ViewMode = "3d" | "2d";

export interface SimulationLocation {
  id: string;
  name: string;
  tiffPath: string | null;
}

interface Props {
  tiffPath: string | null;
  locations: SimulationLocation[];
  selectedId: string;
}

interface CachedPlan {
  version: 1;
  plan: OptimizedPlan;
}

const PLAN_CACHE_VERSION = 1;
const planCacheKey = (id: string) => `wildfire:burnplan:v${PLAN_CACHE_VERSION}:${id}`;

export default function SimulationView({
  tiffPath,
  locations,
  selectedId,
}: Props) {
  const navigate = useNavigate();

  const [viewMode, setViewMode] = useState<ViewMode>("3d");
  const [grid, setGrid] = useState<Grid | null>(null);
  const [pristineGrid, setPristineGrid] = useState<Grid | null>(null);
  const [elevation, setElevation] = useState<number[][] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [params, setParams] = useState<SimParams>(INITIAL_PARAMS);
  const [isRunning, setIsRunning] = useState(false);
  const [sceneVersion, setSceneVersion] = useState(0);
  const [activeTiffUrl, setActiveTiffUrl] = useState<string | null>(null);

  // Optimizer / plan state
  const [optimizedPlan, setOptimizedPlan] = useState<OptimizedPlan | null>(null);
  const [optimizing, setOptimizing] = useState(false);
  const [optimizerProgress, setOptimizerProgress] = useState(0);
  const [showPlanOverlay, setShowPlanOverlay] = useState(true);
  const [planExecuted, setPlanExecuted] = useState(false);

  const tickRef = useRef<number | null>(null);
  const elevationRef = useRef(elevation);
  useEffect(() => {
    elevationRef.current = elevation;
  }, [elevation]);

  // Load the bundled TIFF for this location.
  useEffect(() => {
    if (!tiffPath) {
      setLoadError("No terrain data is available for this location.");
      return;
    }

    let cancelled = false;
    setGrid(null);
    setPristineGrid(null);
    setElevation(null);
    setLoadError(null);
    setIsRunning(false);
    setOptimizedPlan(null);
    setPlanExecuted(false);
    setActiveTiffUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });

    fetch(tiffPath)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.blob();
      })
      .then(async (blob) => {
        if (cancelled) return;
        const file = new File(
          [blob],
          tiffPath.split("/").pop() ?? "region.tiff"
        );
        const tile = await parseTiff(file, GRID_W, GRID_H);
        if (cancelled) {
          URL.revokeObjectURL(tile.ndviUrl);
          return;
        }
        setActiveTiffUrl(tile.ndviUrl);
        setGrid(tile.grid);
        setPristineGrid(tile.grid);
        setElevation(tile.elevation);
        setSceneVersion((v) => v + 1);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("Could not load TIFF:", err);
        setLoadError("Could not load terrain data for this location.");
      });

    return () => {
      cancelled = true;
    };
  }, [tiffPath]);

  // Free the previous tile's blob URL on unmount.
  useEffect(() => {
    return () => {
      setActiveTiffUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    };
  }, []);

  // Optimizer: when grid + elevation are loaded, look up cache or run search.
  useEffect(() => {
    if (!pristineGrid || !elevation) return;
    let cancelled = false;

    // 1) Check cache
    try {
      const raw = localStorage.getItem(planCacheKey(selectedId));
      if (raw) {
        const parsed: CachedPlan = JSON.parse(raw);
        if (parsed.version === PLAN_CACHE_VERSION) {
          setOptimizedPlan(parsed.plan);
          return;
        }
      }
    } catch {
      // ignore parse errors, just recompute
    }

    // 2) Run optimizer
    setOptimizing(true);
    setOptimizerProgress(0);

    optimizeBurnPlan(pristineGrid, elevation, {
      stripCount: 3,
      iterations: 50,
      rolloutsPerEval: 3,
      areaCostWeight: 0.55,
      onProgress: ({ iter }) => {
        if (!cancelled) setOptimizerProgress(iter);
      },
    })
      .then((plan) => {
        if (cancelled) return;
        setOptimizedPlan(plan);
        try {
          const cached: CachedPlan = { version: PLAN_CACHE_VERSION, plan };
          localStorage.setItem(planCacheKey(selectedId), JSON.stringify(cached));
        } catch {
          // localStorage might be disabled / full — non-fatal
        }
      })
      .finally(() => {
        if (!cancelled) {
          setOptimizing(false);
          setOptimizerProgress(0);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [pristineGrid, elevation, selectedId]);

  // Burn-plan mask, computed once per plan + grid shape.
  const planMask = useMemo<Uint8Array | null>(() => {
    if (!optimizedPlan || !grid) return null;
    return planToMask(optimizedPlan.strips, grid[0]?.length ?? 0, grid.length);
  }, [optimizedPlan, grid]);

  // Live stats (recomputed each render — small grid, cheap)
  const stats: LiveStats = useMemo(
    () =>
      grid
        ? liveStats(grid)
        : {
            burning: 0,
            burned: 0,
            unburned: 0,
            firebreak: 0,
            totalCells: 0,
            burningPct: 0,
            burnedPct: 0,
            fireFront: 0,
          },
    [grid]
  );

  const burning = stats.burning > 0;

  // Run the simulator on a timer when isRunning.
  useEffect(() => {
    if (!isRunning || !grid) {
      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
      return;
    }
    tickRef.current = window.setInterval(() => {
      setGrid((g) => (g ? step(g, params, elevationRef.current) : g));
    }, TICK_MS);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [isRunning, params, grid !== null]);

  useEffect(() => {
    if (isRunning && !burning) setIsRunning(false);
  }, [burning, isRunning]);

  const handleClick = useCallback((x: number, y: number) => {
    setGrid((g) => (g ? ignite(g, x, y) : g));
    setIsRunning(true);
  }, []);

  const handlePlayPause = () => {
    if (!burning && !isRunning) return;
    setIsRunning((r) => !r);
  };

  const handleReset = () => {
    if (!pristineGrid) return;
    setIsRunning(false);
    setSceneVersion((v) => v + 1);
    setGrid(cloneGrid(pristineGrid));
    setPlanExecuted(false);
  };

  const handleIgniteRandom = () => {
    setGrid((g) => {
      if (!g) return g;
      for (let attempt = 0; attempt < 30; attempt++) {
        const cx = Math.floor(
          GRID_W / 2 + (Math.random() - 0.5) * GRID_W * 0.6
        );
        const cy = Math.floor(
          GRID_H / 2 + (Math.random() - 0.5) * GRID_H * 0.6
        );
        if (g[cy]?.[cx]?.fuel > 20) return ignite(g, cx, cy);
      }
      return g;
    });
    setIsRunning(true);
  };

  const handleExecutePlan = () => {
    if (!grid || !optimizedPlan) return;
    setIsRunning(false);
    setGrid((g) => (g ? applyBurnPlan(g, optimizedPlan.strips) : g));
    setPlanExecuted(true);
    setShowPlanOverlay(false);
    setSceneVersion((v) => v + 1);
  };

  const handleRecomputePlan = () => {
    // Force-bypass cache, rerun the optimizer.
    if (!pristineGrid || !elevation) return;
    try {
      localStorage.removeItem(planCacheKey(selectedId));
    } catch {
      /* ignore */
    }
    setOptimizedPlan(null);
    // Trigger the effect by bumping a dummy state? We cleared the plan; the
    // optimizer effect won't re-run because its deps haven't changed. Inline
    // it instead.
    setOptimizing(true);
    setOptimizerProgress(0);
    optimizeBurnPlan(pristineGrid, elevation, {
      stripCount: 3,
      iterations: 50,
      rolloutsPerEval: 3,
      areaCostWeight: 0.55,
      onProgress: ({ iter }) => setOptimizerProgress(iter),
    })
      .then((plan) => {
        setOptimizedPlan(plan);
        try {
          const cached: CachedPlan = { version: PLAN_CACHE_VERSION, plan };
          localStorage.setItem(planCacheKey(selectedId), JSON.stringify(cached));
        } catch {
          /* ignore */
        }
      })
      .finally(() => {
        setOptimizing(false);
        setOptimizerProgress(0);
      });
  };

  // Live worst-case forecast: re-evaluate whenever grid changes meaningfully.
  // Cached so we don't recompute on every render (which is per-tick).
  const liveForecast = useLiveForecast(grid, elevation, isRunning);

  // 1px transparent fallback so texture-loading prop is always a string.
  const ndviTextureUrl =
    activeTiffUrl ??
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=";

  return (
    <div style={{ display: "flex", height: "100vh", width: "100vw" }}>
      <main
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background:
            "radial-gradient(circle at 30% 30%, #142028 0%, #0b0f14 60%, #050709 100%)",
          padding: 24,
          position: "relative",
        }}
      >
        {/* Top bar */}
        <div
          style={{
            position: "absolute",
            top: 24,
            left: 24,
            right: 24,
            display: "flex",
            alignItems: "center",
            gap: 12,
            zIndex: 10,
          }}
        >
          <button
            onClick={() => navigate("/")}
            style={topBarBtnStyle}
          >
            ← GLOBE
          </button>
          <LocationDropdown
            locations={locations}
            selectedId={selectedId}
            onChange={(id) => navigate(`/simulation/${id}`)}
          />
          <div style={{ flex: 1 }} />
          <SegmentedControl
            options={[
              { value: "3d", label: "3D VIEW" },
              { value: "2d", label: "2D MAP" },
            ]}
            value={viewMode}
            onChange={(v) => setViewMode(v as ViewMode)}
          />
        </div>

        {loadError && (
          <div
            style={{
              position: "absolute",
              top: 72,
              left: "50%",
              transform: "translateX(-50%)",
              background: "#3d1f1f",
              border: "1px solid #f85149",
              color: "#ffb4ad",
              padding: "8px 14px",
              borderRadius: 6,
              fontSize: 12,
              zIndex: 10,
            }}
          >
            {loadError}
          </div>
        )}

        {viewMode === "3d" ? (
          <div
            style={{
              width: "100%",
              height: "100%",
              borderRadius: 8,
              overflow: "hidden",
              border: "1px solid #1f2630",
              position: "relative",
            }}
          >
            {grid && elevation ? (
              <FireScene3D
                grid={grid}
                elevation={elevation}
                onCellClick={handleClick}
                ndviTextureUrl={ndviTextureUrl}
                elevationTextureUrl={null}
                windDirX={params.windDirX}
                windDirY={params.windDirY}
                windSpeed={params.windSpeed}
                sceneKey={`${selectedId}-${sceneVersion}`}
                useDisplacement
                planMask={planMask}
                showPlan={showPlanOverlay && !planExecuted}
              />
            ) : (
              <LoadingOverlay />
            )}
            <div
              style={{
                position: "absolute",
                bottom: 16,
                left: 16,
                fontSize: 11,
                color: "#8b949e",
                letterSpacing: 1,
                background: "rgba(11, 15, 20, 0.7)",
                padding: "6px 10px",
                borderRadius: 4,
                pointerEvents: "none",
              }}
            >
              LEFT-DRAG to orbit · RIGHT-DRAG to pan · SCROLL to zoom · CLICK
              terrain to ignite
            </div>
            {showPlanOverlay && optimizedPlan && !planExecuted && (
              <PlanLegend />
            )}
          </div>
        ) : (
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                aspectRatio: `${GRID_W} / ${GRID_H}`,
                maxWidth: "100%",
                maxHeight: "100%",
                width: "100%",
                boxShadow: "0 0 80px rgba(248, 81, 73, 0.15)",
                borderRadius: 8,
                overflow: "hidden",
                border: "1px solid #1f2630",
                position: "relative",
              }}
            >
              {grid ? (
                <FireCanvas
                  grid={grid}
                  onCellClick={handleClick}
                  cellSize={6}
                  backgroundImageUrl={ndviTextureUrl}
                  planMask={planMask}
                  showPlan={showPlanOverlay && !planExecuted}
                />
              ) : (
                <LoadingOverlay />
              )}
            </div>
          </div>
        )}
      </main>

      <ControlPanel
        locationName={
          locations.find((l) => l.id === selectedId)?.name ?? selectedId
        }
        params={params}
        setParams={setParams}
        stats={stats}
        liveForecast={liveForecast}
        plan={optimizedPlan}
        optimizing={optimizing}
        optimizerProgress={optimizerProgress}
        showPlanOverlay={showPlanOverlay}
        planExecuted={planExecuted}
        isRunning={isRunning}
        isBurning={burning}
        onPlayPause={handlePlayPause}
        onReset={handleReset}
        onIgniteRandom={handleIgniteRandom}
        onExecutePlan={handleExecutePlan}
        onTogglePlanOverlay={() => setShowPlanOverlay((v) => !v)}
        onRecomputePlan={handleRecomputePlan}
      />
    </div>
  );
}

/**
 * Re-runs projectWorstCase only when the grid identity changes AND the user
 * isn't actively running the simulation (worst-case is a meta-question:
 * "what would happen?", not "what's happening?"). Stale numbers are fine if
 * a fire is currently burning — the relevant signal then is the live state.
 */
function useLiveForecast(
  grid: Grid | null,
  elevation: number[][] | null,
  isRunning: boolean
): number | null {
  const [value, setValue] = useState<number | null>(null);

  useEffect(() => {
    if (!grid || !elevation || isRunning) return;
    let cancelled = false;
    // Use a setTimeout to avoid blocking the initial render of a new tile.
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      const wc = projectWorstCase(grid, elevation, { rollouts: 4 });
      if (!cancelled) setValue(wc);
    }, 60);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [grid, elevation, isRunning]);

  return value;
}

// ─── Top-bar reusable widgets ────────────────────────────────────────────

const topBarBtnStyle: React.CSSProperties = {
  background: "#0e141b",
  border: "1px solid #1f2630",
  color: "#cdd9e8",
  padding: "8px 14px",
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: 1,
  borderRadius: 8,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  gap: 6,
};

function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        background: "#0e141b",
        border: "1px solid #1f2630",
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          style={{
            background: value === opt.value ? "#1f6feb" : "transparent",
            color: value === opt.value ? "white" : "#8b949e",
            border: "none",
            padding: "8px 14px",
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: 1,
            cursor: "pointer",
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function LocationDropdown({
  locations,
  selectedId,
  onChange,
}: {
  locations: SimulationLocation[];
  selectedId: string;
  onChange: (id: string) => void;
}) {
  return (
    <select
      value={selectedId}
      onChange={(e) => onChange(e.target.value)}
      style={{
        background: "#0e141b",
        border: "1px solid #1f2630",
        color: "#cdd9e8",
        padding: "8px 30px 8px 14px",
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: 1.5,
        textTransform: "uppercase",
        borderRadius: 8,
        cursor: "pointer",
        appearance: "none",
        backgroundImage:
          'url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'10\' height=\'6\' viewBox=\'0 0 10 6\'><path fill=\'%238b949e\' d=\'M0 0l5 6 5-6z\'/></svg>")',
        backgroundRepeat: "no-repeat",
        backgroundPosition: "right 10px center",
      }}
    >
      {locations.map((loc) => (
        <option key={loc.id} value={loc.id}>
          {loc.name}
        </option>
      ))}
    </select>
  );
}

function PlanLegend() {
  return (
    <div
      style={{
        position: "absolute",
        top: 72,
        right: 16,
        background: "rgba(11, 15, 20, 0.85)",
        border: "1px solid #2a1f25",
        color: "#ffb4ad",
        padding: "6px 12px",
        fontSize: 11,
        letterSpacing: 1.4,
        fontWeight: 600,
        textTransform: "uppercase",
        borderRadius: 6,
        pointerEvents: "none",
        display: "flex",
        alignItems: "center",
        gap: 8,
      }}
    >
      <span
        style={{
          width: 10,
          height: 10,
          background: "rgba(255, 64, 60, 0.85)",
          borderRadius: 2,
          display: "inline-block",
        }}
      />
      Suggested burn
    </div>
  );
}

function LoadingOverlay() {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#0b0f14",
        color: "#8b949e",
        fontSize: 13,
        letterSpacing: 1,
      }}
    >
      LOADING TERRAIN DATA…
    </div>
  );
}
