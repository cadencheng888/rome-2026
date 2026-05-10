// Scott & Burgan (2005) Fire Behavior Fuel Models — working subset.
// Source values from RMRS-GTR-153, Standard Fire Behavior Fuel Models.
// Loads stored as lb/ft^2 (1 ton/ac = 0.04591 lb/ft^2).
// SAV in 1/ft. Depth in ft. Mx_dead as fraction.

import type { FuelModel } from "./rothermel";

const T_AC_TO_LB_FT2 = 0.04591;
const t = (tonsAc: number) => tonsAc * T_AC_TO_LB_FT2;

export const FUEL_MODELS: Record<string, FuelModel> = {
  GR1: {
    code: "GR1",
    name: "Short, sparse, dry climate grass",
    group: "GR",
    w0_d1: t(0.10),
    w0_d10: 0,
    w0_d100: 0,
    w0_lh: t(0.30),
    w0_lw: 0,
    sav_d1: 2200,
    sav_lh: 2000,
    sav_lw: 0,
    depth: 0.4,
    Mx_dead: 0.15,
    heatDead: 8000,
    heatLive: 8000,
    burnable: true,
  },
  GR2: {
    code: "GR2",
    name: "Low load, dry climate grass",
    group: "GR",
    w0_d1: t(0.10),
    w0_d10: 0,
    w0_d100: 0,
    w0_lh: t(1.0),
    w0_lw: 0,
    sav_d1: 2000,
    sav_lh: 1800,
    sav_lw: 0,
    depth: 1.0,
    Mx_dead: 0.15,
    heatDead: 8000,
    heatLive: 8000,
    burnable: true,
  },
  GS2: {
    code: "GS2",
    name: "Moderate load, dry climate grass-shrub",
    group: "GS",
    w0_d1: t(0.5),
    w0_d10: t(0.5),
    w0_d100: 0,
    w0_lh: t(0.6),
    w0_lw: t(1.0),
    sav_d1: 2000,
    sav_lh: 1800,
    sav_lw: 1600,
    depth: 1.5,
    Mx_dead: 0.15,
    heatDead: 8000,
    heatLive: 8000,
    burnable: true,
  },
  SH5: {
    code: "SH5",
    name: "High load, dry climate shrub",
    group: "SH",
    w0_d1: t(3.6),
    w0_d10: t(2.1),
    w0_d100: 0,
    w0_lh: 0,
    w0_lw: t(2.9),
    sav_d1: 750,
    sav_lh: 0,
    sav_lw: 1600,
    depth: 6.0,
    Mx_dead: 0.15,
    heatDead: 8000,
    heatLive: 8000,
    burnable: true,
  },
  TL3: {
    code: "TL3",
    name: "Moderate load conifer litter",
    group: "TL",
    w0_d1: t(0.5),
    w0_d10: t(2.2),
    w0_d100: t(2.8),
    w0_lh: 0,
    w0_lw: 0,
    sav_d1: 2000,
    sav_lh: 0,
    sav_lw: 0,
    depth: 0.3,
    Mx_dead: 0.20,
    heatDead: 8000,
    heatLive: 8000,
    burnable: true,
  },
  TU5: {
    code: "TU5",
    name: "Very high load, dry climate timber-shrub",
    group: "TU",
    w0_d1: t(4.0),
    w0_d10: t(4.0),
    w0_d100: t(3.0),
    w0_lh: 0,
    w0_lw: t(3.0),
    sav_d1: 1500,
    sav_lh: 0,
    sav_lw: 750,
    depth: 1.0,
    Mx_dead: 0.25,
    heatDead: 8000,
    heatLive: 8000,
    burnable: true,
  },
  SB1: {
    code: "SB1",
    name: "Low load activity fuel / slash-blowdown",
    group: "SB",
    w0_d1: t(1.5),
    w0_d10: t(3.0),
    w0_d100: t(11.0),
    w0_lh: 0,
    w0_lw: 0,
    sav_d1: 2000,
    sav_lh: 0,
    sav_lw: 0,
    depth: 1.0,
    Mx_dead: 0.25,
    heatDead: 8000,
    heatLive: 8000,
    burnable: true,
  },
  NB1: {
    code: "NB1",
    name: "Urban / developed (non-burnable)",
    group: "NB",
    w0_d1: 0,
    w0_d10: 0,
    w0_d100: 0,
    w0_lh: 0,
    w0_lw: 0,
    sav_d1: 0,
    sav_lh: 0,
    sav_lw: 0,
    depth: 0.1,
    Mx_dead: 0,
    heatDead: 0,
    heatLive: 0,
    burnable: false,
  },
};

export const FUEL_MODEL_ORDER: Array<keyof typeof FUEL_MODELS> = [
  "GR1",
  "GR2",
  "GS2",
  "SH5",
  "TL3",
  "TU5",
  "SB1",
  "NB1",
];

export function getFuelModel(code: string): FuelModel {
  return FUEL_MODELS[code] ?? FUEL_MODELS.TL3;
}

// Default fuel moistures keyed to a fuel model — neutral baseline (D1L2).
export function defaultMoisture(): {
  dead1h: number;
  dead10h: number;
  dead100h: number;
  liveHerb: number;
  liveWoody: number;
} {
  return {
    dead1h: 0.08,
    dead10h: 0.09,
    dead100h: 0.11,
    liveHerb: 0.75,
    liveWoody: 0.90,
  };
}
