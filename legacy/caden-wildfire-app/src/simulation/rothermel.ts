// Rothermel (1972) surface fire spread model with Albini (1976) extensions.
// All inputs/outputs documented in the canonical units used by NWCG / BehavePlus.
//
// References:
//   Rothermel, R.C. 1972. A mathematical model for predicting fire spread in
//     wildland fuels. USDA-FS Research Paper INT-115.
//   Albini, F.A. 1976. Estimating wildfire behavior and effects. INT-GTR-30.
//   Andrews, P.L. 2018. The Rothermel surface fire spread model and associated
//     developments: A comprehensive explanation. RMRS-GTR-371.

export interface FuelMoisture {
  // All as fractions (e.g., 0.08 for 8%).
  dead1h: number;
  dead10h: number;
  dead100h: number;
  liveHerb: number;
  liveWoody: number;
}

export interface FuelModel {
  code: string;
  name: string;
  group: "GR" | "GS" | "SH" | "TL" | "TU" | "SB" | "NB";
  // Oven-dry fuel loads, lb/ft^2.
  w0_d1: number;
  w0_d10: number;
  w0_d100: number;
  w0_lh: number;
  w0_lw: number;
  // Surface-area-to-volume ratios, 1/ft.
  sav_d1: number;
  sav_lh: number;
  sav_lw: number;
  depth: number;       // fuel bed depth, ft
  Mx_dead: number;     // dead-fuel moisture of extinction, fraction
  heatDead: number;    // BTU/lb
  heatLive: number;    // BTU/lb
  burnable: boolean;
}

export interface FireBehavior {
  ros: number;                // heading rate of spread, ft/min
  rosBacking: number;         // ft/min
  rosFlanking: number;        // ft/min
  flameLength: number;        // ft (Byram)
  firelineIntensity: number;  // BTU/ft/s (Byram)
  reactionIntensity: number;  // BTU/ft^2/min
  heatPerUnitArea: number;    // BTU/ft^2
  effectiveWindMph: number;
  windFactor: number;         // phi_w
  slopeFactor: number;        // phi_s
  lengthToWidth: number;      // fire ellipse L/W
  // True if there's a non-trivial live fuel load contributing.
  hasLiveFuel: boolean;
}

const SAV_D10 = 109;   // 1/ft, fixed for 10-hr dead
const SAV_D100 = 30;   // 1/ft, fixed for 100-hr dead
const RHO_P = 32;      // lb/ft^3, oven-dry particle density
const ST = 0.0555;     // total mineral content
const SE = 0.01;       // effective silica-free mineral content

export const ZERO_BEHAVIOR: FireBehavior = {
  ros: 0,
  rosBacking: 0,
  rosFlanking: 0,
  flameLength: 0,
  firelineIntensity: 0,
  reactionIntensity: 0,
  heatPerUnitArea: 0,
  effectiveWindMph: 0,
  windFactor: 0,
  slopeFactor: 0,
  lengthToWidth: 1,
  hasLiveFuel: false,
};

function moistureDamping(M_f: number, M_x: number): number {
  if (M_x <= 0) return 0;
  const r = Math.min(1, M_f / M_x);
  return Math.max(0, 1 - 2.59 * r + 5.11 * r * r - 3.52 * r * r * r);
}

function heatOfPreignition(M_f: number): number {
  return 250 + 1116 * M_f;
}

export function computeFireBehavior(
  fm: FuelModel,
  M: FuelMoisture,
  midflameWindMph: number,
  slopePct: number,
): FireBehavior {
  if (!fm.burnable) return ZERO_BEHAVIOR;

  const U_ftmin = Math.max(0, midflameWindMph) * 88; // mph -> ft/min
  const slope = Math.max(0, slopePct) / 100;

  // Surface area per class (A_i = sigma_i * w_i / rho_p).
  const A_d1 = (fm.sav_d1 * fm.w0_d1) / RHO_P;
  const A_d10 = (SAV_D10 * fm.w0_d10) / RHO_P;
  const A_d100 = (SAV_D100 * fm.w0_d100) / RHO_P;
  const A_lh = (fm.sav_lh * fm.w0_lh) / RHO_P;
  const A_lw = (fm.sav_lw * fm.w0_lw) / RHO_P;

  const A_dead = A_d1 + A_d10 + A_d100;
  const A_live = A_lh + A_lw;
  const A_total = A_dead + A_live;
  if (A_total <= 0) return ZERO_BEHAVIOR;

  const f_d1 = A_dead > 0 ? A_d1 / A_dead : 0;
  const f_d10 = A_dead > 0 ? A_d10 / A_dead : 0;
  const f_d100 = A_dead > 0 ? A_d100 / A_dead : 0;
  const f_lh = A_live > 0 ? A_lh / A_live : 0;
  const f_lw = A_live > 0 ? A_lw / A_live : 0;
  const f_dead = A_dead / A_total;
  const f_live = A_live / A_total;

  // Characteristic SAV.
  const sigma_dead = f_d1 * fm.sav_d1 + f_d10 * SAV_D10 + f_d100 * SAV_D100;
  const sigma_live = f_lh * fm.sav_lh + f_lw * fm.sav_lw;
  const sigma = f_dead * sigma_dead + f_live * sigma_live;
  if (sigma <= 0) return ZERO_BEHAVIOR;

  // Net (mineral-free) loads weighted within category.
  const wn_dead =
    f_d1 * fm.w0_d1 * (1 - ST) +
    f_d10 * fm.w0_d10 * (1 - ST) +
    f_d100 * fm.w0_d100 * (1 - ST);
  const wn_live = f_lh * fm.w0_lh * (1 - ST) + f_lw * fm.w0_lw * (1 - ST);

  // Bulk density and packing ratios.
  const w0_total =
    fm.w0_d1 + fm.w0_d10 + fm.w0_d100 + fm.w0_lh + fm.w0_lw;
  const rho_b = w0_total / fm.depth;
  const beta = rho_b / RHO_P;
  const beta_op = 3.348 * Math.pow(sigma, -0.8189);
  const betaRatio = beta_op > 0 ? beta / beta_op : 0;

  // Live moisture of extinction (Albini 1976).
  const Wd =
    fm.w0_d1 * Math.exp(-138 / fm.sav_d1) +
    fm.w0_d10 * Math.exp(-138 / SAV_D10) +
    fm.w0_d100 * Math.exp(-138 / SAV_D100);
  const Wl =
    (fm.w0_lh > 0 ? fm.w0_lh * Math.exp(-500 / fm.sav_lh) : 0) +
    (fm.w0_lw > 0 ? fm.w0_lw * Math.exp(-500 / fm.sav_lw) : 0);
  const Wprime = Wl > 0 ? Wd / Wl : 0;

  const Md = f_d1 * M.dead1h + f_d10 * M.dead10h + f_d100 * M.dead100h;
  let Mx_live = 0;
  if (Wl > 0) {
    Mx_live = Math.max(
      fm.Mx_dead,
      2.9 * Wprime * (1 - Md / Math.max(fm.Mx_dead, 1e-6)) - 0.226,
    );
  }

  const M_live = f_lh * M.liveHerb + f_lw * M.liveWoody;
  const eta_M_dead = moistureDamping(Md, fm.Mx_dead);
  const eta_M_live = Mx_live > 0 ? moistureDamping(M_live, Mx_live) : 0;
  const eta_s = Math.min(1, 0.174 * Math.pow(SE, -0.19));

  // Reaction velocity.
  const sigma15 = Math.pow(sigma, 1.5);
  const Gamma_max = sigma15 / (495 + 0.0594 * sigma15);
  const A_exp = 133 * Math.pow(sigma, -0.7913);
  const Gamma =
    betaRatio > 0
      ? Gamma_max *
        Math.pow(betaRatio, A_exp) *
        Math.exp(A_exp * (1 - betaRatio))
      : 0;

  // Reaction intensity.
  const I_R_dead = Gamma * wn_dead * fm.heatDead * eta_M_dead * eta_s;
  const I_R_live = Gamma * wn_live * fm.heatLive * eta_M_live * eta_s;
  const I_R = Math.max(0, I_R_dead + I_R_live);

  // Propagating flux ratio.
  const xi =
    Math.exp((0.792 + 0.681 * Math.sqrt(sigma)) * (beta + 0.1)) /
    (192 + 0.2595 * sigma);

  // Wind factor.
  const C = 7.47 * Math.exp(-0.133 * Math.pow(sigma, 0.55));
  const B_w = 0.02526 * Math.pow(sigma, 0.54);
  const E = 0.715 * Math.exp(-3.59e-4 * sigma);
  const phi_w =
    U_ftmin > 0 && betaRatio > 0
      ? C * Math.pow(U_ftmin, B_w) * Math.pow(betaRatio, -E)
      : 0;

  // Slope factor.
  const phi_s = slope > 0 ? 5.275 * Math.pow(beta, -0.3) * slope * slope : 0;

  // Heat sink.
  const eps_d1 = Math.exp(-138 / fm.sav_d1);
  const eps_d10 = Math.exp(-138 / SAV_D10);
  const eps_d100 = Math.exp(-138 / SAV_D100);
  const eps_lh = fm.sav_lh > 0 ? Math.exp(-138 / fm.sav_lh) : 0;
  const eps_lw = fm.sav_lw > 0 ? Math.exp(-138 / fm.sav_lw) : 0;

  const heatSinkDead =
    f_dead *
    (f_d1 * eps_d1 * heatOfPreignition(M.dead1h) +
      f_d10 * eps_d10 * heatOfPreignition(M.dead10h) +
      f_d100 * eps_d100 * heatOfPreignition(M.dead100h));
  const heatSinkLive =
    f_live *
    (f_lh * eps_lh * heatOfPreignition(M.liveHerb) +
      f_lw * eps_lw * heatOfPreignition(M.liveWoody));
  const heatSink = rho_b * (heatSinkDead + heatSinkLive);

  let R = 0;
  if (heatSink > 0) {
    R = (I_R * xi * (1 + phi_w + phi_s)) / heatSink;
  }
  R = Math.max(0, R);

  // Effective wind speed (back-solve Rothermel wind eqn from total phi).
  const phi_total = phi_w + phi_s;
  const effectiveWindFtMin =
    phi_total > 0 && betaRatio > 0
      ? Math.pow((phi_total * Math.pow(betaRatio, E)) / C, 1 / B_w)
      : 0;
  const effectiveWindMph = effectiveWindFtMin / 88;

  // Residence time, heat per unit area, Byram intensity, flame length.
  const t_R = sigma > 0 ? 384 / sigma : 0;
  const HPA = I_R * t_R;
  const I_byram = (HPA * R) / 60;
  const flameLength = I_byram > 0 ? 0.45 * Math.pow(I_byram, 0.46) : 0;

  // Fire ellipse length-to-width (Anderson 1983).
  const LW = 1 + 0.25 * effectiveWindMph;
  const eccentricity = LW > 1 ? Math.sqrt(1 - 1 / (LW * LW)) : 0;
  const rosBacking = R * ((1 - eccentricity) / (1 + eccentricity));
  const rosFlanking = LW > 0 ? R / LW : R;

  return {
    ros: R,
    rosBacking,
    rosFlanking,
    flameLength,
    firelineIntensity: I_byram,
    reactionIntensity: I_R,
    heatPerUnitArea: HPA,
    effectiveWindMph,
    windFactor: phi_w,
    slopeFactor: phi_s,
    lengthToWidth: LW,
    hasLiveFuel: A_live > 0,
  };
}

// Directional ROS via elliptical fire-shape model (Anderson 1983).
// theta is the angle between the heading direction and the spread direction (rad).
export function rosAtAngle(b: FireBehavior, theta: number): number {
  if (b.ros <= 0) return 0;
  const LW = Math.max(1.0001, b.lengthToWidth);
  const e = Math.sqrt(1 - 1 / (LW * LW));
  return (b.ros * (1 - e)) / (1 - e * Math.cos(theta));
}

// Convenience conversions.
export const FT_MIN_TO_CH_HR = 60 / 66; // 1 chain = 66 ft
export const FT_MIN_TO_M_S = 0.00508;

export function rosChHr(rosFtMin: number): number {
  return rosFtMin * FT_MIN_TO_CH_HR;
}
