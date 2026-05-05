export interface Obd2Code {
  code: string;
  description: string;
  system: string;
  severity: "low" | "medium" | "high" | "critical";
  canDrive: boolean;
  commonCauses: string[];
  repairSteps: string[];
  estimatedCost: { min: number; max: number };
  affectedSystems: string[];
}

const OBD2_DATABASE: Obd2Code[] = [
  // ───── FUEL SYSTEM ─────
  {
    code: "P0087",
    description: "Fuel Rail/System Pressure Too Low",
    system: "Fuel System",
    severity: "high",
    canDrive: false,
    commonCauses: ["Failing fuel pump", "Clogged fuel filter", "Faulty fuel pressure regulator", "Leaking fuel injector", "Kinked fuel line"],
    repairSteps: ["Check fuel pressure at rail with gauge (target 40–60 PSI)", "Inspect fuel filter — replace if >30k miles", "Test fuel pump flow rate and current draw", "Check fuel lines for kinks or damage", "Test fuel pressure regulator", "Inspect injectors for leaks"],
    estimatedCost: { min: 150, max: 650 },
    affectedSystems: ["Engine", "Fuel Delivery"],
  },
  {
    code: "P0088",
    description: "Fuel Rail/System Pressure Too High",
    system: "Fuel System",
    severity: "high",
    canDrive: false,
    commonCauses: ["Faulty fuel pressure regulator", "Stuck closed fuel return line", "Faulty fuel pressure sensor"],
    repairSteps: ["Measure fuel rail pressure", "Inspect fuel return line for blockage", "Test fuel pressure regulator", "Replace regulator if pressure exceeds spec by >10 PSI"],
    estimatedCost: { min: 100, max: 400 },
    affectedSystems: ["Engine", "Fuel Delivery"],
  },
  {
    code: "P0171",
    description: "System Too Lean (Bank 1)",
    system: "Fuel Trim",
    severity: "medium",
    canDrive: true,
    commonCauses: ["Vacuum leak", "Dirty or failing MAF sensor", "Clogged fuel injectors", "Low fuel pressure", "Faulty oxygen sensor", "PCV valve failure"],
    repairSteps: ["Check for vacuum leaks with smoke machine or carb cleaner", "Clean MAF sensor with MAF cleaner spray", "Check fuel pressure at idle and under load", "Inspect PCV valve and hose", "Test O2 sensor response with scan tool live data", "Clean or replace fuel injectors"],
    estimatedCost: { min: 50, max: 400 },
    affectedSystems: ["Engine", "Fuel Trim", "Emissions"],
  },
  {
    code: "P0172",
    description: "System Too Rich (Bank 1)",
    system: "Fuel Trim",
    severity: "medium",
    canDrive: true,
    commonCauses: ["Faulty oxygen sensor", "Leaking fuel injector", "High fuel pressure", "Faulty MAF sensor", "Engine oil contamination"],
    repairSteps: ["Read long-term and short-term fuel trim values", "Test O2 sensor response", "Check fuel pressure", "Inspect injectors for drip at key-off", "Clean MAF sensor", "Check for oil in intake (PCV)"],
    estimatedCost: { min: 80, max: 500 },
    affectedSystems: ["Engine", "Fuel Trim", "Emissions"],
  },
  {
    code: "P0174",
    description: "System Too Lean (Bank 2)",
    system: "Fuel Trim",
    severity: "medium",
    canDrive: true,
    commonCauses: ["Vacuum leak on Bank 2 side", "Dirty MAF sensor", "Low fuel pressure", "Faulty Bank 2 O2 sensor"],
    repairSteps: ["Identify Bank 2 cylinder side", "Check for vacuum leaks on Bank 2 intake", "Test MAF sensor readings", "Verify fuel pressure", "Test Bank 2 upstream O2 sensor"],
    estimatedCost: { min: 50, max: 400 },
    affectedSystems: ["Engine", "Fuel Trim"],
  },

  // ───── IGNITION / MISFIRE ─────
  {
    code: "P0300",
    description: "Random/Multiple Cylinder Misfire Detected",
    system: "Ignition",
    severity: "high",
    canDrive: false,
    commonCauses: ["Worn spark plugs", "Failing ignition coils", "Bad fuel injectors", "Low compression (worn rings/valves)", "Vacuum leak", "Low fuel pressure", "Faulty crankshaft position sensor"],
    repairSteps: ["Check spark plugs — inspect gap and electrode wear", "Pull ignition coil DTCs (P030x per cylinder)", "Swap coils between cylinders to see if misfire follows", "Perform compression test on all cylinders", "Check fuel injector pulse with noid light", "Inspect intake manifold for vacuum leaks"],
    estimatedCost: { min: 100, max: 1200 },
    affectedSystems: ["Engine", "Ignition", "Fuel"],
  },
  {
    code: "P0301",
    description: "Cylinder 1 Misfire Detected",
    system: "Ignition",
    severity: "high",
    canDrive: false,
    commonCauses: ["Fouled or worn spark plug #1", "Faulty ignition coil #1", "Clogged or leaking fuel injector #1", "Low compression in cylinder 1", "Burned exhaust valve"],
    repairSteps: ["Replace spark plug on cylinder 1", "Swap coil #1 to another cylinder — if misfire moves, replace coil", "Check compression on cylinder 1 (should be >150 PSI)", "Test injector #1 with noid light", "Perform leak-down test on cylinder 1"],
    estimatedCost: { min: 80, max: 600 },
    affectedSystems: ["Engine", "Ignition"],
  },
  {
    code: "P0302",
    description: "Cylinder 2 Misfire Detected",
    system: "Ignition",
    severity: "high",
    canDrive: false,
    commonCauses: ["Worn spark plug #2", "Faulty ignition coil #2", "Injector fault on cylinder 2"],
    repairSteps: ["Replace spark plug #2", "Swap ignition coil #2 to diagnose", "Compression test cylinder 2", "Test injector #2 pulse"],
    estimatedCost: { min: 80, max: 600 },
    affectedSystems: ["Engine", "Ignition"],
  },
  {
    code: "P0303",
    description: "Cylinder 3 Misfire Detected",
    system: "Ignition",
    severity: "high",
    canDrive: false,
    commonCauses: ["Worn spark plug #3", "Faulty ignition coil #3", "Injector fault cylinder 3"],
    repairSteps: ["Replace spark plug #3", "Swap coil #3", "Check compression", "Inspect injector #3"],
    estimatedCost: { min: 80, max: 600 },
    affectedSystems: ["Engine", "Ignition"],
  },
  {
    code: "P0304",
    description: "Cylinder 4 Misfire Detected",
    system: "Ignition",
    severity: "high",
    canDrive: false,
    commonCauses: ["Worn spark plug #4", "Faulty ignition coil #4", "Injector fault cylinder 4"],
    repairSteps: ["Replace spark plug #4", "Swap coil #4", "Check compression", "Inspect injector #4"],
    estimatedCost: { min: 80, max: 600 },
    affectedSystems: ["Engine", "Ignition"],
  },

  // ───── OXYGEN SENSORS ─────
  {
    code: "P0131",
    description: "O2 Sensor Circuit Low Voltage (Bank 1, Sensor 1)",
    system: "Emissions",
    severity: "medium",
    canDrive: true,
    commonCauses: ["Failed upstream O2 sensor", "Wiring short to ground", "Exhaust leak near sensor", "Contaminated sensor (oil/coolant)"],
    repairSteps: ["Check O2 sensor output voltage with scan tool (should oscillate 0.1–0.9V)", "Inspect wiring harness for shorts or damage", "Check for exhaust leaks upstream", "Replace O2 sensor Bank 1 Sensor 1 if voltage stays low"],
    estimatedCost: { min: 100, max: 350 },
    affectedSystems: ["Emissions", "Fuel Trim"],
  },
  {
    code: "P0135",
    description: "O2 Sensor Heater Circuit Malfunction (Bank 1, Sensor 1)",
    system: "Emissions",
    severity: "low",
    canDrive: true,
    commonCauses: ["Failed O2 sensor heater element", "Blown fuse", "Open circuit in heater wiring"],
    repairSteps: ["Check O2 sensor fuse", "Test heater circuit resistance (spec typically 5–20 ohms)", "Inspect wiring for damage", "Replace O2 sensor if heater circuit is open"],
    estimatedCost: { min: 100, max: 300 },
    affectedSystems: ["Emissions"],
  },

  // ───── CATALYTIC CONVERTER ─────
  {
    code: "P0420",
    description: "Catalyst System Efficiency Below Threshold (Bank 1)",
    system: "Emissions",
    severity: "medium",
    canDrive: true,
    commonCauses: ["Worn catalytic converter", "Oil burning contaminating cat", "Coolant leak into exhaust", "Rich-running engine damaging catalyst", "Faulty downstream O2 sensor"],
    repairSteps: ["Verify no misfire or rich condition codes first — fix those before cat replacement", "Compare upstream vs downstream O2 sensor waveforms (downstream should be steady)", "Check for coolant or oil leaks into combustion", "Inspect catalytic converter for physical damage (rattle = broken substrate)", "Replace catalytic converter if confirmed failed"],
    estimatedCost: { min: 400, max: 2200 },
    affectedSystems: ["Emissions", "Exhaust"],
  },
  {
    code: "P0430",
    description: "Catalyst System Efficiency Below Threshold (Bank 2)",
    system: "Emissions",
    severity: "medium",
    canDrive: true,
    commonCauses: ["Worn Bank 2 catalytic converter", "Rich condition on Bank 2", "Faulty Bank 2 downstream O2 sensor"],
    repairSteps: ["Check for Bank 2 specific codes first", "Compare Bank 2 O2 sensor waveforms", "Inspect Bank 2 catalytic converter", "Replace if efficiency is confirmed low"],
    estimatedCost: { min: 400, max: 2200 },
    affectedSystems: ["Emissions", "Exhaust"],
  },

  // ───── EVAP SYSTEM ─────
  {
    code: "P0440",
    description: "Evaporative Emission System Malfunction",
    system: "EVAP",
    severity: "low",
    canDrive: true,
    commonCauses: ["Loose or missing gas cap", "Cracked EVAP hose", "Faulty purge valve", "Faulty vent valve", "Leak in EVAP canister"],
    repairSteps: ["Tighten or replace gas cap", "Perform EVAP system smoke test", "Test purge solenoid with scan tool", "Inspect EVAP lines for cracks", "Check charcoal canister for saturation"],
    estimatedCost: { min: 20, max: 450 },
    affectedSystems: ["Emissions", "EVAP"],
  },
  {
    code: "P0442",
    description: "Evaporative Emission System — Small Leak Detected",
    system: "EVAP",
    severity: "low",
    canDrive: true,
    commonCauses: ["Loose gas cap", "Cracked EVAP line", "Faulty vent solenoid", "Deteriorated fuel cap O-ring"],
    repairSteps: ["Check and tighten gas cap — clear code and drive 2 drive cycles", "Replace gas cap if O-ring is cracked", "Smoke test EVAP system", "Inspect all EVAP hoses and connections"],
    estimatedCost: { min: 15, max: 300 },
    affectedSystems: ["Emissions", "EVAP"],
  },
  {
    code: "P0455",
    description: "Evaporative Emission System — Large Leak Detected",
    system: "EVAP",
    severity: "low",
    canDrive: true,
    commonCauses: ["Missing gas cap", "Cracked EVAP canister", "Disconnected EVAP hose", "Faulty purge or vent valve stuck open"],
    repairSteps: ["Check gas cap is installed and sealing", "Smoke test EVAP system", "Inspect large-diameter EVAP hoses", "Test purge valve — should close when de-energized", "Check vent valve solenoid"],
    estimatedCost: { min: 20, max: 600 },
    affectedSystems: ["Emissions", "EVAP"],
  },

  // ───── EGR SYSTEM ─────
  {
    code: "P0400",
    description: "Exhaust Gas Recirculation Flow Malfunction",
    system: "EGR",
    severity: "medium",
    canDrive: true,
    commonCauses: ["Carbon-clogged EGR valve", "Faulty EGR position sensor", "Vacuum line leak to EGR", "EGR passages clogged with carbon"],
    repairSteps: ["Remove EGR valve and inspect for heavy carbon buildup", "Clean EGR valve passages with carb cleaner and wire brush", "Test EGR valve operation with vacuum pump or scan tool", "Inspect EGR passages in intake manifold for blockage", "Replace EGR valve if stuck closed"],
    estimatedCost: { min: 100, max: 500 },
    affectedSystems: ["Emissions", "Engine"],
  },

  // ───── MASS AIR FLOW ─────
  {
    code: "P0100",
    description: "Mass Air Flow Circuit Malfunction",
    system: "Air Intake",
    severity: "medium",
    canDrive: false,
    commonCauses: ["Dirty or contaminated MAF sensor", "Air intake leak after MAF", "Wiring harness damage", "Failed MAF sensor"],
    repairSteps: ["Inspect air filter — replace if dirty", "Check air intake hose for cracks or loose connections between filter and throttle body", "Clean MAF sensor with MAF-safe cleaner spray (do not touch wire element)", "Inspect MAF wiring harness for damage", "Test MAF output voltage/Hz at idle vs under load", "Replace MAF sensor if faulty"],
    estimatedCost: { min: 80, max: 400 },
    affectedSystems: ["Engine", "Air Intake"],
  },

  // ───── THROTTLE / PEDAL ─────
  {
    code: "P0120",
    description: "Throttle/Pedal Position Sensor A Circuit Malfunction",
    system: "Electronic Throttle Control",
    severity: "high",
    canDrive: false,
    commonCauses: ["Faulty throttle position sensor (TPS)", "Wiring damage to TPS", "Carbon buildup on throttle body", "Faulty PCM/ECM"],
    repairSteps: ["Check TPS voltage with KOEO — should be 0.5V at closed throttle and ~4.5V at WOT", "Clean throttle body and plate with throttle body cleaner", "Inspect TPS wiring for shorts or opens", "Perform TPS relearn procedure after cleaning", "Replace TPS if voltage is erratic"],
    estimatedCost: { min: 100, max: 350 },
    affectedSystems: ["Engine", "Throttle Control"],
  },

  // ───── COOLANT TEMP ─────
  {
    code: "P0115",
    description: "Engine Coolant Temperature Circuit Malfunction",
    system: "Cooling",
    severity: "high",
    canDrive: false,
    commonCauses: ["Failed engine coolant temperature sensor (ECT)", "Wiring damage to ECT sensor", "Low coolant level", "Thermostat stuck open"],
    repairSteps: ["Check actual coolant temperature with infrared thermometer", "Verify ECT sensor resistance matches temperature chart", "Inspect wiring harness and connector for corrosion", "Check coolant level", "Replace ECT sensor if out of spec"],
    estimatedCost: { min: 80, max: 250 },
    affectedSystems: ["Cooling", "Engine"],
  },
  {
    code: "P0128",
    description: "Coolant Temperature Below Thermostat Regulating Temperature",
    system: "Cooling",
    severity: "medium",
    canDrive: true,
    commonCauses: ["Thermostat stuck open", "Faulty coolant temp sensor", "Defective thermostat housing"],
    repairSteps: ["Monitor ECT with scan tool at idle — should reach 195–220°F within 5 minutes", "If engine runs cold, thermostat is stuck open — replace thermostat and gasket", "Flush and refill coolant during thermostat replacement"],
    estimatedCost: { min: 80, max: 300 },
    affectedSystems: ["Cooling"],
  },

  // ───── CRANKSHAFT / CAMSHAFT ─────
  {
    code: "P0335",
    description: "Crankshaft Position Sensor A Circuit Malfunction",
    system: "Engine Timing",
    severity: "critical",
    canDrive: false,
    commonCauses: ["Failed crankshaft position sensor", "Damaged reluctor wheel", "Wiring harness damage near sensor", "Oil contamination of sensor"],
    repairSteps: ["Check for spark and injector pulse — if absent, CKP is suspect", "Locate CKP sensor (near crank pulley or transmission bell housing)", "Inspect sensor and tone ring for damage", "Test CKP sensor resistance (typically 200–900 ohms)", "Replace CKP sensor and rescan", "Check reluctor wheel for missing or damaged teeth"],
    estimatedCost: { min: 120, max: 400 },
    affectedSystems: ["Engine", "Ignition", "Fuel"],
  },
  {
    code: "P0340",
    description: "Camshaft Position Sensor A Circuit Malfunction (Bank 1)",
    system: "Engine Timing",
    severity: "high",
    canDrive: false,
    commonCauses: ["Failed camshaft position sensor", "Wiring damage", "Reluctor wheel damage", "Timing chain stretched/jumped"],
    repairSteps: ["Inspect CMP sensor and connector", "Test sensor signal with oscilloscope or scan tool", "Check timing chain for slack if sensor is good", "Replace CMP sensor if faulty", "If timing chain is stretched, replace timing chain kit"],
    estimatedCost: { min: 100, max: 800 },
    affectedSystems: ["Engine", "Timing"],
  },

  // ───── VARIABLE VALVE TIMING ─────
  {
    code: "P0011",
    description: "Camshaft Position A — Over-Advanced or System Performance (Bank 1)",
    system: "Variable Valve Timing",
    severity: "high",
    canDrive: false,
    commonCauses: ["Low engine oil level or pressure", "Dirty engine oil clogging VVT solenoid", "Faulty VVT solenoid", "Stuck VVT actuator (phaser)", "Stretched timing chain"],
    repairSteps: ["Check engine oil level and condition — change oil if overdue", "Clear code and test drive — dirty oil is the most common cause", "Test VVT solenoid resistance and duty cycle response", "Inspect VVT solenoid screen for debris", "Replace VVT solenoid if clogged or failed", "Check timing chain for stretch if solenoid is good"],
    estimatedCost: { min: 100, max: 1500 },
    affectedSystems: ["Engine", "Valve Timing"],
  },
  {
    code: "P0012",
    description: "Camshaft Position A — Over-Retarded (Bank 1)",
    system: "Variable Valve Timing",
    severity: "high",
    canDrive: false,
    commonCauses: ["Faulty VVT solenoid", "Low oil pressure", "Stretched timing chain", "Sludge buildup in oil passages"],
    repairSteps: ["Check oil level and quality first", "Test VVT solenoid operation", "Check oil pressure at idle and under load", "Replace VVT solenoid", "If problem persists, inspect timing chain and phaser"],
    estimatedCost: { min: 100, max: 1500 },
    affectedSystems: ["Engine", "Valve Timing"],
  },

  // ───── KNOCK / DETONATION ─────
  {
    code: "P0325",
    description: "Knock Sensor 1 Circuit Malfunction (Bank 1 or Single Sensor)",
    system: "Engine Control",
    severity: "medium",
    canDrive: true,
    commonCauses: ["Failed knock sensor", "Wiring harness damage", "Loose knock sensor mounting", "Engine detonation damage"],
    repairSteps: ["Check knock sensor wiring and connector for damage or corrosion", "Test knock sensor resistance (2-wire: ~5 MOhms; 1-wire: check to ground)", "Check sensor mounting torque (usually 15–20 ft-lbs)", "Replace knock sensor if resistance is out of spec"],
    estimatedCost: { min: 100, max: 450 },
    affectedSystems: ["Engine"],
  },

  // ───── TRANSMISSION ─────
  {
    code: "P0700",
    description: "Transmission Control System Malfunction",
    system: "Transmission",
    severity: "high",
    canDrive: false,
    commonCauses: ["Sub-codes present in TCM", "Low transmission fluid", "Faulty shift solenoid", "TCM wiring fault"],
    repairSteps: ["Scan for all codes — P0700 is a gateway code, look for P07xx sub-codes", "Check transmission fluid level and condition", "Service transmission if fluid is dark or burnt-smelling", "Address specific TCM sub-codes first"],
    estimatedCost: { min: 150, max: 2500 },
    affectedSystems: ["Transmission"],
  },
  {
    code: "P0730",
    description: "Incorrect Gear Ratio",
    system: "Transmission",
    severity: "high",
    canDrive: false,
    commonCauses: ["Worn clutch packs", "Faulty shift solenoid", "Low transmission fluid", "Torque converter slipping"],
    repairSteps: ["Check transmission fluid level and condition", "Scan for shift solenoid sub-codes", "Test shift solenoid operation with scan tool", "Perform line pressure test", "If clutch packs are worn, transmission rebuild may be needed"],
    estimatedCost: { min: 200, max: 3500 },
    affectedSystems: ["Transmission"],
  },
  {
    code: "P0741",
    description: "Torque Converter Clutch Circuit — Performance or Stuck Off",
    system: "Transmission",
    severity: "high",
    canDrive: true,
    commonCauses: ["Faulty torque converter", "Faulty TCC solenoid", "Low transmission fluid", "Worn clutch plate in TC"],
    repairSteps: ["Check transmission fluid level and condition", "Test TCC solenoid operation", "Monitor TCC lockup with scan tool during steady highway driving", "If TCC never locks, replace solenoid or torque converter"],
    estimatedCost: { min: 200, max: 2000 },
    affectedSystems: ["Transmission"],
  },

  // ───── ABS / TRACTION ─────
  {
    code: "C0035",
    description: "Left Front Wheel Speed Sensor Circuit",
    system: "ABS / Traction Control",
    severity: "high",
    canDrive: true,
    commonCauses: ["Failed wheel speed sensor", "Damaged tone ring (reluctor)", "Wiring damage near wheel", "Bearing hub failure with integrated sensor"],
    repairSteps: ["Inspect wheel speed sensor and connector at left front wheel", "Check tone ring for missing teeth, rust, or debris", "Test sensor resistance (passive: 800–1400 ohms; active: 5V reference)", "Measure sensor gap — should be <1mm", "Replace sensor or hub assembly if faulty"],
    estimatedCost: { min: 100, max: 400 },
    affectedSystems: ["ABS", "Traction Control", "Stability Control"],
  },
  {
    code: "C0045",
    description: "Right Rear Wheel Speed Sensor Circuit",
    system: "ABS / Traction Control",
    severity: "high",
    canDrive: true,
    commonCauses: ["Failed right rear wheel speed sensor", "Damaged tone ring", "Corroded connector"],
    repairSteps: ["Inspect right rear wheel speed sensor and harness", "Check tone ring condition", "Test sensor signal with live data while spinning wheel by hand", "Replace sensor if signal is absent or erratic"],
    estimatedCost: { min: 100, max: 380 },
    affectedSystems: ["ABS", "Traction Control"],
  },

  // ───── BATTERY / CHARGING ─────
  {
    code: "P0562",
    description: "System Voltage Low",
    system: "Electrical",
    severity: "high",
    canDrive: false,
    commonCauses: ["Weak or dead battery", "Failing alternator", "Excessive parasitic draw", "Loose or corroded battery terminals"],
    repairSteps: ["Load test the battery (should hold >9.6V under 50% CCA load)", "Test alternator output (should be 13.8–14.8V at idle)", "Clean and tighten battery terminals", "Check for excessive parasitic draw (>50mA key off)", "Replace battery or alternator as diagnosed"],
    estimatedCost: { min: 80, max: 600 },
    affectedSystems: ["Electrical", "Charging"],
  },
  {
    code: "P0563",
    description: "System Voltage High",
    system: "Electrical",
    severity: "medium",
    canDrive: true,
    commonCauses: ["Faulty voltage regulator (internal to alternator)", "Bad ground connection"],
    repairSteps: ["Measure alternator output voltage (should not exceed 14.8V)", "Test voltage regulator (usually built into alternator)", "Check battery and chassis ground connections", "Replace alternator if output exceeds 15V"],
    estimatedCost: { min: 150, max: 500 },
    affectedSystems: ["Electrical", "Charging"],
  },

  // ───── COOLING FAN ─────
  {
    code: "P0480",
    description: "Cooling Fan 1 Control Circuit Malfunction",
    system: "Cooling",
    severity: "high",
    canDrive: false,
    commonCauses: ["Failed cooling fan relay", "Failed cooling fan motor", "Wiring fault to fan", "Faulty ECM/PCM fan driver"],
    repairSteps: ["Check cooling fan relay — swap with identical relay and retest", "Test fan motor by applying 12V directly", "Inspect fan wiring harness for damage", "Check cooling fan fuse", "Replace relay or fan motor as diagnosed"],
    estimatedCost: { min: 50, max: 400 },
    affectedSystems: ["Cooling"],
  },

  // ───── POWER STEERING ─────
  {
    code: "C0450",
    description: "Steering Angle Sensor Circuit Malfunction",
    system: "Steering",
    severity: "medium",
    canDrive: true,
    commonCauses: ["Steering angle sensor not calibrated after alignment", "Failed steering angle sensor", "Wiring damage", "Steering column clock spring damage"],
    repairSteps: ["Perform steering angle sensor calibration with scan tool", "Check steering angle sensor connector and wiring", "Verify battery was not recently disconnected (requires recal)", "Replace steering angle sensor if calibration fails"],
    estimatedCost: { min: 80, max: 400 },
    affectedSystems: ["Steering", "Stability Control"],
  },

  // ───── BODY / AIRBAG ─────
  {
    code: "B0001",
    description: "Driver Frontal Stage 1 Squib Circuit Open",
    system: "Supplemental Restraints (SRS)",
    severity: "critical",
    canDrive: false,
    commonCauses: ["Faulty driver airbag inflator", "Broken clock spring in steering column", "Open circuit in SRS wiring", "Corroded connector"],
    repairSteps: ["DO NOT probe airbag circuits with a test light or powered probe", "Disable SRS system following manufacturer procedure before working", "Check clock spring resistance", "Inspect SRS wiring harness at steering column", "Replace faulty component per SRS service manual"],
    estimatedCost: { min: 200, max: 1200 },
    affectedSystems: ["SRS", "Airbag"],
  },

  // ───── NETWORK / COMMUNICATION ─────
  {
    code: "U0100",
    description: "Lost Communication With ECM/PCM",
    system: "CAN Bus",
    severity: "critical",
    canDrive: false,
    commonCauses: ["Faulty ECM/PCM", "CAN bus wiring fault", "Blown ECM fuse", "Poor ground connection", "Damaged CAN bus termination resistor"],
    repairSteps: ["Check ECM/PCM power and ground fuses", "Test CAN bus resistance (should be ~60 ohms between CAN-H and CAN-L)", "Inspect CAN bus wiring for shorts or opens", "Check all module grounds", "If CAN is shorted, disconnect modules one at a time to isolate fault"],
    estimatedCost: { min: 100, max: 2500 },
    affectedSystems: ["CAN Bus", "All Modules"],
  },
  {
    code: "U0001",
    description: "High Speed CAN Communication Bus Performance",
    system: "CAN Bus",
    severity: "high",
    canDrive: false,
    commonCauses: ["Intermittent CAN wiring fault", "Module with corrupted firmware", "Faulty CAN termination resistor", "Water intrusion into module"],
    repairSteps: ["Scan all modules for codes", "Check CAN bus resistance at DLC pin 6/14", "Inspect CAN bus wiring along known chafe points", "Isolate faulty module by disconnecting one at a time"],
    estimatedCost: { min: 150, max: 2000 },
    affectedSystems: ["CAN Bus"],
  },

  // ───── TURBO / BOOST ─────
  {
    code: "P0234",
    description: "Turbocharger/Supercharger A Overboost Condition",
    system: "Forced Induction",
    severity: "critical",
    canDrive: false,
    commonCauses: ["Faulty wastegate actuator", "Stuck boost solenoid (N75)", "Boost pressure hose leak", "Faulty MAP/boost sensor", "PCM tune issue"],
    repairSteps: ["Check boost pressure with scan tool — should not exceed spec by >3 PSI", "Inspect wastegate actuator rod and diaphragm for leaks", "Test boost control solenoid with scan tool", "Inspect all charge pipes and intercooler for leaks", "Verify MAP sensor reads correctly"],
    estimatedCost: { min: 150, max: 1200 },
    affectedSystems: ["Engine", "Forced Induction"],
  },
  {
    code: "P0299",
    description: "Turbocharger/Supercharger A Underboost Condition",
    system: "Forced Induction",
    severity: "high",
    canDrive: true,
    commonCauses: ["Boost pressure leak (intercooler, charge pipes)", "Worn turbocharger", "Faulty wastegate stuck open", "Faulty boost solenoid", "Clogged air filter"],
    repairSteps: ["Pressure test charge system for leaks (pressurize intake with engine off)", "Check all intercooler pipes and couplers", "Test wastegate actuator — should hold pressure and not leak", "Inspect turbocharger for shaft play (>1mm axial play = worn bearings)", "Check boost control solenoid operation"],
    estimatedCost: { min: 100, max: 3500 },
    affectedSystems: ["Engine", "Forced Induction"],
  },

  // ───── OIL PRESSURE ─────
  {
    code: "P0520",
    description: "Engine Oil Pressure Sensor/Switch Circuit Malfunction",
    system: "Lubrication",
    severity: "high",
    canDrive: false,
    commonCauses: ["Failed oil pressure sensor/switch", "Low engine oil level", "Wiring fault to sensor", "Actually low oil pressure"],
    repairSteps: ["Check engine oil level FIRST — do not start if low", "Install mechanical oil pressure gauge to verify actual pressure", "Normal idle pressure: 25–65 PSI; normal operating: 25–45 PSI", "Replace oil pressure sensor if mechanical gauge shows good pressure", "If actual pressure is low, diagnose oil pump and engine bearings"],
    estimatedCost: { min: 30, max: 150 },
    affectedSystems: ["Engine", "Lubrication"],
  },
];

export function searchObd2Code(query: string): Obd2Code[] {
  const q = query.toUpperCase().trim();
  if (!q) return [];

  // Exact code match first
  const exact = OBD2_DATABASE.filter((c) => c.code === q);
  if (exact.length > 0) return exact;

  // Partial code match (e.g. "P030" matches P0300-P0309)
  const partial = OBD2_DATABASE.filter((c) => c.code.startsWith(q));
  if (partial.length > 0) return partial;

  // Description keyword match
  const keyword = OBD2_DATABASE.filter(
    (c) =>
      c.description.toUpperCase().includes(q) ||
      c.system.toUpperCase().includes(q) ||
      c.affectedSystems.some((s) => s.toUpperCase().includes(q)),
  );
  return keyword.slice(0, 10);
}

export function getAllCodes(): Obd2Code[] {
  return OBD2_DATABASE;
}

export default OBD2_DATABASE;
