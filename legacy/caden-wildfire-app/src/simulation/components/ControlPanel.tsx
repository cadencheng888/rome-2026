import type { RiskBreakdown, SimParams } from "../fireEngine";
import type { FireMode, SimSummary } from "../SimulationView";
import type { PrescriptionResult, PrescriptionWindow } from "../prescription";
import { FUEL_MODEL_ORDER } from "../fuelModels";
import {
  describeBehavior,
  drynessFromMoisture,
  drynessLabel,
  FRIENDLY_FUEL_NAMES,
  moistureFromDryness,
  plainifyViolations,
  plainifyWarnings,
  severityHeadline,
} from "../humanize";
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
  prescription: PrescriptionWindow;
  rxResult: PrescriptionResult;
  onPlayPause: () => void;
  onReset: () => void;
  onIgniteRandom: () => void;
  onControlledBurn: () => void;
  onShowBurnPlan: () => void;
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

function GaugeContext({ score }: { score: number }) {
  const { headline, blurb } = severityHeadline(score);
  const accent =
    score <= 25
      ? "#3fb950"
      : score <= 50
      ? "#e3b341"
      : score <= 75
      ? "#e8822a"
      : "#f85149";
  return (
    <div style={{ textAlign: "center", marginTop: 6 }}>
      <div
        style={{
          fontSize: 13,
          fontWeight: 700,
          color: accent,
          marginBottom: 4,
        }}
      >
        {headline}
      </div>
      <div
        style={{
          fontSize: 11,
          color: "#8b949e",
          lineHeight: 1.5,
        }}
      >
        {blurb}
      </div>
    </div>
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
    fireMode,
    setFireMode,
    summary,
    prescription,
    rxResult,
    onPlayPause,
    onReset,
    onIgniteRandom,
    onControlledBurn,
    onShowBurnPlan,
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
      // Critical fire weather: hot, dry, windy. Drives fuels below extinction
      // moisture, intentionally outside any Rx window.
      setParams({
        ...params,
        windSpeed: Math.round(randBetween(30, 45)),
        windDirX: dir.x,
        windDirY: dir.y,
        humidity: Math.round(randBetween(5, 15)),
        temperature: Math.round(randBetween(90, 105)),
        fuelMoisture: {
          dead1h: 0.04,
          dead10h: 0.05,
          dead100h: 0.07,
          liveHerb: 0.45,
          liveWoody: 0.70,
        },
      });
      onIgniteRandom();
    } else {
      const dir = WIND_DIRS[Math.floor(Math.random() * WIND_DIRS.length)];
      // Mid-window Rx conditions for the selected fuel model.
      setParams({
        ...params,
        windSpeed: Math.round(randBetween(3, 7)),
        windDirX: dir.x,
        windDirY: dir.y,
        humidity: Math.round(randBetween(30, 45)),
        temperature: Math.round(randBetween(55, 70)),
        fuelMoisture: {
          dead1h: 0.10,
          dead10h: 0.12,
          dead100h: 0.16,
          liveHerb: 1.0,
          liveWoody: 1.1,
        },
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
        <GaugeContext score={riskScore} />
        <Disclosure label="What's driving this?">
          <div style={{ marginTop: 10 }}>
            <FactorBar label="Fuel load" value={breakdown.factors.fuelLoad} />
            <FactorBar
              label="Fuel continuity"
              value={breakdown.factors.continuity}
            />
            <FactorBar
              label="Slope / terrain"
              value={breakdown.factors.slope}
            />
            <FactorBar
              label="Weather (temp / hum)"
              value={breakdown.factors.weather}
            />
            <FactorBar label="Wind" value={breakdown.factors.wind} />
          </div>
        </Disclosure>
      </section>

      {summary && <SummaryPanel summary={summary} />}

      <FireBehaviorPanel breakdown={breakdown} />
      <FuelModelSection
        params={params}
        setParams={setParams}
        disabled={isRunning || isBurning}
      />
      <FuelMoistureSection
        params={params}
        setParams={setParams}
        disabled={isRunning || isBurning}
      />
      <PrescriptionSection
        prescription={prescription}
        rxResult={rxResult}
        onShowBurnPlan={onShowBurnPlan}
      />

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

// ── Disclosure (collapsible "show details" wrapper) ──────────────────────────

function Disclosure({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <details style={{ marginTop: 10 }}>
      <summary
        style={{
          fontSize: 11,
          color: "#6e7681",
          letterSpacing: 0.5,
          cursor: "pointer",
          userSelect: "none",
          padding: "4px 0",
        }}
      >
        {label}
      </summary>
      <div style={{ marginTop: 6 }}>{children}</div>
    </details>
  );
}

// ── How big will the fire be? (plain-language behavior) ──────────────────────

function FireBehaviorPanel({ breakdown }: { breakdown: RiskBreakdown }) {
  const b = breakdown.behavior;
  const plain = describeBehavior(b.flameLength, breakdown.rosChHr);

  const flameColor =
    b.flameLength <= 4 ? "#3fb950" : b.flameLength <= 8 ? "#e3b341" : "#f85149";
  const rosColor =
    breakdown.rosChHr <= 10
      ? "#3fb950"
      : breakdown.rosChHr <= 30
      ? "#e3b341"
      : "#f85149";

  return (
    <section
      style={{
        background: "#0b1018",
        borderRadius: 12,
        padding: 16,
        border: "1px solid #1f2630",
      }}
    >
      <div
        style={{
          fontSize: 11,
          letterSpacing: 2,
          color: "#8b949e",
          marginBottom: 12,
        }}
      >
        HOW BIG WILL THE FIRE BE?
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <PlainStat
          icon="🔥"
          headline={plain.flameLabel}
          detail={plain.flameDetail}
          measure={`${b.flameLength.toFixed(1)} ft tall`}
          color={flameColor}
        />
        <PlainStat
          icon="💨"
          headline={plain.speedLabel}
          detail={plain.speedDetail}
          measure={`${breakdown.rosChHr.toFixed(1)} chains/hr`}
          color={rosColor}
        />
      </div>
      <Disclosure label="Show technical details (Rothermel)">
        <div
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}
        >
          <BehaviorStat
            label="Heading ROS"
            value={`${breakdown.rosChHr.toFixed(1)} ch/hr`}
          />
          <BehaviorStat
            label="Flame length"
            value={`${b.flameLength.toFixed(1)} ft`}
          />
          <BehaviorStat
            label="Fireline intensity"
            value={`${b.firelineIntensity.toFixed(0)} BTU/ft·s`}
          />
          <BehaviorStat
            label="Heat / area"
            value={`${b.heatPerUnitArea.toFixed(0)} BTU/ft²`}
          />
          <BehaviorStat
            label="Reaction intensity"
            value={`${b.reactionIntensity.toFixed(0)} BTU/ft²·m`}
          />
          <BehaviorStat
            label="Effective wind"
            value={`${b.effectiveWindMph.toFixed(1)} mph`}
          />
          <BehaviorStat
            label="L/W ratio"
            value={b.lengthToWidth.toFixed(2)}
          />
          <BehaviorStat
            label="Mean slope"
            value={`${breakdown.meanSlopePct.toFixed(0)}%`}
          />
        </div>
      </Disclosure>
    </section>
  );
}

function PlainStat({
  icon,
  headline,
  detail,
  measure,
  color,
}: {
  icon: string;
  headline: string;
  detail: string;
  measure: string;
  color: string;
}) {
  return (
    <div
      style={{
        background: "#0e141b",
        border: `1px solid ${color}33`,
        borderRadius: 10,
        padding: "10px 12px",
      }}
    >
      <div style={{ fontSize: 18, marginBottom: 4 }}>{icon}</div>
      <div
        style={{
          fontSize: 13,
          fontWeight: 700,
          color,
          lineHeight: 1.25,
          marginBottom: 3,
        }}
      >
        {headline}
      </div>
      <div
        style={{
          fontSize: 11,
          color: "#8b949e",
          lineHeight: 1.4,
          marginBottom: 6,
        }}
      >
        {detail}
      </div>
      <div
        style={{
          fontSize: 10,
          color: "#6e7681",
          fontFamily: "ui-monospace, monospace",
        }}
      >
        {measure}
      </div>
    </div>
  );
}

function BehaviorStat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: "#0b1018", borderRadius: 6, padding: "5px 7px" }}>
      <div
        style={{
          fontSize: 9,
          color: "#6e7681",
          letterSpacing: 1,
          marginBottom: 2,
        }}
      >
        {label.toUpperCase()}
      </div>
      <div style={{ fontSize: 11, fontWeight: 600, color: "#cdd9e8" }}>
        {value}
      </div>
    </div>
  );
}

// ── What's burning? (friendly fuel-type picker) ──────────────────────────────

function FuelModelSection({
  params,
  setParams,
  disabled,
}: {
  params: SimParams;
  setParams: (p: SimParams) => void;
  disabled: boolean;
}) {
  const friendly = FRIENDLY_FUEL_NAMES[params.fuelModelCode];
  return (
    <section>
      <div
        style={{
          fontSize: 11,
          letterSpacing: 2,
          color: "#8b949e",
          marginBottom: 8,
        }}
      >
        WHAT'S ON THE GROUND?
      </div>
      <select
        value={params.fuelModelCode}
        disabled={disabled}
        onChange={(e) =>
          setParams({ ...params, fuelModelCode: e.target.value })
        }
        style={{
          width: "100%",
          background: "#0b1018",
          border: "1px solid #1f2630",
          color: "#cdd9e8",
          padding: "10px 12px",
          fontSize: 13,
          fontWeight: 600,
          borderRadius: 8,
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.5 : 1,
        }}
      >
        {FUEL_MODEL_ORDER.map((code) => (
          <option key={code} value={code}>
            {FRIENDLY_FUEL_NAMES[code]?.label ?? code}
          </option>
        ))}
      </select>
      {friendly && (
        <div
          style={{
            fontSize: 11,
            color: "#8b949e",
            lineHeight: 1.5,
            marginTop: 6,
          }}
        >
          {friendly.blurb}
        </div>
      )}
      <div
        style={{
          fontSize: 10,
          color: "#6e7681",
          marginTop: 4,
          fontFamily: "ui-monospace, monospace",
        }}
      >
        FBFM40 code: {params.fuelModelCode}
      </div>
    </section>
  );
}

// ── How dry is it? (single-slider abstraction) ───────────────────────────────

function FuelMoistureSection({
  params,
  setParams,
  disabled,
}: {
  params: SimParams;
  setParams: (p: SimParams) => void;
  disabled: boolean;
}) {
  const dryness = drynessFromMoisture(params.fuelMoisture);
  const { label, blurb } = drynessLabel(dryness);
  const accent =
    dryness < 33
      ? "#3fb950"
      : dryness < 66
      ? "#e3b341"
      : dryness < 83
      ? "#e8822a"
      : "#f85149";

  const handleSlide = (v: number) =>
    setParams({ ...params, fuelMoisture: moistureFromDryness(v) });

  const fm = params.fuelMoisture;
  const setFM = (key: keyof SimParams["fuelMoisture"], pct: number) =>
    setParams({
      ...params,
      fuelMoisture: { ...fm, [key]: pct / 100 },
    });

  return (
    <section>
      <div
        style={{
          fontSize: 11,
          letterSpacing: 2,
          color: "#8b949e",
          marginBottom: 8,
        }}
      >
        HOW DRY IS IT?
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 12,
          marginBottom: 6,
        }}
      >
        <span style={{ color: accent, fontWeight: 700 }}>{label}</span>
        <span style={{ color: "#6e7681" }}>{Math.round(dryness)} / 100</span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={dryness}
        disabled={disabled}
        onChange={(e) => handleSlide(Number(e.target.value))}
        style={{ width: "100%", accentColor: accent }}
      />
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 10,
          color: "#6e7681",
          marginTop: 2,
        }}
      >
        <span>Wet</span>
        <span>Normal</span>
        <span>Dry</span>
        <span>Critical</span>
      </div>
      <div
        style={{
          fontSize: 11,
          color: "#8b949e",
          lineHeight: 1.5,
          marginTop: 8,
        }}
      >
        {blurb}
      </div>
      <Disclosure label="Show per-class moisture (advanced)">
        <MoistureSlider
          label="1-hr (fine surface fuels)"
          value={fm.dead1h * 100}
          onChange={(v) => setFM("dead1h", v)}
          min={2}
          max={30}
          disabled={disabled}
        />
        <MoistureSlider
          label="10-hr (twigs)"
          value={fm.dead10h * 100}
          onChange={(v) => setFM("dead10h", v)}
          min={3}
          max={35}
          disabled={disabled}
        />
        <MoistureSlider
          label="100-hr (branches)"
          value={fm.dead100h * 100}
          onChange={(v) => setFM("dead100h", v)}
          min={5}
          max={40}
          disabled={disabled}
        />
        <MoistureSlider
          label="Live herb"
          value={fm.liveHerb * 100}
          onChange={(v) => setFM("liveHerb", v)}
          min={30}
          max={250}
          disabled={disabled}
        />
        <MoistureSlider
          label="Live woody"
          value={fm.liveWoody * 100}
          onChange={(v) => setFM("liveWoody", v)}
          min={60}
          max={250}
          disabled={disabled}
        />
      </Disclosure>
    </section>
  );
}

function MoistureSlider({
  label,
  value,
  onChange,
  min,
  max,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  disabled?: boolean;
}) {
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
        <span style={{ color: "#8b949e" }}>{label}</span>
        <span style={{ color: "#cdd9e8", fontWeight: 600 }}>
          {value.toFixed(0)}%
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: "100%", accentColor: "#1f6feb" }}
      />
    </div>
  );
}

// ── Safe to burn? (plain-language prescription check) ────────────────────────

function PrescriptionSection({
  prescription,
  rxResult,
  onShowBurnPlan,
}: {
  prescription: PrescriptionWindow;
  rxResult: PrescriptionResult;
  onShowBurnPlan: () => void;
}) {
  const accent = rxResult.inWindow ? "#3fb950" : "#f85149";
  const headline = rxResult.inWindow
    ? "Safe to burn"
    : "Not safe to burn right now";
  const subhead = rxResult.inWindow
    ? "All conditions are inside the agency-approved range for this fuel type."
    : "These conditions would produce fire behavior outside the safe range.";

  const plainViolations = plainifyViolations(rxResult.violations);
  const plainWarnings = plainifyWarnings(rxResult.warnings);

  return (
    <section
      style={{
        background: rxResult.inWindow
          ? "rgba(63,185,80,0.07)"
          : "rgba(248,81,73,0.07)",
        border: `1px solid ${accent}55`,
        borderRadius: 12,
        padding: 14,
      }}
    >
      <div
        style={{
          fontSize: 11,
          letterSpacing: 2,
          color: "#8b949e",
          marginBottom: 8,
        }}
      >
        SAFE TO BURN?
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 6,
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            background: accent,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "white",
            fontWeight: 800,
            fontSize: 18,
            flexShrink: 0,
          }}
        >
          {rxResult.inWindow ? "✓" : "✕"}
        </div>
        <div
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: accent,
            lineHeight: 1.2,
          }}
        >
          {headline}
        </div>
      </div>
      <div
        style={{
          fontSize: 11,
          color: "#8b949e",
          lineHeight: 1.5,
          marginBottom: 10,
        }}
      >
        {subhead}
      </div>

      {plainViolations.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div
            style={{
              fontSize: 10,
              color: "#f85149",
              letterSpacing: 1,
              marginBottom: 4,
            }}
          >
            WHAT'S WRONG
          </div>
          <ul
            style={{
              margin: 0,
              paddingLeft: 18,
              fontSize: 11,
              color: "#ffb4ad",
              lineHeight: 1.5,
            }}
          >
            {plainViolations.map((v, i) => (
              <li key={i}>{v}</li>
            ))}
          </ul>
        </div>
      )}

      {plainWarnings.length > 0 && (
        <Disclosure label="Smoke / dispersion notes">
          <ul
            style={{
              margin: 0,
              paddingLeft: 18,
              fontSize: 11,
              color: "#e8d27a",
              lineHeight: 1.5,
            }}
          >
            {plainWarnings.map((v, i) => (
              <li key={i}>{v}</li>
            ))}
          </ul>
        </Disclosure>
      )}

      <button
        onClick={onShowBurnPlan}
        style={{
          width: "100%",
          background: "#21262d",
          color: "#e8edf2",
          border: "1px solid #30363d",
          padding: "8px 12px",
          borderRadius: 8,
          fontSize: 12,
          fontWeight: 600,
          cursor: "pointer",
          marginTop: 8,
        }}
      >
        View official burn plan (PMS 484)
      </button>

      <div
        style={{
          fontSize: 10,
          color: "#6e7681",
          marginTop: 6,
          fontFamily: "ui-monospace, monospace",
        }}
      >
        Rule set: NWCG PMS 484 · {prescription.fuelModelCode}
      </div>
    </section>
  );
}
