import { useCallback, useEffect, useRef, useState } from 'react';
import {
  calculateRiskBreakdown,
  ignite,
  isAnyBurning,
  runControlledBurn,
  step,
} from './fireEngine';
import type { Grid, RiskBreakdown, SimParams } from './fireEngine';
import { FireCanvas } from './components/FireCanvas';
import { FireScene3D } from './components/FireScene3D';
import { ControlPanel } from './components/ControlPanel';
import { loadElevationMap, loadFuelAndTextureFromImage } from './satelliteLoader';
import Globe, { type LocationOption } from './components/Globe/Globe';

const GRID_W = 120;
const GRID_H = 104;
const TICK_MS = 80;

const LOCATIONS: LocationOption[] = [
  {
    id: 'bay-area',
    name: 'San Francisco Bay Area',
    lat: 38.0,
    lng: -122.3,
    ndviUrl: '/locations/bay-area/ndvi.png',
    elevationUrl: '/locations/bay-area/elevation.png',
  },
  {
    id: 'walnut',
    name: 'Walnut, California',
    lat: 34.02,
    lng: -117.86,
    ndviUrl: '/locations/walnut/ndvi.png',
    elevationUrl: '/locations/walnut/elevation.png',
  },
  {
    id: 'yosemite',
    name: 'Yosemite, California',
    lat: 37.86,
    lng: -119.5,
    ndviUrl: '/locations/yosemite/ndvi.png',
    elevationUrl: '/locations/yosemite/elevation.png',
  },
];

const INITIAL_PARAMS: SimParams = {
  windSpeed: 12,
  windDirX: 1,
  windDirY: 0,
  humidity: 25,
  temperature: 88,
};

type AppMode = 'globe' | 'simulation';
type ViewMode = '3d' | '2d';

export default function App() {
  const [appMode, setAppMode] = useState<AppMode>('globe');
  const [selectedLocation, setSelectedLocation] = useState<LocationOption | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('3d');
  const [grid, setGrid] = useState<Grid | null>(null);
  const [elevation, setElevation] = useState<number[][] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [params, setParams] = useState<SimParams>(INITIAL_PARAMS);
  const [isRunning, setIsRunning] = useState(false);
  const [previousRisk, setPreviousRisk] = useState<number | null>(null);
  const [sceneVersion, setSceneVersion] = useState(0);
  const [naturalTextureUrl, setNaturalTextureUrl] = useState<string | null>(null);

  const ndviUrl = selectedLocation?.ndviUrl ?? LOCATIONS[0].ndviUrl;
  const elevationUrl = selectedLocation?.elevationUrl ?? LOCATIONS[0].elevationUrl;

  const tickRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setGrid(null);
    setElevation(null);
    setLoadError(null);
    setIsRunning(false);
    setPreviousRisk(null);

    Promise.all([
      loadFuelAndTextureFromImage(ndviUrl, GRID_W, GRID_H),
      loadElevationMap(elevationUrl, GRID_W, GRID_H),
    ])
      .then(([{ grid: g, naturalTextureUrl: texUrl }, e]) => {
        if (!cancelled) {
          setGrid(g);
          setElevation(e);
          setNaturalTextureUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return texUrl;
          });
        } else {
          URL.revokeObjectURL(texUrl);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error(err);
          setLoadError('Could not load satellite image for this location.');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [ndviUrl, elevationUrl]);

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
    setGrid(null);
    loadFuelAndTextureFromImage(ndviUrl, GRID_W, GRID_H)
      .then(({ grid: g, naturalTextureUrl: texUrl }) => {
        setGrid(g);
        setNaturalTextureUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return texUrl;
        });
      })
      .catch(() => setLoadError('Could not reload satellite image.'));
  };

  const handleLocationSelect = useCallback((loc: LocationOption) => {
    setSelectedLocation(loc);
    setAppMode('simulation');
    setIsRunning(false);
    setPreviousRisk(null);
    setSceneVersion((v) => v + 1);
  }, []);

  const handleReturnToGlobe = useCallback(() => {
    setIsRunning(false);
    setAppMode('globe');
  }, []);

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

  if (appMode === 'globe') {
    return <Globe locations={LOCATIONS} onSelect={handleLocationSelect} />;
  }

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
          viewMode={viewMode}
          setViewMode={setViewMode}
          onBackToGlobe={handleReturnToGlobe}
          locationName={selectedLocation?.name ?? null}
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
                ndviTextureUrl={naturalTextureUrl ?? ndviUrl}
                elevationTextureUrl={elevationUrl}
                windDirX={params.windDirX}
                windDirY={params.windDirY}
                windSpeed={params.windSpeed}
                sceneKey={`${selectedLocation?.id ?? 'default'}-${sceneVersion}`}
                useDisplacement
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
                  backgroundImageUrl={ndviUrl}
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
  viewMode,
  setViewMode,
  onBackToGlobe,
  locationName,
}: {
  viewMode: ViewMode;
  setViewMode: (v: ViewMode) => void;
  onBackToGlobe: () => void;
  locationName: string | null;
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
        alignItems: 'center',
      }}
    >
      <button
        onClick={onBackToGlobe}
        style={{
          background: '#0e141b',
          border: '1px solid #1f2630',
          color: '#cdd9e8',
          padding: '8px 14px',
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: 1,
          borderRadius: 8,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        ← GLOBE
      </button>
      {locationName && (
        <div
          style={{
            color: '#8b949e',
            fontSize: 11,
            letterSpacing: 1.5,
            textTransform: 'uppercase',
            padding: '6px 10px',
            background: 'rgba(14, 20, 27, 0.8)',
            border: '1px solid #1f2630',
            borderRadius: 8,
          }}
        >
          {locationName}
        </div>
      )}
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
