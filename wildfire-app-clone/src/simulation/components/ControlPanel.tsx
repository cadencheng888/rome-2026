import type { LiveStats, SimParams } from "../fireEngine";
import type { OptimizedPlan } from "../burnPlanOptimizer";

interface Props {
  locationName: string;
  params: SimParams;
  setParams: (p: SimParams) => void;
  stats: LiveStats;
  liveForecast: number | null; // 0..1, current worst-case fraction
  plan: OptimizedPlan | null;
  optimizing: boolean;
  optimizerProgress: number; // 0..N (iteration count)
  showPlanOverlay: boolean;
  planExecuted: boolean;
  isRunning: boolean;
  isBurning: boolean;
  onPlayPause: () => void;
  onReset: () => void;
  onIgniteRandom: () => void;
  onExecutePlan: () => void;
  onTogglePlanOverlay: () => void;
  onRecomputePlan: () => void;
}

const WIND_DIRS: Array<{ label: string; x: number; y: number }> = [
  { label: "N", x: 0, y: -1 },
  { label: "NE", x: 1, y: -1 },
  { label: "E", x: 1, y: 0 },
  { label: "SE", x: 1, y: 1 },
  { label: "S", x: 0, y: 1 },
  { label: "SW", x: -1, y: 1 },
  { label: "W", x: -1, y: 0 },
  { label: "NW", x: -1, y: -1 },
];

// ─── Building blocks ──────────────────────────────────────────────────────

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
    <div style={{ marginBottom: 14 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 12,
          marginBottom: 4,
        }}
      >
        <span style={{ color: "#8b949e" }}>{label}</span>
        <span style={{ color: "#e8edf2", fontWeight: 600 }}>
          {value}
          {unit ?? ""}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step ?? 1}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ width: "100%", accentColor: "#f85149" }}
      />
    </div>
  );
}

function Btn({
  children,
  onClick,
  variant = "default",
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  variant?: "default" | "primary" | "danger" | "ghost";
  disabled?: boolean;
}) {
  const styles: Record<string, React.CSSProperties> = {
    default: { background: "#21262d", color: "#e8edf2", border: "1px solid #30363d" },
    primary: { background: "#1f6feb", color: "white", border: "1px solid #1f6feb" },
    danger: { background: "#f85149", color: "white", border: "1px solid #f85149" },
    ghost: { background: "transparent", color: "#cdd9e8", border: "1px solid #30363d" },
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        ...styles[variant],
        padding: "10px 14px",
        borderRadius: 8,
        fontSize: 13,
        fontWeight: 600,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.45 : 1,
        width: "100%",
        transition: "background 0.15s ease",
      }}
    >
      {children}
    </button>
  );
}

function Section({
  label,
  children,
  badge,
}: {
  label: string;
  children: React.ReactNode;
  badge?: { text: string; color: string };
}) {
  return (
    <section>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 10,
        }}
      >
        <div
          style={{
            fontSize: 11,
            letterSpacing: 2,
            color: "#8b949e",
            fontWeight: 600,
          }}
        >
          {label}
        </div>
        {badge && (
          <div
            style={{
              fontSize: 10,
              letterSpacing: 1.2,
              color: badge.color,
              background: `${badge.color}1c`,
              border: `1px solid ${badge.color}40`,
              padding: "2px 8px",
              borderRadius: 999,
              fontWeight: 700,
            }}
          >
            {badge.text}
          </div>
        )}
      </div>
      {children}
    </section>
  );
}

function StatRow({
  label,
  value,
  emphasis,
  color,
}: {
  label: string;
  value: React.ReactNode;
  emphasis?: boolean;
  color?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        padding: "6px 0",
        borderBottom: "1px solid #1a2230",
      }}
    >
      <span style={{ fontSize: 12, color: "#8b949e" }}>{label}</span>
      <span
        style={{
          fontSize: emphasis ? 18 : 13,
          color: color ?? "#e8edf2",
          fontWeight: emphasis ? 700 : 600,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </span>
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────

export function ControlPanel(props: Props) {
  const {
    locationName,
    params,
    setParams,
    stats,
    liveForecast,
    plan,
    optimizing,
    optimizerProgress,
    showPlanOverlay,
    planExecuted,
    isRunning,
    isBurning,
    onPlayPause,
    onReset,
    onIgniteRandom,
    onExecutePlan,
    onTogglePlanOverlay,
    onRecomputePlan,
  } = props;

  const currentDir =
    WIND_DIRS.find((d) => d.x === params.windDirX && d.y === params.windDirY)
      ?.label ?? "N";

  const phase = isBurning
    ? "ACTIVE FIRE"
    : stats.burned > 0
    ? planExecuted
      ? "TREATED"
      : "EXTINGUISHED"
    : "IDLE";
  const phaseColor =
    phase === "ACTIVE FIRE"
      ? "#f85149"
      : phase === "TREATED"
      ? "#3fb950"
      : phase === "EXTINGUISHED"
      ? "#a371f7"
      : "#8b949e";

  // Forecast numbers
  const preBurn = plan?.preBurnWorstCase ?? liveForecast ?? null;
  const postBurn = plan?.postBurnWorstCase ?? null;
  const savings =
    preBurn !== null && postBurn !== null ? preBurn - postBurn : null;

  const fmtPct = (v: number | null) =>
    v === null ? "—" : `${(v * 100).toFixed(0)}%`;

  return (
    <aside
      style={{
        width: 360,
        background: "#0b1018",
        borderLeft: "1px solid #1f2630",
        padding: 24,
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
        gap: 24,
      }}
    >
      {/* Header */}
      <div>
        <div
          style={{
            fontSize: 11,
            letterSpacing: 2,
            color: "#8b949e",
            marginBottom: 4,
            fontWeight: 600,
          }}
        >
          AI BURN PLANNER
        </div>
        <div
          style={{
            fontSize: 20,
            fontWeight: 700,
            color: "#e8edf2",
            letterSpacing: 0.5,
          }}
        >
          {locationName}
        </div>
        <div
          className={phase === "ACTIVE FIRE" ? "pulse" : undefined}
          style={{
            fontSize: 11,
            color: phaseColor,
            marginTop: 6,
            letterSpacing: 1.5,
            fontWeight: 700,
          }}
        >
          ● {phase}
        </div>
      </div>

      {/* LIVE STATE */}
      <Section label="LIVE STATE">
        <div
          style={{
            background: "#0e141b",
            border: "1px solid #1f2630",
            borderRadius: 10,
            padding: "4px 14px",
          }}
        >
          <StatRow
            label="Burning cells"
            value={stats.burning.toLocaleString()}
            color={stats.burning > 0 ? "#ffb070" : undefined}
          />
          <StatRow
            label="Active fire front"
            value={stats.fireFront.toLocaleString()}
          />
          <StatRow label="Burned area" value={fmtPct(stats.burnedPct)} />
          <StatRow
            label="Status"
            value={
              isRunning
                ? "running 12.5 ticks/s"
                : isBurning
                ? "paused"
                : "idle"
            }
          />
        </div>
      </Section>

      {/* RISK FORECAST */}
      <Section
        label="RISK FORECAST"
        badge={{ text: "WORST-CASE", color: "#f85149" }}
      >
        <div
          style={{
            background: "#0e141b",
            border: "1px solid #1f2630",
            borderRadius: 10,
            padding: 16,
          }}
        >
          <div
            style={{
              fontSize: 10,
              letterSpacing: 1.4,
              color: "#6e7681",
              marginBottom: 6,
            }}
          >
            EXPECTED BURNED AREA IF A WILDFIRE STARTS UNDER HOT/DRY/WINDY
            CONDITIONS:
          </div>
          <div
            style={{
              display: "flex",
              gap: 16,
              alignItems: "baseline",
              marginTop: 8,
            }}
          >
            <ForecastValue
              label="No treatment"
              value={fmtPct(preBurn)}
              color="#f85149"
            />
            <ForecastArrow />
            <ForecastValue
              label={planExecuted ? "Now" : "After plan"}
              value={fmtPct(postBurn)}
              color={planExecuted ? "#3fb950" : "#56d364"}
            />
          </div>
          {savings !== null && (
            <div
              style={{
                marginTop: 14,
                paddingTop: 12,
                borderTop: "1px solid #1f2630",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  color: "#8b949e",
                  letterSpacing: 1,
                }}
              >
                {savings >= 0 ? "Savings" : "Worse by"}
              </span>
              <span
                style={{
                  fontSize: 16,
                  fontWeight: 700,
                  color:
                    savings > 0.005
                      ? "#3fb950"
                      : savings < -0.005
                      ? "#f85149"
                      : "#8b949e",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {savings >= 0 ? "−" : "+"}
                {Math.abs(savings * 100).toFixed(0)} pts
              </span>
            </div>
          )}
        </div>
      </Section>

      {/* SUGGESTED PLAN */}
      <Section
        label="SUGGESTED BURN PLAN"
        badge={
          plan
            ? planExecuted
              ? { text: "EXECUTED", color: "#3fb950" }
              : { text: "READY", color: "#56d364" }
            : optimizing
            ? { text: "SEARCHING", color: "#d29922" }
            : undefined
        }
      >
        <div
          style={{
            background: "#0e141b",
            border: "1px solid #1f2630",
            borderRadius: 10,
            padding: 16,
          }}
        >
          {optimizing ? (
            <div>
              <div
                style={{
                  fontSize: 12,
                  color: "#cdd9e8",
                  marginBottom: 8,
                }}
              >
                Searching the parameter space for an effective treatment…
              </div>
              <ProgressBar progress={Math.min(1, optimizerProgress / 50)} />
              <div
                style={{
                  fontSize: 10,
                  color: "#6e7681",
                  letterSpacing: 1,
                  marginTop: 8,
                }}
              >
                ITERATION {optimizerProgress} / 50
              </div>
            </div>
          ) : plan ? (
            <>
              <div style={{ fontSize: 12, color: "#cdd9e8", lineHeight: 1.5 }}>
                {plan.strips.length} strips covering{" "}
                <b>{(plan.burnFraction * 100).toFixed(1)}%</b> of the burnable
                landscape. Targets the highest-impact fuel breaks the optimizer
                could find.
              </div>
              <div
                style={{
                  marginTop: 12,
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                {!planExecuted && (
                  <>
                    <Btn variant="ghost" onClick={onTogglePlanOverlay}>
                      {showPlanOverlay ? "Hide overlay" : "Show overlay"}
                    </Btn>
                    <Btn variant="primary" onClick={onExecutePlan}>
                      Execute plan
                    </Btn>
                  </>
                )}
                <Btn variant="ghost" onClick={onRecomputePlan}>
                  Recompute plan
                </Btn>
              </div>
            </>
          ) : (
            <div style={{ fontSize: 12, color: "#8b949e" }}>
              No plan available yet. Optimizer will run automatically.
            </div>
          )}
        </div>
      </Section>

      {/* CONDITIONS */}
      <Section label="CONDITIONS">
        <Slider
          label="Wind speed"
          unit=" mph"
          value={params.windSpeed}
          min={0}
          max={50}
          onChange={(v) => setParams({ ...params, windSpeed: v })}
        />
        <div style={{ marginBottom: 14 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 12,
              marginBottom: 6,
            }}
          >
            <span style={{ color: "#8b949e" }}>Wind direction</span>
            <span style={{ color: "#e8edf2", fontWeight: 600 }}>
              {currentDir}
            </span>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(8, 1fr)",
              gap: 4,
            }}
          >
            {WIND_DIRS.map((d) => {
              const active =
                d.x === params.windDirX && d.y === params.windDirY;
              return (
                <button
                  key={d.label}
                  onClick={() =>
                    setParams({ ...params, windDirX: d.x, windDirY: d.y })
                  }
                  style={{
                    background: active ? "#1f6feb" : "#21262d",
                    border: "1px solid #30363d",
                    color: active ? "white" : "#cdd9e8",
                    fontSize: 10,
                    padding: "6px 0",
                    borderRadius: 4,
                    cursor: "pointer",
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
        <div
          style={{
            fontSize: 10,
            color: "#6e7681",
            lineHeight: 1.4,
            marginTop: 4,
          }}
        >
          Conditions affect both the live simulation and the worst-case
          forecast on the next idle frame.
        </div>
      </Section>

      {/* ACTIONS */}
      <Section label="ACTIONS">
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Btn
            onClick={onPlayPause}
            variant="primary"
            disabled={!isBurning && !isRunning}
          >
            {isRunning
              ? "Pause Simulation"
              : isBurning
              ? "Resume"
              : "Play (light a fire first)"}
          </Btn>
          <Btn onClick={onIgniteRandom} variant="danger">
            Ignite random spark
          </Btn>
          <Btn onClick={onReset}>Reset landscape</Btn>
        </div>
      </Section>

      {/* Footer / honest caveats */}
      <div
        style={{
          fontSize: 10,
          color: "#525d68",
          lineHeight: 1.6,
          paddingTop: 12,
          borderTop: "1px solid #1a2230",
        }}
      >
        <div style={{ marginBottom: 6, fontWeight: 600, color: "#6e7681" }}>
          DATA · Fuel: NDVI proxy · Slope: SRTM · Spread: cellular automaton
          (Rothermel-inspired, not Rothermel-grade) · Spotting: enabled.
        </div>
        Click anywhere on the terrain to start a fire. The optimizer runs once
        per location and is cached. "Execute plan" applies the burn so you can
        see how the same wildfire behaves on the treated landscape.
      </div>
    </aside>
  );
}

function ForecastValue({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div style={{ flex: 1 }}>
      <div
        style={{
          fontSize: 24,
          fontWeight: 700,
          color,
          letterSpacing: 0.5,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: 10,
          color: "#6e7681",
          letterSpacing: 1.2,
          textTransform: "uppercase",
          marginTop: 2,
        }}
      >
        {label}
      </div>
    </div>
  );
}

function ForecastArrow() {
  return (
    <div
      style={{
        color: "#3a4452",
        fontSize: 18,
        fontWeight: 300,
        alignSelf: "center",
        paddingBottom: 12,
      }}
    >
      →
    </div>
  );
}

function ProgressBar({ progress }: { progress: number }) {
  return (
    <div
      style={{
        height: 6,
        background: "#1f2630",
        borderRadius: 3,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: `${Math.max(0, Math.min(1, progress)) * 100}%`,
          height: "100%",
          background: "linear-gradient(90deg, #d29922, #f85149)",
          transition: "width 0.2s ease",
        }}
      />
    </div>
  );
}
