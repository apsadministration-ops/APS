/**
 * Vehicle component specifications keyed by make/model/year range.
 * Used by the mechanic Vehicle Workbench's interactive component zones
 * (tires, windshield, suspension). Defaults from a curated baseline; the
 * mechanic can manually override via worklog notes if modifications are
 * detected.
 */

export interface TireSpec {
  front: string;
  rear: string;
  recommended: string;
  notes?: string;
}

export interface WiperSpec {
  driver: string;
  passenger: string;
  rear?: string;
  partNumbers?: string[];
}

export interface SuspensionSpec {
  cvAxle?: string;
  tieRod?: string;
  controlArm?: string;
  knownFailures?: string[];
}

export interface ComponentSpecs {
  source: "vin-database" | "model-default" | "generic";
  tires: TireSpec;
  wipers: WiperSpec;
  suspension: SuspensionSpec;
  notes?: string;
}

interface SpecRule {
  match: (v: { make: string; model: string; year: number }) => boolean;
  specs: ComponentSpecs;
}

const RULES: SpecRule[] = [
  {
    match: (v) => v.make.toLowerCase() === "subaru" && v.model.toLowerCase() === "outback" && v.year >= 2015 && v.year <= 2019,
    specs: {
      source: "vin-database",
      tires: { front: "225/65R17", rear: "225/65R17", recommended: "Michelin Defender LTX M/S or equivalent all-season touring", notes: "Symmetric AWD — rotate every 5,000 mi to keep tread depths within 2/32\"." },
      wipers: { driver: "26\" beam", passenger: "17\" beam", rear: "14\" rear", partNumbers: ["Bosch 26A", "Bosch 17A", "Bosch H354"] },
      suspension: {
        cvAxle: "GSP NCV23568 (front-left reman) / GSP NCV23569 (front-right) — 27 inner / 25 outer spline",
        tieRod: "Moog ES3493 inner / ES800551 outer — torque 35 ft-lb inner, 35 ft-lb outer + 1/4 turn",
        controlArm: "Lower control arm Moog RK622973 (L) / RK622974 (R) — bushings prone to wear at 80k+ mi",
        knownFailures: [
          "Front CV axle inner-joint wear (clicking on hard turns) — common at 75k-100k mi",
          "Lower control arm front bushings cracking — visible during alignment",
          "Wheel bearings on AWD models — listen for hum at 50+ mph",
        ],
      },
    },
  },
  {
    match: (v) => v.make.toLowerCase() === "honda" && v.model.toLowerCase() === "civic" && v.year >= 2016 && v.year <= 2021,
    specs: {
      source: "vin-database",
      tires: { front: "215/55R16 (LX/EX) or 235/40R18 (Sport/Si)", rear: "matches front", recommended: "Continental TrueContact Tour or Michelin Premier A/S" },
      wipers: { driver: "26\" beam", passenger: "21\" beam", partNumbers: ["Bosch 26A", "Bosch 21A"] },
      suspension: {
        cvAxle: "GSP NCV36537 (front-left)",
        tieRod: "Moog ES800951 outer",
        controlArm: "Front lower OEM 51350-TBA-A02 (L)",
        knownFailures: ["Sway bar end links (clunking on bumps)", "Compliance bushings at 100k+ mi"],
      },
    },
  },
  {
    match: (v) => v.make.toLowerCase() === "toyota" && v.model.toLowerCase() === "camry" && v.year >= 2018 && v.year <= 2024,
    specs: {
      source: "vin-database",
      tires: { front: "215/55R17 (LE/SE) or 235/40R19 (XSE)", rear: "matches front", recommended: "Bridgestone Turanza QuietTrack" },
      wipers: { driver: "26\" beam", passenger: "18\" beam", partNumbers: ["Bosch 26A", "Bosch 18A"] },
      suspension: {
        cvAxle: "GSP NCV69173 (front-left)",
        tieRod: "Moog ES800842 outer",
        controlArm: "Lower control arm w/ ball joint Moog RK641352 (L)",
        knownFailures: ["Strut mount bearing noise", "Front lower ball joints at 120k+ mi"],
      },
    },
  },
  {
    match: (v) => v.make.toLowerCase() === "ford" && v.model.toLowerCase() === "f-150" && v.year >= 2015 && v.year <= 2020,
    specs: {
      source: "vin-database",
      tires: { front: "265/70R17 or 275/65R18 (depending on trim)", rear: "matches front", recommended: "BFGoodrich All-Terrain T/A KO2 or Michelin LTX A/T2" },
      wipers: { driver: "22\" beam", passenger: "22\" beam", partNumbers: ["Motorcraft WW-2202-PF (pair)"] },
      suspension: {
        cvAxle: "n/a — 4x4 IFS uses Dana axle assembly",
        tieRod: "Moog DS1465 inner / ES80995 outer",
        controlArm: "Upper Moog RK620421 / Lower Moog RK622974",
        knownFailures: [
          "Front upper control arm ball joints — common at 80k+ mi",
          "Steering rack inner tie rod ends — clunk over bumps",
        ],
      },
    },
  },
];

const GENERIC_FALLBACK: ComponentSpecs = {
  source: "generic",
  tires: { front: "Refer to door-jamb placard for OE tire size", rear: "Refer to door-jamb placard for OE tire size", recommended: "Match speed rating + load index from placard. Use all-season touring unless customer specifies." },
  wipers: { driver: "Measure existing or look up in shop catalog", passenger: "Measure existing or look up in shop catalog" },
  suspension: { knownFailures: ["No model-specific failure data available — fall back to general inspection."] },
  notes: "No VIN-specific component data on file for this make/model/year. Defaulting to generic guidance.",
};

export function lookupComponentSpecs(vehicle: { make: string; model: string; year: number }): ComponentSpecs {
  for (const rule of RULES) {
    if (rule.match(vehicle)) return rule.specs;
  }
  return GENERIC_FALLBACK;
}
