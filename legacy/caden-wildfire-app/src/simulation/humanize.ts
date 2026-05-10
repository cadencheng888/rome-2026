// Plain-language translators that wrap the Rothermel/PMS-484 outputs in
// language a non-specialist can read. Used by ControlPanel for the friendly UI.

import type { FuelMoisture } from "./rothermel";

// ── Fire behavior ────────────────────────────────────────────────────────────

export interface PlainBehavior {
  flameLabel: string;     // e.g. "Two-story flames"
  flameDetail: string;    // e.g. "Above the height of a house"
  speedLabel: string;     // e.g. "Faster than walking"
  speedDetail: string;    // e.g. "About 12 mph"
}

export function describeBehavior(
  flameLengthFt: number,
  rosChHr: number,
): PlainBehavior {
  // 1 chain = 66 ft. ch/hr → mph: × 66 / 5280 = × 0.0125
  const mph = rosChHr * 0.0125;

  let flameLabel: string;
  let flameDetail: string;
  if (flameLengthFt < 0.5) {
    flameLabel = "Barely smoldering";
    flameDetail = "Almost no visible flame";
  } else if (flameLengthFt < 2) {
    flameLabel = "Ankle-high flames";
    flameDetail = "Crews can step over the fire";
  } else if (flameLengthFt < 4) {
    flameLabel = "Knee-high flames";
    flameDetail = "Handcrew can fight it directly";
  } else if (flameLengthFt < 8) {
    flameLabel = "Above-your-head flames";
    flameDetail = "Engines and dozers required";
  } else if (flameLengthFt < 12) {
    flameLabel = "Two-story flames";
    flameDetail = "Cannot direct-attack — air support needed";
  } else if (flameLengthFt < 20) {
    flameLabel = "Building-height flames";
    flameDetail = "Extreme behavior, evacuate the area";
  } else {
    flameLabel = "Towering flames";
    flameDetail = "Uncontrollable — let it run, defend lives";
  }

  let speedLabel: string;
  let speedDetail: string;
  if (mph < 0.05) {
    speedLabel = "Creeping";
    speedDetail = "Barely moving";
  } else if (mph < 0.5) {
    speedLabel = "Slow crawl";
    speedDetail = "Slower than a walk";
  } else if (mph < 2) {
    speedLabel = "Walking pace";
    speedDetail = `About ${mph.toFixed(1)} mph`;
  } else if (mph < 5) {
    speedLabel = "Brisk walk";
    speedDetail = `About ${mph.toFixed(1)} mph`;
  } else if (mph < 12) {
    speedLabel = "Faster than running";
    speedDetail = `About ${mph.toFixed(0)} mph`;
  } else {
    speedLabel = "Vehicle pace";
    speedDetail = `About ${mph.toFixed(0)} mph — you cannot outrun it`;
  }

  return { flameLabel, flameDetail, speedLabel, speedDetail };
}

// ── Severity headline (for the gauge) ────────────────────────────────────────

export function severityHeadline(score: number): {
  headline: string;
  blurb: string;
} {
  if (score <= 25)
    return {
      headline: "Mild fire conditions",
      blurb: "Typical of a fall prescribed-burn day. Crews can engage directly.",
    };
  if (score <= 50)
    return {
      headline: "Active fire conditions",
      blurb: "Fire will spread but stays manageable with engines and crews.",
    };
  if (score <= 75)
    return {
      headline: "Intense fire conditions",
      blurb: "Direct attack is difficult. Air support and dozers needed.",
    };
  return {
    headline: "Extreme fire weather",
    blurb: "DO NOT IGNITE. Fire would be uncontrollable — evacuate, don't fight.",
  };
}

// ── Friendly fuel names ──────────────────────────────────────────────────────

export const FRIENDLY_FUEL_NAMES: Record<
  string,
  { label: string; blurb: string }
> = {
  GR1: {
    label: "Sparse dry grass",
    blurb: "Short, sparse grasses. Burns fast but flames stay short.",
  },
  GR2: {
    label: "Dry grass",
    blurb: "Continuous grass cover. Quick-spreading, low flames.",
  },
  GS2: {
    label: "Grass mixed with shrubs",
    blurb: "Grass with scattered brush. Moderate flames, moderate speed.",
  },
  SH5: {
    label: "Dry shrub / chaparral",
    blurb: "Tall, dry shrubs. Tall flames, very high intensity.",
  },
  TL3: {
    label: "Pine forest floor",
    blurb: "Conifer needles and twigs. Classic prescribed-burn fuel.",
  },
  TU5: {
    label: "Heavy timber + shrubs",
    blurb: "Dense forest with brushy understory. Tall flames likely.",
  },
  SB1: {
    label: "Logging slash",
    blurb: "Cut branches and tops. Heavy fuel, long burn time.",
  },
  NB1: {
    label: "Non-burnable (urban / bare)",
    blurb: "No vegetation to carry fire.",
  },
};

// ── Dryness presets (single-slider abstraction over fuel moisture) ───────────

export type DrynessLevel = "wet" | "normal" | "dry" | "critical";

export const DRYNESS_PRESETS: Record<DrynessLevel, FuelMoisture> = {
  wet: {
    dead1h: 0.18,
    dead10h: 0.22,
    dead100h: 0.28,
    liveHerb: 2.0,
    liveWoody: 1.8,
  },
  normal: {
    dead1h: 0.12,
    dead10h: 0.14,
    dead100h: 0.18,
    liveHerb: 1.2,
    liveWoody: 1.3,
  },
  dry: {
    dead1h: 0.08,
    dead10h: 0.10,
    dead100h: 0.14,
    liveHerb: 0.8,
    liveWoody: 1.0,
  },
  critical: {
    dead1h: 0.04,
    dead10h: 0.05,
    dead100h: 0.08,
    liveHerb: 0.6,
    liveWoody: 0.8,
  },
};

// 0..100 dryness slider position → fuel moisture.
// 0 = wet (just rained), 33 = normal, 66 = dry, 100 = critical drought.
export function moistureFromDryness(d: number): FuelMoisture {
  const x = Math.max(0, Math.min(100, d));
  let from: DrynessLevel, to: DrynessLevel, t: number;
  if (x < 33.33) {
    from = "wet";
    to = "normal";
    t = x / 33.33;
  } else if (x < 66.66) {
    from = "normal";
    to = "dry";
    t = (x - 33.33) / 33.33;
  } else {
    from = "dry";
    to = "critical";
    t = Math.min(1, (x - 66.66) / 33.34);
  }
  const a = DRYNESS_PRESETS[from];
  const b = DRYNESS_PRESETS[to];
  return {
    dead1h: a.dead1h + (b.dead1h - a.dead1h) * t,
    dead10h: a.dead10h + (b.dead10h - a.dead10h) * t,
    dead100h: a.dead100h + (b.dead100h - a.dead100h) * t,
    liveHerb: a.liveHerb + (b.liveHerb - a.liveHerb) * t,
    liveWoody: a.liveWoody + (b.liveWoody - a.liveWoody) * t,
  };
}

// Reverse: estimate slider position from a given moisture state. Used to
// pre-position the slider when the user lands on a page or after the wildfire
// preset slams moisture down. Approximate — we use 1-hr as the anchor.
export function drynessFromMoisture(fm: FuelMoisture): number {
  const fm1h = fm.dead1h;
  // Wet = 0.18, normal = 0.12, dry = 0.08, critical = 0.04.
  // Linear interpolation across those breakpoints.
  if (fm1h >= 0.18) return 0;
  if (fm1h >= 0.12) return ((0.18 - fm1h) / (0.18 - 0.12)) * 33.33;
  if (fm1h >= 0.08)
    return 33.33 + ((0.12 - fm1h) / (0.12 - 0.08)) * 33.33;
  if (fm1h >= 0.04)
    return 66.66 + ((0.08 - fm1h) / (0.08 - 0.04)) * 33.34;
  return 100;
}

export function drynessLabel(d: number): { label: string; blurb: string } {
  if (d < 16)
    return {
      label: "Soaking wet",
      blurb: "Recent rain. Most fires won't carry.",
    };
  if (d < 33)
    return {
      label: "Damp",
      blurb: "Cool spring/fall conditions.",
    };
  if (d < 50)
    return {
      label: "Normal",
      blurb: "Typical summer fuels — average burning.",
    };
  if (d < 66)
    return {
      label: "Dry",
      blurb: "Late-summer cured fuels. Fires will carry well.",
    };
  if (d < 83)
    return {
      label: "Very dry",
      blurb: "Drought-stressed fuels. Active fire behavior likely.",
    };
  return {
    label: "Critical drought",
    blurb: "Fuels at ignition limit. Extreme fire behavior expected.",
  };
}

// ── Plain-English prescription violation translation ─────────────────────────

export function plainifyViolations(violations: string[]): string[] {
  return violations.map(plainifyOne);
}

export function plainifyWarnings(warnings: string[]): string[] {
  return warnings.map(plainifyOne);
}

function plainifyOne(v: string): string {
  if (/^Temp .*outside/.test(v))
    return v.includes("outside")
      ? `Air temperature is outside the safe range.`
      : v;
  if (/^RH /.test(v)) return "Humidity is outside the safe range.";
  if (/^Mid-flame wind /.test(v))
    return "Wind speed is outside the safe range.";
  if (/^1-hr FM /.test(v)) return "Fine surface fuels are outside the safe range.";
  if (/^10-hr FM /.test(v))
    return "Twig-sized fuels are outside the safe range.";
  if (/^100-hr FM /.test(v))
    return "Branch-sized fuels are outside the safe range.";
  if (/^Live herb /.test(v))
    return "Green grass / herbaceous plants are outside the safe range.";
  if (/^Live woody /.test(v))
    return "Live shrubs / brush are outside the safe range.";
  if (/^Predicted flame length /.test(v))
    return "Predicted flames would be too tall to safely contain.";
  if (/^Predicted ROS /.test(v))
    return "Fire would spread too fast to safely contain.";
  if (/^Fireline intensity /.test(v))
    return "Fire would burn too hot to safely contain.";
  if (/^Mixing height /.test(v))
    return "Smoke would not lift away — air-quality risk.";
  if (/^Transport wind /.test(v))
    return "Upper-level winds wouldn't carry smoke safely.";
  if (/^Ventilation index /.test(v))
    return "Atmosphere is too stable — smoke would settle.";
  if (/^Days since wetting rain /.test(v))
    return "Time since last rain is outside the safe range.";
  return v;
}
