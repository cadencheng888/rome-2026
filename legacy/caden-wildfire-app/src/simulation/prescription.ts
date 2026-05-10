// Prescription window definitions and go/no-go check.
// Modeled after NWCG PMS 484 ("Interagency Prescribed Fire Planning and
// Implementation Procedures Guide"), Element 7 (Prescription) and the
// Go/No-Go Pre-Ignition Checklist (PMS 484-1).
//
// Default windows are conservative starting points keyed to fuel-model
// group. Real burn plans must replace these with site-specific values
// approved by an agency-qualified Prescribed Fire Burn Boss.

import type { FireBehavior, FuelMoisture } from "./rothermel";
import type { FuelModel } from "./rothermel";

export interface Range {
  min: number;
  max: number;
}

export interface PrescriptionWindow {
  fuelModelCode: string;
  // Atmospheric
  tempF: Range;
  rh: Range;                 // %
  midflameWindMph: Range;
  transportWindMph: Range;
  mixingHeightFt: { min: number };  // floor only
  ventilationIndex: { min: number };
  // Fuel moisture (% — UI shows percent; engine fractions)
  fm1h: Range;
  fm10h: Range;
  fm100h: Range;
  fmLiveHerb: Range;
  fmLiveWoody: Range;
  // Fire behavior limits
  maxFlameLengthFt: number;
  maxRosChHr: number;
  maxFirelineIntensity: number; // BTU/ft/s
  // Operational
  daysSinceWettingRain: Range;
}

export interface RxConditions {
  tempF: number;
  rh: number;
  midflameWindMph: number;
  transportWindMph: number;
  mixingHeightFt: number;
  ventilationIndex: number;
  daysSinceRain: number;
  fm: FuelMoisture; // fractions
  behavior: FireBehavior;
  rosChHr: number;
}

export interface PrescriptionResult {
  inWindow: boolean;
  violations: string[];
  warnings: string[];
}

// Group-specific defaults. Numbers reflect typical Rx prescriptions from
// published agency burn plans (USFS R5, R6, NPS, TNC) — *starting points
// only*, not a substitute for an approved site plan.
const DEFAULT_BY_GROUP: Record<FuelModel["group"], Omit<PrescriptionWindow, "fuelModelCode">> = {
  TL: {
    tempF: { min: 35, max: 75 },
    rh: { min: 25, max: 55 },
    midflameWindMph: { min: 1, max: 8 },
    transportWindMph: { min: 9, max: 20 },
    mixingHeightFt: { min: 1700 },
    ventilationIndex: { min: 4000 },
    fm1h: { min: 7, max: 15 },
    fm10h: { min: 8, max: 18 },
    fm100h: { min: 12, max: 25 },
    fmLiveHerb: { min: 60, max: 250 },
    fmLiveWoody: { min: 80, max: 250 },
    maxFlameLengthFt: 4,
    maxRosChHr: 10,
    maxFirelineIntensity: 100,
    daysSinceWettingRain: { min: 2, max: 14 },
  },
  TU: {
    tempF: { min: 40, max: 78 },
    rh: { min: 25, max: 55 },
    midflameWindMph: { min: 1, max: 7 },
    transportWindMph: { min: 9, max: 20 },
    mixingHeightFt: { min: 1700 },
    ventilationIndex: { min: 4500 },
    fm1h: { min: 8, max: 16 },
    fm10h: { min: 10, max: 20 },
    fm100h: { min: 14, max: 25 },
    fmLiveHerb: { min: 70, max: 250 },
    fmLiveWoody: { min: 90, max: 250 },
    maxFlameLengthFt: 4,
    maxRosChHr: 8,
    maxFirelineIntensity: 100,
    daysSinceWettingRain: { min: 2, max: 14 },
  },
  GR: {
    tempF: { min: 50, max: 85 },
    rh: { min: 25, max: 60 },
    midflameWindMph: { min: 2, max: 10 },
    transportWindMph: { min: 9, max: 20 },
    mixingHeightFt: { min: 1500 },
    ventilationIndex: { min: 3500 },
    fm1h: { min: 7, max: 14 },
    fm10h: { min: 8, max: 16 },
    fm100h: { min: 10, max: 20 },
    fmLiveHerb: { min: 60, max: 200 },
    fmLiveWoody: { min: 70, max: 200 },
    maxFlameLengthFt: 6,
    maxRosChHr: 50,
    maxFirelineIntensity: 200,
    daysSinceWettingRain: { min: 1, max: 10 },
  },
  GS: {
    tempF: { min: 50, max: 85 },
    rh: { min: 25, max: 60 },
    midflameWindMph: { min: 2, max: 9 },
    transportWindMph: { min: 9, max: 20 },
    mixingHeightFt: { min: 1500 },
    ventilationIndex: { min: 3500 },
    fm1h: { min: 7, max: 14 },
    fm10h: { min: 9, max: 17 },
    fm100h: { min: 12, max: 22 },
    fmLiveHerb: { min: 70, max: 220 },
    fmLiveWoody: { min: 80, max: 220 },
    maxFlameLengthFt: 6,
    maxRosChHr: 30,
    maxFirelineIntensity: 250,
    daysSinceWettingRain: { min: 1, max: 12 },
  },
  SH: {
    tempF: { min: 45, max: 78 },
    rh: { min: 30, max: 60 },
    midflameWindMph: { min: 1, max: 6 },
    transportWindMph: { min: 9, max: 20 },
    mixingHeightFt: { min: 1700 },
    ventilationIndex: { min: 5000 },
    fm1h: { min: 9, max: 16 },
    fm10h: { min: 10, max: 18 },
    fm100h: { min: 14, max: 25 },
    fmLiveHerb: { min: 80, max: 220 },
    fmLiveWoody: { min: 90, max: 220 },
    maxFlameLengthFt: 8,
    maxRosChHr: 15,
    maxFirelineIntensity: 500,
    daysSinceWettingRain: { min: 1, max: 12 },
  },
  SB: {
    tempF: { min: 35, max: 70 },
    rh: { min: 30, max: 60 },
    midflameWindMph: { min: 1, max: 6 },
    transportWindMph: { min: 9, max: 20 },
    mixingHeightFt: { min: 1700 },
    ventilationIndex: { min: 5000 },
    fm1h: { min: 10, max: 18 },
    fm10h: { min: 12, max: 22 },
    fm100h: { min: 16, max: 28 },
    fmLiveHerb: { min: 60, max: 250 },
    fmLiveWoody: { min: 80, max: 250 },
    maxFlameLengthFt: 6,
    maxRosChHr: 8,
    maxFirelineIntensity: 200,
    daysSinceWettingRain: { min: 2, max: 14 },
  },
  NB: {
    tempF: { min: -100, max: 1000 },
    rh: { min: 0, max: 100 },
    midflameWindMph: { min: 0, max: 1000 },
    transportWindMph: { min: 0, max: 1000 },
    mixingHeightFt: { min: 0 },
    ventilationIndex: { min: 0 },
    fm1h: { min: 0, max: 1000 },
    fm10h: { min: 0, max: 1000 },
    fm100h: { min: 0, max: 1000 },
    fmLiveHerb: { min: 0, max: 1000 },
    fmLiveWoody: { min: 0, max: 1000 },
    maxFlameLengthFt: 0,
    maxRosChHr: 0,
    maxFirelineIntensity: 0,
    daysSinceWettingRain: { min: 0, max: 999 },
  },
};

export function defaultPrescription(fm: FuelModel): PrescriptionWindow {
  return { fuelModelCode: fm.code, ...DEFAULT_BY_GROUP[fm.group] };
}

function inRange(v: number, r: Range): boolean {
  return v >= r.min && v <= r.max;
}

export function checkPrescription(
  c: RxConditions,
  w: PrescriptionWindow,
): PrescriptionResult {
  const violations: string[] = [];
  const warnings: string[] = [];

  if (!inRange(c.tempF, w.tempF))
    violations.push(`Temp ${c.tempF.toFixed(0)}°F outside ${w.tempF.min}–${w.tempF.max}°F`);
  if (!inRange(c.rh, w.rh))
    violations.push(`RH ${c.rh.toFixed(0)}% outside ${w.rh.min}–${w.rh.max}%`);
  if (!inRange(c.midflameWindMph, w.midflameWindMph))
    violations.push(
      `Mid-flame wind ${c.midflameWindMph.toFixed(1)} mph outside ${w.midflameWindMph.min}–${w.midflameWindMph.max} mph`,
    );

  const fm1h_pct = c.fm.dead1h * 100;
  const fm10h_pct = c.fm.dead10h * 100;
  const fm100h_pct = c.fm.dead100h * 100;
  const fmLh_pct = c.fm.liveHerb * 100;
  const fmLw_pct = c.fm.liveWoody * 100;

  if (!inRange(fm1h_pct, w.fm1h))
    violations.push(`1-hr FM ${fm1h_pct.toFixed(0)}% outside ${w.fm1h.min}–${w.fm1h.max}%`);
  if (!inRange(fm10h_pct, w.fm10h))
    violations.push(`10-hr FM ${fm10h_pct.toFixed(0)}% outside ${w.fm10h.min}–${w.fm10h.max}%`);
  if (!inRange(fm100h_pct, w.fm100h))
    violations.push(`100-hr FM ${fm100h_pct.toFixed(0)}% outside ${w.fm100h.min}–${w.fm100h.max}%`);
  if (!inRange(fmLh_pct, w.fmLiveHerb))
    warnings.push(`Live herb FM ${fmLh_pct.toFixed(0)}% outside ${w.fmLiveHerb.min}–${w.fmLiveHerb.max}%`);
  if (!inRange(fmLw_pct, w.fmLiveWoody))
    warnings.push(`Live woody FM ${fmLw_pct.toFixed(0)}% outside ${w.fmLiveWoody.min}–${w.fmLiveWoody.max}%`);

  if (c.behavior.flameLength > w.maxFlameLengthFt)
    violations.push(
      `Predicted flame length ${c.behavior.flameLength.toFixed(1)} ft exceeds max ${w.maxFlameLengthFt} ft`,
    );
  if (c.rosChHr > w.maxRosChHr)
    violations.push(
      `Predicted ROS ${c.rosChHr.toFixed(1)} ch/hr exceeds max ${w.maxRosChHr} ch/hr`,
    );
  if (c.behavior.firelineIntensity > w.maxFirelineIntensity)
    violations.push(
      `Fireline intensity ${c.behavior.firelineIntensity.toFixed(0)} BTU/ft/s exceeds max ${w.maxFirelineIntensity}`,
    );

  // Smoke / dispersion (warnings, not blockers — dispatcher confirms).
  if (c.mixingHeightFt < w.mixingHeightFt.min)
    warnings.push(
      `Mixing height ${c.mixingHeightFt.toFixed(0)} ft below floor ${w.mixingHeightFt.min} ft (smoke management risk)`,
    );
  if (c.transportWindMph < w.transportWindMph.min || c.transportWindMph > w.transportWindMph.max)
    warnings.push(
      `Transport wind ${c.transportWindMph.toFixed(1)} mph outside ${w.transportWindMph.min}–${w.transportWindMph.max} mph`,
    );
  if (c.ventilationIndex < w.ventilationIndex.min)
    warnings.push(
      `Ventilation index ${c.ventilationIndex.toFixed(0)} below floor ${w.ventilationIndex.min}`,
    );
  if (!inRange(c.daysSinceRain, w.daysSinceWettingRain))
    warnings.push(
      `Days since wetting rain ${c.daysSinceRain} outside ${w.daysSinceWettingRain.min}–${w.daysSinceWettingRain.max}`,
    );

  return {
    inWindow: violations.length === 0,
    violations,
    warnings,
  };
}
