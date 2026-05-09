import type { RiskBreakdown, SimParams } from "../fireEngine";
import type { FireMode, SimSummary } from "../SimulationView";
import { RiskGauge } from "./RiskGauge";

interface Props {
  params: SimParams;
  setParams: (p: SimParams) => void;
  riskScore: number;
  breakdown: RiskBreakdown;
  previousRisk: number | null;
  isRunning: boolean;
  isBurning: boolean;
  fireMode: FireMode;
  setFireMode: (m: FireMode) => void;
  summary: SimSummary | null;
  onPlayPause: () => void;
  onReset: () => void;
  onIgniteRandom: () => void;
  onControlledBurn: () => void;
}

// Green → yellow → orange → red, matching real-world fire danger signs
function factorColor(pct: number): string {
  if (pct < 25) return "#3fb950"; // green
  if (pct < 50) return "#e3b341"; // yellow
  if (pct < 75) return "#e8822a"; // orange
  return "#f85149"; // red
}

function FactorBar({ label, value }: { label: string; value: number }) {
  const pct = Math.round(value * 100);
  const color = factorColor(pct);
  return (
    <div style={{ marginBottom: 8 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 11,
          marginBottom: 3,
        }}
      >
        <span style={{ color: "#8b949e", letterSpacing: 0.5 }}>{label}</span>
        <span style={{ color: "#cdd9e8", fontWeight: 600 }}>{pct}</span>
      </div>
      <div
        style={{
          height: 4,
          background: "#1f2630",
          borderRadius: 3,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: color,
            transition: "width 0.4s ease, background 0.4s ease",
          }}
        />
      </div>
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
  variant?: "default" | "primary" | "danger";
  disabled?: boolean;
}) {
  const styles: Record<string, React.CSSProperties> = {
    default: {
      background: "#21262d",
      color: "#e8edf2",
      border: "1px solid #30363d",
    },
    primary: {
      background: "#1f6feb",
      color: "white",
      border: "1px solid #1f6feb",
    },
    danger: {
      background: "#f85149",
      color: "white",
      border: "1px solid #f85149",
    },
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
        opacity: disabled ? 0.5 : 1,
        width: "100%",
      }}
    >
      {children}
    </button>
  );
}

function FireModeToggle({
  value,
  onChange,
  disabled,
}: {
  value: FireMode;
  onChange: (v: FireMode) => void;
  disabled?: boolean;
}) {
  const options: Array<{
    value: FireMode;
    label: string;
    description: string;
  }> = [
    {
      value: "wildfire",
      label: "Wildfire",
      description: "Max heat, low humidity, strong erratic wind",
    },
    {
      value: "controlled",
      label: "Controlled Burn",
      description: "Steady conditions, contained spread",
    },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {options.map((opt) => {
        const active = value === opt.value;
        const accent = opt.value === "wildfire" ? "#f85149" : "#1f6feb";
        return (
          <button
            key={opt.value}
            onClick={() => !disabled && onChange(opt.value)}
            style={{
              background: active
                ? opt.value === "wildfire"
                  ? "rgba(248,81,73,0.12)"
                  : "rgba(31,111,235,0.12)"
                : "#0b1018",
              border: `1px solid ${active ? accent : "#1f2630"}`,
              borderRadius: 10,
              padding: "12px 14px",
              cursor: disabled ? "not-allowed" : "pointer",
              opacity: disabled ? 0.5 : 1,
              textAlign: "left",
              transition: "all 0.2s ease",
              display: "flex",
              alignItems: "center",
              gap: 12,
              width: "100%",
            }}
          >
            <div>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: active ? accent : "#cdd9e8",
                  marginBottom: 2,
                }}
              >
                {opt.label}
              </div>
              <div style={{ fontSize: 11, color: "#6e7681" }}>
                {opt.description}
              </div>
            </div>
            {active && (
              <div
                style={{
                  marginLeft: "auto",
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: accent,
                  boxShadow: `0 0 6px ${accent}`,
                  flexShrink: 0,
                }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

function SummaryPanel({ summary }: { summary: SimSummary }) {
  const isControlled = summary.mode === "controlled";
  const accent = isControlled ? "#1f6feb" : "#f85149";
  const riskDrop = summary.riskBefore - summary.riskAfter;

  return (
    <section
      style={{
        background: isControlled
          ? "rgba(31,111,235,0.07)"
          : "rgba(248,81,73,0.07)",
        border: `1px solid ${accent}40`,
        borderRadius: 12,
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div
          style={{
            fontSize: 11,
            letterSpacing: 2,
            color: accent,
            fontWeight: 700,
          }}
        >
          {isControlled ? "BURN COMPLETE" : "FIRE BURNED OUT"}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <StatBlock
          label="Area consumed"
          value={`${summary.percentConsumed}%`}
          good={isControlled && summary.percentConsumed < 15}
          bad={!isControlled && summary.percentConsumed > 30}
        />
        <StatBlock label="Duration" value={`${summary.elapsedSeconds}s`} />
        <StatBlock label="Risk before" value={String(summary.riskBefore)} />
        <StatBlock
          label="Risk after"
          value={String(summary.riskAfter)}
          good={summary.riskAfter < summary.riskBefore}
          bad={summary.riskAfter > summary.riskBefore}
        />
      </div>

      {isControlled && riskDrop > 0 && (
        <div
          style={{
            background: "rgba(63,185,80,0.1)",
            border: "1px solid #3fb95040",
            borderRadius: 8,
            padding: "10px 12px",
            fontSize: 12,
            color: "#3fb950",
            lineHeight: 1.5,
          }}
        >
          Risk reduced by <strong>{riskDrop} points</strong>. Burning away fuel
          now prevents a future wildfire from having the same explosive spread.
        </div>
      )}

      {!isControlled && (
        <div
          style={{
            background: "rgba(248,81,73,0.1)",
            border: "1px solid #f8514940",
            borderRadius: 8,
            padding: "10px 12px",
            fontSize: 12,
            color: "#ffb4ad",
            lineHeight: 1.5,
          }}
        >
          An uncontrolled fire consumed{" "}
          <strong>{summary.percentConsumed}%</strong> of the forest. A
          controlled burn beforehand could have broken up the fuel and limited
          this spread.
        </div>
      )}
    </section>
  );
}

function StatBlock({
  label,
  value,
  good,
  bad,
}: {
  label: string;
  value: string;
  good?: boolean;
  bad?: boolean;
}) {
  const color = good ? "#3fb950" : bad ? "#f85149" : "#cdd9e8";
  return (
    <div
      style={{ background: "#0b1018", borderRadius: 8, padding: "8px 10px" }}
    >
      <div
        style={{
          fontSize: 10,
          color: "#6e7681",
          letterSpacing: 1,
          marginBottom: 3,
        }}
      >
        {label.toUpperCase()}
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

function GaugeContext({
  mode,
  isBurning,
  isRunning,
}: {
  mode: FireMode;
  isBurning: boolean;
  isRunning: boolean;
}) {
  let msg = "";
  if (isBurning && mode === "controlled")
    msg = "Controlled fire is reducing fuel load…";
  else if (isBurning && mode === "wildfire")
    msg = "Wildfire is consuming fuel rapidly.";
  else if (mode === "controlled")
    msg =
      "Controlled burns lower future wildfire risk by clearing excess fuel.";
  else msg = "High fuel load, heat, and wind all drive risk upward.";

  return (
    <div
      style={{
        fontSize: 11,
        color: "#6e7681",
        textAlign: "center",
        lineHeight: 1.5,
        marginTop: 4,
        fontStyle: "italic",
      }}
    >
      {msg}
    </div>
  );
}

export function ControlPanel(props: Props) {
  const {
    setParams,
    riskScore,
    breakdown,
    previousRisk,
    isRunning,
    isBurning,
    fireMode,
    setFireMode,
    summary,
    onPlayPause,
    onReset,
    onIgniteRandom,
    onControlledBurn,
  } = props;

  const WIND_DIRS = [
    { x: 0, y: -1 },
    { x: 1, y: -1 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
    { x: -1, y: 1 },
    { x: -1, y: 0 },
    { x: -1, y: -1 },
  ];
  function randBetween(lo: number, hi: number) {
    return lo + Math.random() * (hi - lo);
  }

  const handlePlay = () => {
    if (isRunning || isBurning) {
      onPlayPause();
      return;
    }
    if (fireMode === "wildfire") {
      const dir = WIND_DIRS[Math.floor(Math.random() * WIND_DIRS.length)];
      setParams({
        windSpeed: Math.round(randBetween(38, 48)),
        windDirX: dir.x,
        windDirY: dir.y,
        humidity: Math.round(randBetween(5, 15)),
        temperature: Math.round(randBetween(95, 108)),
      });
      onIgniteRandom();
    } else {
      const dir = WIND_DIRS[Math.floor(Math.random() * WIND_DIRS.length)];
      setParams({
        windSpeed: Math.round(randBetween(8, 16)),
        windDirX: dir.x,
        windDirY: dir.y,
        humidity: Math.round(randBetween(22, 32)),
        temperature: Math.round(randBetween(82, 94)),
      });
      onControlledBurn();
    }
  };

  const playLabel = isRunning
    ? "Pause Simulation"
    : isBurning
    ? "Resume Simulation"
    : "Play Simulation";

  return (
    <aside
      style={{
        width: 340,
        background: "#0e141b",
        borderLeft: "1px solid #1f2630",
        padding: 24,
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
        gap: 20,
      }}
    >
      <div>
        <div
          style={{
            fontSize: 11,
            letterSpacing: 2,
            color: "#8b949e",
            marginBottom: 4,
          }}
        >
          PRESCRIBED BURN SIMULATOR
        </div>
        <div style={{ fontSize: 20, fontWeight: 700 }}>Fire Risk Dashboard</div>
      </div>

      <section
        style={{
          background: "#0b1018",
          borderRadius: 12,
          padding: 20,
          border: "1px solid #1f2630",
        }}
      >
        <div
          style={{
            fontSize: 11,
            letterSpacing: 2,
            color: "#8b949e",
            marginBottom: 8,
            textAlign: "center",
          }}
        >
          SEVERITY GAUGE
        </div>
        <RiskGauge score={riskScore} previousScore={previousRisk} />
        <GaugeContext
          mode={fireMode}
          isBurning={isBurning}
          isRunning={isRunning}
        />
        <div
          style={{
            marginTop: 14,
            paddingTop: 14,
            borderTop: "1px solid #1f2630",
          }}
        >
          <div
            style={{
              fontSize: 10,
              letterSpacing: 1.5,
              color: "#6e7681",
              marginBottom: 10,
            }}
          >
            CONTRIBUTING FACTORS
          </div>
          <FactorBar label="Fuel load" value={breakdown.factors.fuelLoad} />
          <FactorBar
            label="Fuel continuity"
            value={breakdown.factors.continuity}
          />
          <FactorBar label="Slope / terrain" value={breakdown.factors.slope} />
          <FactorBar
            label="Weather (temp / hum)"
            value={breakdown.factors.weather}
          />
          <FactorBar label="Wind" value={breakdown.factors.wind} />
        </div>
      </section>

      {summary && <SummaryPanel summary={summary} />}

      <section>
        <div
          style={{
            fontSize: 11,
            letterSpacing: 2,
            color: "#8b949e",
            marginBottom: 12,
          }}
        >
          FIRE TYPE
        </div>
        <FireModeToggle
          value={fireMode}
          onChange={setFireMode}
          disabled={isRunning || isBurning}
        />
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div
          style={{
            fontSize: 11,
            letterSpacing: 2,
            color: "#8b949e",
            marginBottom: 4,
          }}
        >
          ACTIONS
        </div>
        <Btn
          onClick={handlePlay}
          variant={fireMode === "wildfire" ? "danger" : "primary"}
        >
          {playLabel}
        </Btn>
        <Btn onClick={onReset}>Reset Simulation</Btn>
      </section>

      <div style={{ fontSize: 11, color: "#6e7681", lineHeight: 1.6 }}>
        Select a fire type and press play. Controlled burns intentionally clear
        fuel strips to reduce the severity of future wildfires. Click terrain to
        ignite a custom point.
      </div>
    </aside>
  );
}
