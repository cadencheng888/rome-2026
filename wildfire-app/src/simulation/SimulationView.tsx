import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  calculateRiskBreakdown,
  ignite,
  isAnyBurning,
  runControlledBurn,
  step,
} from "./fireEngine";
import type { Grid, RiskBreakdown, SimParams } from "./fireEngine";
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
  const [previousRisk, setPreviousRisk] = useState<number | null>(null);
  const [sceneVersion, setSceneVersion] = useState(0);
  const [activeTiffUrl, setActiveTiffUrl] = useState<string | null>(null);

  const tickRef = useRef<number | null>(null);
  const elevationRef = useRef(elevation);
  useEffect(() => {
    elevationRef.current = elevation;
  }, [elevation]);

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
    setPreviousRisk(null);
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

  useEffect(() => {
    return () => {
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

  useEffect(() => {
    if (!isRunning || !grid) {
      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
      return;
    }
    tickRef.current = window.setInterval(() => {
      // elevation ref still passed for API compat; step() now prefers cell.slope/aspect
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
    if (!tiffPath) return;
    setIsRunning(false);
    setPreviousRisk(null);
    setSceneVersion((v) => v + 1);
    setGrid(null);

    fetch(tiffPath)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.blob();
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
    setPreviousRisk(riskScore);
    setIsRunning(false);
    // Pass current wind direction so the optimizer can orient breaks correctly.
    setGrid((g) =>
      g
        ? runControlledBurn(g, {
            windDirX: params.windDirX,
            windDirY: params.windDirY,
          })
        : g
    );
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
                background: "rgba(11, 15, 20, 0.7)",
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
        onPlayPause={handlePlayPause}
        onReset={handleReset}
        onIgniteRandom={handleIgniteRandom}
        onControlledBurn={handleControlledBurn}
      />
    </div>
  );
}

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
          "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path fill='%238b949e' d='M0 0l5 6 5-6z'/></svg>\")",
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
