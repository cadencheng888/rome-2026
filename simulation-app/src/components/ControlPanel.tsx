import type { RiskBreakdown, SimParams } from '../fireEngine';
import { RiskGauge } from './RiskGauge';

interface Props {
  params: SimParams;
  setParams: (p: SimParams) => void;
  riskScore: number;
  breakdown: RiskBreakdown;
  previousRisk: number | null;
  isRunning: boolean;
  isBurning: boolean;
  onPlayPause: () => void;
  onReset: () => void;
  onIgniteRandom: () => void;
  onControlledBurn: () => void;
}

function FactorBar({ label, value }: { label: string; value: number }) {
  const pct = Math.round(value * 100);
  const color =
    pct < 30 ? '#3fb950' : pct < 60 ? '#d29922' : pct < 80 ? '#f85149' : '#a371f7';
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3 }}>
        <span style={{ color: '#8b949e', letterSpacing: 0.5 }}>{label}</span>
        <span style={{ color: '#cdd9e8', fontWeight: 600 }}>{pct}</span>
      </div>
      <div style={{ height: 4, background: '#1f2630', borderRadius: 3, overflow: 'hidden' }}>
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: color,
            transition: 'width 0.4s ease, background 0.4s ease',
          }}
        />
      </div>
    </div>
  );
}

const WIND_DIRS: Array<{ label: string; x: number; y: number }> = [
  { label: 'N',  x: 0,  y: -1 },
  { label: 'NE', x: 1,  y: -1 },
  { label: 'E',  x: 1,  y: 0 },
  { label: 'SE', x: 1,  y: 1 },
  { label: 'S',  x: 0,  y: 1 },
  { label: 'SW', x: -1, y: 1 },
  { label: 'W',  x: -1, y: 0 },
  { label: 'NW', x: -1, y: -1 },
];

function Slider({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}>
        <span style={{ color: '#8b949e' }}>{label}</span>
        <span style={{ color: '#e8edf2', fontWeight: 600 }}>
          {value}
          {unit ?? ''}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step ?? 1}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ width: '100%', accentColor: '#f85149' }}
      />
    </div>
  );
}

function Btn({
  children,
  onClick,
  variant = 'default',
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  variant?: 'default' | 'primary' | 'danger';
  disabled?: boolean;
}) {
  const styles: Record<string, React.CSSProperties> = {
    default: { background: '#21262d', color: '#e8edf2', border: '1px solid #30363d' },
    primary: { background: '#1f6feb', color: 'white', border: '1px solid #1f6feb' },
    danger:  { background: '#f85149', color: 'white', border: '1px solid #f85149' },
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        ...styles[variant],
        padding: '10px 14px',
        borderRadius: 8,
        fontSize: 13,
        fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        width: '100%',
      }}
    >
      {children}
    </button>
  );
}

export function ControlPanel(props: Props) {
  const {
    params,
    setParams,
    riskScore,
    breakdown,
    previousRisk,
    isRunning,
    isBurning,
    onPlayPause,
    onReset,
    onIgniteRandom,
    onControlledBurn,
  } = props;

  const currentDir = WIND_DIRS.find(
    (d) => d.x === params.windDirX && d.y === params.windDirY
  )?.label ?? 'N';

  return (
    <aside
      style={{
        width: 340,
        background: '#0e141b',
        borderLeft: '1px solid #1f2630',
        padding: 24,
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 24,
      }}
    >
      <div>
        <div style={{ fontSize: 11, letterSpacing: 2, color: '#8b949e', marginBottom: 4 }}>
          PRESCRIBED BURN SIMULATOR
        </div>
        <div style={{ fontSize: 20, fontWeight: 700 }}>Fire Risk Dashboard</div>
      </div>

      <section style={{ background: '#0b1018', borderRadius: 12, padding: 20, border: '1px solid #1f2630' }}>
        <div style={{ fontSize: 11, letterSpacing: 2, color: '#8b949e', marginBottom: 8, textAlign: 'center' }}>
          SEVERITY GAUGE
        </div>
        <RiskGauge score={riskScore} previousScore={previousRisk} />
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid #1f2630' }}>
          <div style={{ fontSize: 10, letterSpacing: 1.5, color: '#6e7681', marginBottom: 10 }}>
            CONTRIBUTING FACTORS
          </div>
          <FactorBar label="Fuel load" value={breakdown.factors.fuelLoad} />
          <FactorBar label="Fuel continuity" value={breakdown.factors.continuity} />
          <FactorBar label="Slope / terrain" value={breakdown.factors.slope} />
          <FactorBar label="Weather (temp / humidity)" value={breakdown.factors.weather} />
          <FactorBar label="Wind" value={breakdown.factors.wind} />
        </div>
      </section>

      <section>
        <div style={{ fontSize: 11, letterSpacing: 2, color: '#8b949e', marginBottom: 12 }}>
          CONDITIONS
        </div>
        <Slider
          label="Wind Speed"
          unit=" mph"
          value={params.windSpeed}
          min={0}
          max={50}
          onChange={(v) => setParams({ ...params, windSpeed: v })}
        />
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}>
            <span style={{ color: '#8b949e' }}>Wind Direction</span>
            <span style={{ color: '#e8edf2', fontWeight: 600 }}>{currentDir}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 4 }}>
            {WIND_DIRS.map((d) => {
              const active = d.x === params.windDirX && d.y === params.windDirY;
              return (
                <button
                  key={d.label}
                  onClick={() => setParams({ ...params, windDirX: d.x, windDirY: d.y })}
                  style={{
                    background: active ? '#1f6feb' : '#21262d',
                    border: '1px solid #30363d',
                    color: '#e8edf2',
                    fontSize: 10,
                    padding: '6px 0',
                    borderRadius: 4,
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                >
                  {d.label}
                </button>
              );
            })}
          </div>
        </div>
        <Slider
          label="Temperature"
          unit="°F"
          value={params.temperature}
          min={40}
          max={110}
          onChange={(v) => setParams({ ...params, temperature: v })}
        />
        <Slider
          label="Humidity"
          unit="%"
          value={params.humidity}
          min={5}
          max={100}
          onChange={(v) => setParams({ ...params, humidity: v })}
        />
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 11, letterSpacing: 2, color: '#8b949e', marginBottom: 4 }}>
          ACTIONS
        </div>
        <Btn onClick={onPlayPause} variant="primary">
          {isRunning ? 'Pause Simulation' : isBurning ? 'Resume' : 'Play Simulation'}
        </Btn>
        <Btn onClick={onIgniteRandom} variant="danger">
          Ignite Random Spark
        </Btn>
        <Btn onClick={onControlledBurn}>
          Run Optimal Controlled Burn
        </Btn>
        <Btn onClick={onReset}>Reset Forest</Btn>
      </section>

      <div style={{ fontSize: 11, color: '#6e7681', lineHeight: 1.5 }}>
        Click anywhere on the forest to ignite a fire. Adjust conditions to see how
        weather affects spread. Run a controlled burn to clear fuel strips and watch the
        risk gauge drop.
      </div>
    </aside>
  );
}
