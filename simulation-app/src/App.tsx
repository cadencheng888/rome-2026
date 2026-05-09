import { useCallback, useEffect, useRef, useState } from 'react';
import {
  calculateRiskBreakdown,
  createGrid,
  ignite,
  isAnyBurning,
  runControlledBurn,
  step,
} from './fireEngine';
import type { Grid, RiskBreakdown, SimParams } from './fireEngine';
import { FireCanvas } from './components/FireCanvas';
import { FireScene3D } from './components/FireScene3D';
import { ControlPanel } from './components/ControlPanel';
import {
  loadElevationMap,
  loadFuelFromImage,
  syntheticElevationMap,
} from './satelliteLoader';

const GRID_W = 120;
const GRID_H = 90;
const TICK_MS = 80;
const NDVI_URL = '/ndvi.png';

const INITIAL_PARAMS: SimParams = {
  windSpeed: 12,
  windDirX: 1,
  windDirY: 0,
  humidity: 25,
  temperature: 88,
};

type Source = 'satellite' | 'random';
type ViewMode = '3d' | '2d';

export default function App() {
  const [source, setSource] = useState<Source>('satellite');
  const [viewMode, setViewMode] = useState<ViewMode>('3d');
  const [grid, setGrid] = useState<Grid | null>(null);
  const [elevation, setElevation] = useState<number[][] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [params, setParams] = useState<SimParams>(INITIAL_PARAMS);
  const [isRunning, setIsRunning] = useState(false);
  const [previousRisk, setPreviousRisk] = useState<number | null>(null);
  const [sceneVersion, setSceneVersion] = useState(0);

  const tickRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setGrid(null);
    setElevation(null);
    setLoadError(null);
    setIsRunning(false);
    setPreviousRisk(null);

    if (source === 'random') {
      setGrid(createGrid({ width: GRID_W, height: GRID_H }));
      setElevation(syntheticElevationMap(GRID_W, GRID_H));
      return;
    }

    Promise.all([
      loadFuelFromImage(NDVI_URL, GRID_W, GRID_H),
      loadElevationMap(NDVI_URL, GRID_W, GRID_H),
    ])
      .then(([g, e]) => {
        if (!cancelled) {
          setGrid(g);
          setElevation(e);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error(err);
          setLoadError(
            'Could not load satellite image. Falling back to random forest.'
          );
          setGrid(createGrid({ width: GRID_W, height: GRID_H }));
          setElevation(syntheticElevationMap(GRID_W, GRID_H));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [source]);

  const breakdown: RiskBreakdown = grid
    ? calculateRiskBreakdown(grid, params, elevation)
    : { score: 0, factors: { fuelLoad: 0, weather: 0, wind: 0, slope: 0, continuity: 0 } };
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
      setGrid((g) => (g ? step(g, params) : g));
    }, TICK_MS);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [isRunning, params, grid !== null]);

  useEffect(() => {
    if (isRunning && !burning) {
      setIsRunning(false);
    }
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
    if (source === 'random') {
      setGrid(createGrid({ width: GRID_W, height: GRID_H }));
    } else {
      setGrid(null);
      loadFuelFromImage(NDVI_URL, GRID_W, GRID_H)
        .then(setGrid)
        .catch(() => setGrid(createGrid({ width: GRID_W, height: GRID_H })));
    }
  };

  const handleIgniteRandom = () => {
    setGrid((g) => {
      if (!g) return g;
      for (let attempt = 0; attempt < 30; attempt++) {
        const cx = Math.floor(GRID_W / 2 + (Math.random() - 0.5) * GRID_W * 0.6);
        const cy = Math.floor(GRID_H / 2 + (Math.random() - 0.5) * GRID_H * 0.6);
        if (g[cy]?.[cx]?.fuel > 20) {
          return ignite(g, cx, cy);
        }
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

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw' }}>
      <main
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background:
            'radial-gradient(circle at 30% 30%, #142028 0%, #0b0f14 60%, #050709 100%)',
          padding: 24,
          position: 'relative',
        }}
      >
        <TopBar
          source={source}
          setSource={setSource}
          viewMode={viewMode}
          setViewMode={setViewMode}
        />
        {loadError && (
          <div
            style={{
              position: 'absolute',
              top: 24,
              left: '50%',
              transform: 'translateX(-50%)',
              background: '#3d1f1f',
              border: '1px solid #f85149',
              color: '#ffb4ad',
              padding: '8px 14px',
              borderRadius: 6,
              fontSize: 12,
              zIndex: 10,
            }}
          >
            {loadError}
          </div>
        )}
        {viewMode === '3d' ? (
          <div
            style={{
              width: '100%',
              height: '100%',
              borderRadius: 8,
              overflow: 'hidden',
              border: '1px solid #1f2630',
              position: 'relative',
            }}
          >
            {grid && elevation ? (
              <FireScene3D
                grid={grid}
                elevation={elevation}
                onCellClick={handleClick}
                ndviTextureUrl={source === 'satellite' ? NDVI_URL : '/ndvi.png'}
                windDirX={params.windDirX}
                windDirY={params.windDirY}
                windSpeed={params.windSpeed}
                sceneKey={`${source}-${sceneVersion}`}
                useDisplacement={source === 'satellite'}
              />
            ) : (
              <LoadingOverlay />
            )}
            {viewMode === '3d' && (
              <div
                style={{
                  position: 'absolute',
                  bottom: 16,
                  left: 16,
                  fontSize: 11,
                  color: '#8b949e',
                  letterSpacing: 1,
                  background: 'rgba(11, 15, 20, 0.7)',
                  padding: '6px 10px',
                  borderRadius: 4,
                  pointerEvents: 'none',
                }}
              >
                LEFT-DRAG to orbit · RIGHT-DRAG to pan · SCROLL to zoom · CLICK terrain to ignite
              </div>
            )}
          </div>
        ) : (
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <div
              style={{
                aspectRatio: `${GRID_W} / ${GRID_H}`,
                maxWidth: '100%',
                maxHeight: '100%',
                width: '100%',
                boxShadow: '0 0 80px rgba(248, 81, 73, 0.15)',
                borderRadius: 8,
                overflow: 'hidden',
                border: '1px solid #1f2630',
                position: 'relative',
              }}
            >
              {grid ? (
                <FireCanvas
                  grid={grid}
                  onCellClick={handleClick}
                  cellSize={6}
                  backgroundImageUrl={source === 'satellite' ? NDVI_URL : undefined}
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

function TopBar({
  source,
  setSource,
  viewMode,
  setViewMode,
}: {
  source: Source;
  setSource: (s: Source) => void;
  viewMode: ViewMode;
  setViewMode: (v: ViewMode) => void;
}) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 24,
        left: 24,
        display: 'flex',
        gap: 12,
        zIndex: 10,
      }}
    >
      <SegmentedControl
        options={[
          { value: 'satellite', label: 'SATELLITE NDVI' },
          { value: 'random', label: 'RANDOM FOREST' },
        ]}
        value={source}
        onChange={(v) => setSource(v as Source)}
      />
      <SegmentedControl
        options={[
          { value: '3d', label: '3D VIEW' },
          { value: '2d', label: '2D MAP' },
        ]}
        value={viewMode}
        onChange={(v) => setViewMode(v as ViewMode)}
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
        display: 'flex',
        background: '#0e141b',
        border: '1px solid #1f2630',
        borderRadius: 8,
        overflow: 'hidden',
      }}
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          style={{
            background: value === opt.value ? '#1f6feb' : 'transparent',
            color: value === opt.value ? 'white' : '#8b949e',
            border: 'none',
            padding: '8px 14px',
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: 1,
            cursor: 'pointer',
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function LoadingOverlay() {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0b0f14',
        color: '#8b949e',
        fontSize: 13,
        letterSpacing: 1,
      }}
    >
      LOADING SATELLITE DATA…
    </div>
  );
}
