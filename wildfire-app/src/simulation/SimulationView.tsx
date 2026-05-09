import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  calculateRiskBreakdown,
  createGrid,
  ignite,
  isAnyBurning,
  runControlledBurn,
  step,
} from "./fireEngine";
import type { Grid, RiskBreakdown, SimParams } from "./fireEngine";
import { FireCanvas } from "./components/FireCanvas";
import { FireScene3D } from "./components/FireScene3D";
import { ControlPanel } from "./components/ControlPanel";
import {
  loadElevationMap,
  loadFuelFromImage,
  syntheticElevationMap,
} from "./satelliteLoader";
import { parseTiff, type TiffTile } from "./tiffLoader";

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

type Source = "tiff" | "random" | "upload";
type ViewMode = "3d" | "2d";

interface Props {
  locationName: string;
  tiffPath: string | null;
}

export default function SimulationView({ locationName, tiffPath }: Props) {
  const navigate = useNavigate();

  const [source, setSource] = useState<Source>(tiffPath ? "tiff" : "random");
  const [viewMode, setViewMode] = useState<ViewMode>("3d");
  const [grid, setGrid] = useState<Grid | null>(null);
  const [elevation, setElevation] = useState<number[][] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [params, setParams] = useState<SimParams>(INITIAL_PARAMS);
  const [isRunning, setIsRunning] = useState(false);
  const [previousRisk, setPreviousRisk] = useState<number | null>(null);
  const [sceneVersion, setSceneVersion] = useState(0);
  const [uploadedTile, setUploadedTile] = useState<TiffTile | null>(null);
  const [uploadName, setUploadName] = useState<string | null>(null);
  const [isParsingTiff, setIsParsingTiff] = useState(false);
  const [activeTiffUrl, setActiveTiffUrl] = useState<string | null>(null);

  const tickRef = useRef<number | null>(null);
  const elevationRef = useRef(elevation);
  useEffect(() => {
    elevationRef.current = elevation;
  }, [elevation]);

  // Load from tiffPath when source === 'tiff'
  useEffect(() => {
    if (source !== "tiff" || !tiffPath) return;

    let cancelled = false;
    setGrid(null);
    setElevation(null);
    setLoadError(null);
    setIsRunning(false);
    setPreviousRisk(null);

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
        if (cancelled) return;
        setActiveTiffUrl(tile.ndviUrl);
        setGrid(tile.grid);
        setElevation(tile.elevation);
        setSceneVersion((v) => v + 1);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("Could not load TIFF:", err);
        setLoadError(
          "Could not load terrain data. Falling back to random forest."
        );
        setGrid(createGrid({ width: GRID_W, height: GRID_H }));
        setElevation(syntheticElevationMap(GRID_W, GRID_H));
      });

    return () => {
      cancelled = true;
    };
  }, [source, tiffPath]);

  // Load random forest
  useEffect(() => {
    if (source !== "random") return;
    setGrid(createGrid({ width: GRID_W, height: GRID_H }));
    setElevation(syntheticElevationMap(GRID_W, GRID_H));
    setLoadError(null);
    setIsRunning(false);
    setPreviousRisk(null);
  }, [source]);

  // Load from user upload
  useEffect(() => {
    if (source !== "upload") return;
    if (uploadedTile) {
      setGrid(uploadedTile.grid);
      setElevation(uploadedTile.elevation);
      setActiveTiffUrl(uploadedTile.ndviUrl);
    }
  }, [source, uploadedTile]);

  useEffect(() => {
    return () => {
      if (uploadedTile) URL.revokeObjectURL(uploadedTile.ndviUrl);
    };
  }, [uploadedTile]);

  const handleTiffUpload = useCallback(async (file: File) => {
    setIsParsingTiff(true);
    setLoadError(null);
    try {
      const tile = await parseTiff(file, GRID_W, GRID_H);
      setUploadedTile(tile);
      setUploadName(file.name);
      setSource("upload");
      setSceneVersion((v) => v + 1);
    } catch (err) {
      console.error(err);
      setLoadError(
        err instanceof Error
          ? `Could not parse TIFF: ${err.message}`
          : "Could not parse TIFF."
      );
    } finally {
      setIsParsingTiff(false);
    }
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
    setIsRunning(false);
    setPreviousRisk(null);
    setSceneVersion((v) => v + 1);
    if (source === "random") {
      setGrid(createGrid({ width: GRID_W, height: GRID_H }));
    } else if (source === "upload" && uploadedTile) {
      setGrid(uploadedTile.grid);
    } else if (source === "tiff" && tiffPath) {
      setSource("random");
      setTimeout(() => setSource("tiff"), 0);
    }
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
    setGrid((g) => (g ? runControlledBurn(g) : g));
  };

  const placeholderTextureUrl = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 4;
    canvas.height = 4;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#2a4a1a";
    ctx.fillRect(0, 0, 4, 4);
    return canvas.toDataURL("image/png");
  }, []);

  const ndviTextureUrl = activeTiffUrl ?? placeholderTextureUrl;
  const useDisplacement = source === "tiff" || source === "upload";

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
          <div
            style={{
              color: "#8b949e",
              fontSize: 12,
              letterSpacing: 2,
              fontWeight: 600,
            }}
          >
            {locationName.toUpperCase()}
          </div>
          <div style={{ flex: 1 }} />
          <SegmentedControl
            options={[
              { value: "3d", label: "3D VIEW" },
              { value: "2d", label: "2D MAP" },
            ]}
            value={viewMode}
            onChange={(v) => setViewMode(v as ViewMode)}
          />
          <UploadTiffButton
            onTiffSelected={handleTiffUpload}
            isParsingTiff={isParsingTiff}
            hasUpload={uploadedTile !== null}
          />
          {tiffPath && (
            <SegmentedControl
              options={[
                { value: "tiff", label: "SATELLITE" },
                { value: "random", label: "RANDOM" },
              ]}
              value={source === "upload" ? "tiff" : source}
              onChange={(v) => setSource(v as Source)}
            />
          )}
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
                sceneKey={`${source}-${sceneVersion}`}
                useDisplacement={useDisplacement}
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

function UploadTiffButton({
  onTiffSelected,
  isParsingTiff,
  hasUpload,
}: {
  onTiffSelected: (file: File) => void;
  isParsingTiff: boolean;
  hasUpload: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".tif,.tiff,image/tiff"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onTiffSelected(file);
          e.target.value = "";
        }}
      />
      <button
        onClick={() => fileInputRef.current?.click()}
        disabled={isParsingTiff}
        style={{
          background: "#0e141b",
          border: "1px solid #1f2630",
          color: isParsingTiff ? "#6e7681" : "#cdd9e8",
          padding: "8px 14px",
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: 1,
          borderRadius: 8,
          cursor: isParsingTiff ? "wait" : "pointer",
        }}
      >
        {isParsingTiff
          ? "PARSING…"
          : hasUpload
          ? "REPLACE TIFF"
          : "UPLOAD TIFF"}
      </button>
    </>
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
