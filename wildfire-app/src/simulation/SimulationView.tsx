import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  calculateRiskBreakdown,
  ignite,
  igniteCluster,
  isAnyBurning,
  runControlledBurn,
  step,
  stepControlled,
} from "./fireEngine";
import type { Grid, RiskBreakdown, SimParams } from "./fireEngine";
import { FireCanvas } from "./components/FireCanvas";
import { FireScene3D } from "./components/FireScene3D";
import { ControlPanel } from "./components/ControlPanel";
import { parseTiff } from "./tiffLoader";

const GRID_W = 120;
const GRID_H = 104;
const TICK_MS = 80;
const DRIFT_MS = 3000;

const WIND_DIRS: Array<{ x: number; y: number }> = [
  { x: 0, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
  { x: -1, y: 1 },
  { x: -1, y: 0 },
  { x: -1, y: -1 },
];

const INITIAL_PARAMS: SimParams = {
  windSpeed: 12,
  windDirX: 1,
  windDirY: 0,
  humidity: 25,
  temperature: 88,
};

type ViewMode = "3d" | "2d";
export type FireMode = "wildfire" | "controlled";

export interface SimulationLocation {
  id: string;
  name: string;
  tiffPath: string | null;
}

export interface SimSummary {
  mode: FireMode;
  cellsBurned: number;
  totalCells: number;
  percentConsumed: number;
  riskBefore: number;
  riskAfter: number;
  elapsedSeconds: number;
}

export interface LiveStats {
  cellsBurning: number;
  cellsBurned: number;
  totalCells: number;
  elapsedSeconds: number;
}

interface Props {
  tiffPath: string | null;
  locations: SimulationLocation[];
  selectedId: string;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
function randBetween(lo: number, hi: number) {
  return lo + Math.random() * (hi - lo);
}
function drift(v: number, delta: number, lo: number, hi: number) {
  return clamp(v + (Math.random() - 0.5) * 2 * delta, lo, hi);
}

function driftedIdleParams(prev: SimParams): SimParams {
  let { windDirX, windDirY } = prev;
  if (Math.random() < 0.2) {
    const cur = WIND_DIRS.findIndex(
      (d) => d.x === windDirX && d.y === windDirY
    );
    const next =
      (cur + (Math.random() < 0.5 ? 1 : -1) + WIND_DIRS.length) %
      WIND_DIRS.length;
    windDirX = WIND_DIRS[next].x;
    windDirY = WIND_DIRS[next].y;
  }
  return {
    windSpeed: drift(prev.windSpeed, 1.5, 6, 20),
    windDirX,
    windDirY,
    humidity: drift(prev.humidity, 1.5, 18, 40),
    temperature: drift(prev.temperature, 1.5, 75, 95),
  };
}

function wildfireParams(): SimParams {
  const dir = WIND_DIRS[Math.floor(Math.random() * WIND_DIRS.length)];
  return {
    windSpeed: Math.round(randBetween(15, 20)),
    windDirX: dir.x,
    windDirY: dir.y,
    humidity: Math.round(randBetween(5, 10)),
    temperature: Math.round(randBetween(65, 70)),
  };
}

function controlledParams(): SimParams {
  const dir = WIND_DIRS[Math.floor(Math.random() * WIND_DIRS.length)];
  return {
    windSpeed: Math.round(randBetween(8, 16)),
    windDirX: dir.x,
    windDirY: dir.y,
    humidity: Math.round(randBetween(22, 32)),
    temperature: Math.round(randBetween(82, 94)),
  };
}

function gridStats(grid: Grid) {
  let burning = 0,
    burned = 0,
    total = 0;
  for (const row of grid) {
    for (const cell of row) {
      if (cell.status === "firebreak") continue;
      total++;
      if (cell.status === "burning") burning++;
      if (cell.status === "burned") burned++;
    }
  }
  return { burning, burned, total };
}

// ── component ────────────────────────────────────────────────────────────────

export default function SimulationView({
  tiffPath,
  locations,
  selectedId,
}: Props) {
  const navigate = useNavigate();

  const [viewMode, setViewMode] = useState<ViewMode>("3d");
  const [grid, setGrid] = useState<Grid | null>(null);
  const [elevation, setElevation] = useState<number[][] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [params, setParams] = useState<SimParams>(INITIAL_PARAMS);
  const [isRunning, setIsRunning] = useState(false);
  const [fireMode, setFireMode] = useState<FireMode>("wildfire");
  const [previousRisk, setPreviousRisk] = useState<number | null>(null);
  const [sceneVersion, setSceneVersion] = useState(0);
  const [activeTiffUrl, setActiveTiffUrl] = useState<string | null>(null);
  const [liveStats, setLiveStats] = useState<LiveStats | null>(null);
  const [summary, setSummary] = useState<SimSummary | null>(null);

  const tickRef = useRef<number | null>(null);
  const snuffRef = useRef<number | null>(null);
  const driftRef = useRef<number | null>(null);
  const elapsedRef = useRef<number>(0); // seconds since sim started
  const startRiskRef = useRef<number>(0);
  const fireModeRef = useRef(fireMode);
  const elevationRef = useRef(elevation);
  const paramsRef = useRef(params);
  const isRunningRef = useRef(isRunning);

  useEffect(() => {
    elevationRef.current = elevation;
  }, [elevation]);
  useEffect(() => {
    paramsRef.current = params;
  }, [params]);
  useEffect(() => {
    fireModeRef.current = fireMode;
  }, [fireMode]);
  useEffect(() => {
    isRunningRef.current = isRunning;
  }, [isRunning]);

  const clearSnuff = () => {
    if (snuffRef.current !== null) {
      clearTimeout(snuffRef.current);
      snuffRef.current = null;
    }
  };
  const clearDrift = () => {
    if (driftRef.current !== null) {
      clearInterval(driftRef.current);
      driftRef.current = null;
    }
  };

  // ── idle drift ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (isRunning) {
      clearDrift();
      return;
    }
    driftRef.current = window.setInterval(() => {
      setParams((prev) => driftedIdleParams(prev));
    }, DRIFT_MS);
    return clearDrift;
  }, [isRunning]);

  // ── load TIFF ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!tiffPath) {
      setLoadError("No terrain data is available for this location.");
      return;
    }

    let cancelled = false;
    setGrid(null);
    setElevation(null);
    setLoadError(null);
    setIsRunning(false);
    clearSnuff();
    setPreviousRisk(null);
    setLiveStats(null);
    setSummary(null);
    setActiveTiffUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });

    fetch(tiffPath)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.blob();
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
        setElevation(tile.elevation);
        setSceneVersion((v) => v + 1);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error(err);
        setLoadError("Could not load terrain data for this location.");
      });

    return () => {
      cancelled = true;
    };
  }, [tiffPath]);

  useEffect(() => {
    return () => {
      clearSnuff();
      clearDrift();
      setActiveTiffUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    };
  }, []);

  const breakdown: RiskBreakdown = grid
    ? calculateRiskBreakdown(grid, params, elevation)
    : {
        score: 0,
        factors: { fuelLoad: 0, weather: 0, wind: 0, slope: 0, continuity: 0 },
      };
  const riskScore = breakdown.score;
  const burning = grid ? isAnyBurning(grid) : false;

  // ── sim tick ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isRunning || !grid) {
      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
      return;
    }
    tickRef.current = window.setInterval(() => {
      elapsedRef.current += TICK_MS / 1000;
      setGrid((g) => {
        if (!g) return g;
        const next =
          fireModeRef.current === "controlled"
            ? stepControlled(g, paramsRef.current, elevationRef.current)
            : step(g, paramsRef.current, elevationRef.current);
        // Update live stats each tick
        const s = gridStats(next);
        setLiveStats({
          cellsBurning: s.burning,
          cellsBurned: s.burned,
          totalCells: s.total,
          elapsedSeconds: Math.round(elapsedRef.current),
        });
        return next;
      });
    }, TICK_MS);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [isRunning, grid !== null]);

  // Fire burned out naturally — build summary
  useEffect(() => {
    if (isRunning && !burning) {
      setIsRunning(false);
      setGrid((g) => {
        if (!g) return g;
        const s = gridStats(g);
        setSummary({
          mode: fireModeRef.current,
          cellsBurned: s.burned,
          totalCells: s.total,
          percentConsumed: Math.round((s.burned / Math.max(s.total, 1)) * 100),
          riskBefore: startRiskRef.current,
          riskAfter: riskScore,
          elapsedSeconds: Math.round(elapsedRef.current),
        });
        setLiveStats(null);
        return g;
      });
    }
  }, [burning, isRunning]);

  // ── handlers ───────────────────────────────────────────────────────────────
  const handleClick = useCallback((x: number, y: number) => {
    setGrid((g) => (g ? ignite(g, x, y) : g));
    setIsRunning(true);
  }, []);

  const handlePlayPause = () => {
    if (!burning && !isRunning) return;
    if (isRunning) clearSnuff();
    setIsRunning((r) => !r);
  };

  const handleReset = () => {
    if (!tiffPath) return;
    clearSnuff();
    clearDrift();
    setIsRunning(false);
    setPreviousRisk(null);
    setLiveStats(null);
    setSummary(null);
    elapsedRef.current = 0;
    setSceneVersion((v) => v + 1);
    setGrid(null);
    setParams(INITIAL_PARAMS);

    fetch(tiffPath)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.blob();
      })
      .then(async (blob) => {
        const file = new File(
          [blob],
          tiffPath.split("/").pop() ?? "region.tiff"
        );
        const tile = await parseTiff(file, GRID_W, GRID_H);
        setGrid(tile.grid);
        setActiveTiffUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return tile.ndviUrl;
        });
      })
      .catch(() => setLoadError("Could not reload terrain data."));
  };

  const handleIgniteRandom = () => {
    setSummary(null);
    elapsedRef.current = 0;
    startRiskRef.current = riskScore;
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

  const handleControlledBurn = () => {
    if (!grid) return;
    const preRisk = riskScore;
    setPreviousRisk(preRisk);
    startRiskRef.current = preRisk;
    setSummary(null);
    elapsedRef.current = 0;

    setGrid((g) => {
      if (!g) return g;
      const stripped = runControlledBurn(g);
      for (let attempt = 0; attempt < 40; attempt++) {
        const cx = Math.floor(
          GRID_W / 2 + (Math.random() - 0.5) * GRID_W * 0.5
        );
        const cy = Math.floor(
          GRID_H / 2 + (Math.random() - 0.5) * GRID_H * 0.5
        );
        if (stripped[cy]?.[cx]?.fuel > 20)
          return igniteCluster(stripped, cx, cy, 2);
      }
      return stripped;
    });
    setIsRunning(true);

    const snuffDelay = 10000 + Math.random() * 2000;
    snuffRef.current = window.setTimeout(() => {
      setIsRunning(false);
      setGrid((g) => {
        if (!g) return g;
        const snuffed = g.map((row) =>
          row.map((cell) =>
            cell.status === "burning"
              ? { ...cell, status: "burned" as const, heat: 0 }
              : cell
          )
        );
        const s = gridStats(snuffed);
        const afterRisk = calculateRiskBreakdown(
          snuffed,
          paramsRef.current,
          elevationRef.current
        ).score;
        setSummary({
          mode: "controlled",
          cellsBurned: s.burned,
          totalCells: s.total,
          percentConsumed: Math.round((s.burned / Math.max(s.total, 1)) * 100),
          riskBefore: preRisk,
          riskAfter: afterRisk,
          elapsedSeconds: Math.round(elapsedRef.current),
        });
        setLiveStats(null);
        return snuffed;
      });
      setPreviousRisk(preRisk); // triggers RiskGauge sweep
    }, snuffDelay);
  };

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
            style={{
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
              marginLeft: 15,
              marginTop: 15,
            }}
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

        {/* Live stats HUD */}
        {liveStats && <LiveStatsHUD stats={liveStats} mode={fireMode} />}

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
                background: "rgba(11,15,20,0.7)",
                padding: "6px 10px",
                borderRadius: 4,
                pointerEvents: "none",
              }}
            >
              LEFT-DRAG to orbit · RIGHT-DRAG to pan · SCROLL to zoom · CLICK
              terrain to ignite
            </div>
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
                boxShadow: "0 0 80px rgba(248,81,73,0.15)",
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
                />
              ) : (
                <LoadingOverlay />
              )}
            </div>
          </div>
        )}
      </main>

      <ControlPanel
        params={params}
        setParams={setParams}
        riskScore={riskScore}
        breakdown={breakdown}
        previousRisk={previousRisk}
        isRunning={isRunning}
        isBurning={burning}
        fireMode={fireMode}
        setFireMode={setFireMode}
        summary={summary}
        onPlayPause={handlePlayPause}
        onReset={handleReset}
        onIgniteRandom={handleIgniteRandom}
        onControlledBurn={handleControlledBurn}
      />
    </div>
  );
}

// ── Live stats HUD ────────────────────────────────────────────────────────────

function LiveStatsHUD({ stats, mode }: { stats: LiveStats; mode: FireMode }) {
  const pct = Math.round(
    (stats.cellsBurned / Math.max(stats.totalCells, 1)) * 100
  );
  const accent = mode === "wildfire" ? "#f85149" : "#1f6feb";
  const label = mode === "wildfire" ? "WILDFIRE" : "CONTROLLED BURN";

  return (
    <div
      style={{
        position: "absolute",
        bottom: 56,
        left: "50%",
        transform: "translateX(-50%)",
        background: "rgba(11,15,20,0.88)",
        border: `1px solid ${accent}`,
        borderRadius: 10,
        padding: "10px 20px",
        display: "flex",
        gap: 28,
        alignItems: "center",
        zIndex: 20,
        backdropFilter: "blur(4px)",
        boxShadow: `0 0 20px ${accent}33`,
      }}
    >
      <div
        style={{
          fontSize: 10,
          letterSpacing: 2,
          color: accent,
          fontWeight: 700,
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </div>
      <StatPill
        label="BURNING"
        value={stats.cellsBurning.toLocaleString()}
        color={accent}
      />
      <StatPill
        label="CONSUMED"
        value={`${pct}%`}
        color={pct > 30 ? "#f85149" : pct > 10 ? "#d29922" : "#3fb950"}
      />
      <StatPill
        label="ELAPSED"
        value={`${stats.elapsedSeconds}s`}
        color="#8b949e"
      />
    </div>
  );
}

function StatPill({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div style={{ textAlign: "center" }}>
      <div
        style={{
          fontSize: 10,
          color: "#6e7681",
          letterSpacing: 1.5,
          marginBottom: 2,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 16, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

// ── sub-components ────────────────────────────────────────────────────────────

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
        marginTop: 15,
        marginRight: 15,
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
          "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path fill='%238b949e' d='M0 0l5 6 5-6z'/></svg>\")",
        backgroundRepeat: "no-repeat",
        backgroundPosition: "right 10px center",
        marginTop: 15,
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
