// PMS 484 Burn Plan template generator.
// Produces a structured object reflecting the 21 elements in NWCG PMS 484
// (Interagency Prescribed Fire Planning and Implementation Procedures Guide,
// most recent edition). Fields the app cannot derive from sim state are
// marked TBD and must be completed by the qualified Burn Boss before the
// plan is approvable.

import type { FireBehavior, FuelMoisture, FuelModel } from "./rothermel";
import type { PrescriptionWindow, PrescriptionResult } from "./prescription";

export interface BurnPlanInput {
  locationName: string;
  fuelModel: FuelModel;
  moisture: FuelMoisture;
  prescription: PrescriptionWindow;
  behavior: FireBehavior;
  rosChHr: number;
  rxResult: PrescriptionResult;
  tempF: number;
  rh: number;
  midflameWindMph: number;
  windDirCardinal: string;
  slopePct: number;
  area_ac: number;
  preparedBy: string;
}

export interface BurnPlanElement {
  number: number;
  title: string;
  body: string;
  status: "DERIVED" | "TBD" | "REVIEW";
}

export interface BurnPlan {
  title: string;
  generatedAt: string;
  elements: BurnPlanElement[];
}

export function buildBurnPlan(i: BurnPlanInput): BurnPlan {
  const fm = i.fuelModel;
  const w = i.prescription;
  const b = i.behavior;
  const m = i.moisture;
  const pct = (x: number) => `${(x * 100).toFixed(0)}%`;

  const elements: BurnPlanElement[] = [
    {
      number: 1,
      title: "Signature Page",
      status: "TBD",
      body: [
        `Prepared by:    ${i.preparedBy}`,
        `Reviewed by:    [Agency Fire Mgmt Officer]`,
        `Approved by:    [Line Officer]`,
        `Burn Boss (RXB): [Qualified per PMS 310-1]`,
      ].join("\n"),
    },
    {
      number: 2,
      title: "Go / No-Go Pre-Ignition Checklist (PMS 484-1)",
      status: i.rxResult.inWindow ? "DERIVED" : "REVIEW",
      body: [
        `Window status: ${i.rxResult.inWindow ? "GO (all prescription parameters in window)" : "NO-GO"}`,
        i.rxResult.violations.length
          ? "Violations:\n  - " + i.rxResult.violations.join("\n  - ")
          : "Violations: none",
        i.rxResult.warnings.length
          ? "Warnings (review):\n  - " + i.rxResult.warnings.join("\n  - ")
          : "Warnings: none",
        "Required confirmations (Burn Boss): briefing complete, holding resources committed, contingency resources identified, smoke clearance received, agency duty officer notified, public notifications issued.",
      ].join("\n"),
    },
    {
      number: 3,
      title: "Complexity Analysis Summary (PMS 424-1 RPFCRS)",
      status: "TBD",
      body: "Use Rx Fire Complexity Rating System worksheet (PMS 424-1). The system flame-length output is " + b.flameLength.toFixed(1) + " ft and ROS " + i.rosChHr.toFixed(1) + " ch/hr — these inform but do not determine complexity rating.",
    },
    {
      number: 4,
      title: "Description of the Prescribed Fire Area",
      status: "REVIEW",
      body: [
        `Location:           ${i.locationName}`,
        `Estimated unit size: ${i.area_ac.toFixed(0)} ac`,
        `Dominant fuel model: ${fm.code} — ${fm.name}`,
        `Mean slope:         ${i.slopePct.toFixed(0)}%`,
        `Boundaries, access, hazards: TBD (attach map)`,
      ].join("\n"),
    },
    {
      number: 5,
      title: "Goals and Objectives",
      status: "TBD",
      body: "State measurable resource and fuel objectives (e.g., ≥70% surface fuel consumption, ≤10% mortality of overstory trees ≥10\" DBH, retain 50–70% live shrub crowns).",
    },
    {
      number: 6,
      title: "Funding",
      status: "TBD",
      body: "Project code, FY funding source, cost estimate, post-burn rehab funding.",
    },
    {
      number: 7,
      title: "Prescription",
      status: "DERIVED",
      body: [
        `Fuel model:           ${fm.code}`,
        `Air temperature:      ${w.tempF.min}–${w.tempF.max} °F`,
        `Relative humidity:    ${w.rh.min}–${w.rh.max}%`,
        `Mid-flame wind:       ${w.midflameWindMph.min}–${w.midflameWindMph.max} mph`,
        `Transport wind:       ${w.transportWindMph.min}–${w.transportWindMph.max} mph`,
        `Mixing height (min):  ${w.mixingHeightFt.min} ft`,
        `Ventilation index:    ≥ ${w.ventilationIndex.min}`,
        `1-hr fuel moisture:   ${w.fm1h.min}–${w.fm1h.max}%`,
        `10-hr fuel moisture:  ${w.fm10h.min}–${w.fm10h.max}%`,
        `100-hr fuel moisture: ${w.fm100h.min}–${w.fm100h.max}%`,
        `Live herb FM:         ${w.fmLiveHerb.min}–${w.fmLiveHerb.max}%`,
        `Live woody FM:        ${w.fmLiveWoody.min}–${w.fmLiveWoody.max}%`,
        `Max flame length:     ${w.maxFlameLengthFt} ft`,
        `Max ROS:              ${w.maxRosChHr} ch/hr`,
        `Max fireline int.:    ${w.maxFirelineIntensity} BTU/ft/s`,
        `Days since wetting rain: ${w.daysSinceWettingRain.min}–${w.daysSinceWettingRain.max}`,
      ].join("\n"),
    },
    {
      number: 8,
      title: "Scheduling",
      status: "TBD",
      body: "Window of dates, time of day, season constraints, NEPA/CEQA clearance status.",
    },
    {
      number: 9,
      title: "Pre-Burn Considerations and Weather",
      status: "DERIVED",
      body: [
        `Current observed conditions:`,
        `  Temperature:   ${i.tempF.toFixed(0)} °F`,
        `  RH:            ${i.rh.toFixed(0)}%`,
        `  Mid-flame wind: ${i.midflameWindMph.toFixed(1)} mph from ${i.windDirCardinal}`,
        `  1-hr/10-hr/100-hr FM: ${pct(m.dead1h)} / ${pct(m.dead10h)} / ${pct(m.dead100h)}`,
        `  Live herb / live woody FM: ${pct(m.liveHerb)} / ${pct(m.liveWoody)}`,
        `Spot weather forecast required ≤ 24 hr before ignition (NWS-FX-spot).`,
      ].join("\n"),
    },
    {
      number: 10,
      title: "Briefing",
      status: "TBD",
      body: "Use NWCG IRPG briefing checklist. Cover assignments, hazards, weather, frequencies, medivac, escaped-fire procedure.",
    },
    {
      number: 11,
      title: "Organization and Equipment",
      status: "TBD",
      body: "List positions and minimum qualifications (RXB, FIRB, ENGB, FFT2, etc.) and assigned engines/handcrews/aircraft. Verify all qualified per PMS 310-1.",
    },
    {
      number: 12,
      title: "Communications",
      status: "TBD",
      body: "Frequencies (command, tactical, air), repeaters, dispatch contact, cell coverage gaps.",
    },
    {
      number: 13,
      title: "Public and Personnel Safety, Medical",
      status: "TBD",
      body: "JHA, medivac plan, nearest trauma center, escape routes and safety zones (LCES), public closure plan.",
    },
    {
      number: 14,
      title: "Test Fire",
      status: "DERIVED",
      body: [
        `Test fire area: ≥ 0.1 ac in representative fuels.`,
        `Predicted heading ROS: ${i.rosChHr.toFixed(1)} ch/hr`,
        `Predicted heading flame length: ${b.flameLength.toFixed(1)} ft`,
        `Predicted backing ROS: ${(b.rosBacking * (60 / 66)).toFixed(1)} ch/hr`,
        `If observed behavior exceeds prescription max, abort and document.`,
      ].join("\n"),
    },
    {
      number: 15,
      title: "Ignition Plan",
      status: "TBD",
      body: "Ignition sequence (backing, flanking, strip-head, ring, chevron, aerial PSD), spacing, timing, direction relative to wind/slope, holding contingencies.",
    },
    {
      number: 16,
      title: "Holding Plan",
      status: "TBD",
      body: "Control lines (existing roads, hand line, dozer line, wet line), assigned holders, water supply, pump/hose layout, mop-up depth.",
    },
    {
      number: 17,
      title: "Contingency Plan",
      status: "TBD",
      body: "Trigger points (predicted/observed conditions that trigger additional resources), pre-identified contingency resources and ETA, evacuation triggers for sensitive receptors.",
    },
    {
      number: 18,
      title: "Wildfire Conversion",
      status: "TBD",
      body: "Procedure if Rx fire is declared a wildfire: WFDSS entry, IC qualifications, transition briefing, cause investigation.",
    },
    {
      number: 19,
      title: "Smoke Management",
      status: "REVIEW",
      body: [
        `State Smoke Management Program coordination required (Clean Air Act §169A; state SIP).`,
        `Predicted heat per unit area: ${b.heatPerUnitArea.toFixed(0)} BTU/ft²`,
        `Predicted reaction intensity: ${b.reactionIntensity.toFixed(0)} BTU/ft²/min`,
        `Required: PM2.5 emissions estimate (FOFEM/CONSUME), HYSPLIT or VSMOKE dispersion run, sensitive receptor analysis (schools, hospitals, Class I airsheds), public notification.`,
        `Mixing height floor: ${w.mixingHeightFt.min} ft. Ventilation index floor: ${w.ventilationIndex.min}.`,
      ].join("\n"),
    },
    {
      number: 20,
      title: "Monitoring",
      status: "TBD",
      body: "Fire behavior observations (FBAN/IMET), fuel consumption sampling, smoke monitoring (DataRAM/EBAM), post-burn vegetation plots tied to Element 5 objectives.",
    },
    {
      number: 21,
      title: "Post-Burn Activities",
      status: "TBD",
      body: "Mop-up standards, patrol schedule, declared-out criteria, after-action review (AAR), final report to agency administrator, lessons-learned upload.",
    },
  ];

  return {
    title: `PRESCRIBED FIRE BURN PLAN — ${i.locationName}`,
    generatedAt: new Date().toISOString(),
    elements,
  };
}

export function burnPlanToText(plan: BurnPlan): string {
  const parts: string[] = [];
  parts.push(plan.title);
  parts.push("=".repeat(plan.title.length));
  parts.push(`Generated: ${plan.generatedAt}`);
  parts.push(
    "NOTICE: This document is a planning template generated from current sim state. It is not an approved burn plan. Approval requires a qualified RXB, agency line-officer signature, NEPA/CEQA documentation, and state smoke-management clearance.",
  );
  parts.push("");
  for (const e of plan.elements) {
    parts.push(`${e.number}. ${e.title}    [${e.status}]`);
    parts.push("-".repeat(60));
    parts.push(e.body);
    parts.push("");
  }
  return parts.join("\n");
}
