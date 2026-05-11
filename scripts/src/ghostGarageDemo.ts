import { Client } from "pg";

const BASE = process.env.APS_BASE_URL ?? "http://localhost:80/api";
const DB_URL = process.env.DATABASE_URL!;
const TS = Date.now();

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
};

function step(persona: string, color: string, msg: string): void {
  process.stdout.write(`${color}[${persona}]${C.reset} ${msg}\n`);
}
function info(msg: string): void { process.stdout.write(`${C.dim}  → ${msg}${C.reset}\n`); }
function success(msg: string): void { process.stdout.write(`${C.green}  ✓ ${msg}${C.reset}\n`); }
function fail(msg: string): never { process.stdout.write(`${C.red}  ✗ ${msg}${C.reset}\n`); throw new Error(msg); }
function header(label: string): void {
  process.stdout.write(`\n${C.bold}${C.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n  ${label}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.reset}\n`);
}

async function api<T = any>(method: string, path: string, body?: unknown, token?: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* ignore */ }
  if (!res.ok) {
    fail(`${method} ${path} → ${res.status} ${text.slice(0, 200)}`);
  }
  return json as T;
}

async function register(role: "customer" | "mechanic" | "shop_owner", suffix: string, extra: Record<string, unknown> = {}) {
  const email = `demo-${role}-${TS}-${suffix}@aps.test`;
  const r = await api<{ token: string; user: any }>("POST", "/auth/register", {
    name: `Demo ${role[0].toUpperCase()}${role.slice(1)} ${suffix}`,
    email,
    phone: "+15551234567",
    password: "DemoPass!2026",
    role,
    address: "100 Main St",
    city: "Brooklyn",
    region: "NY",
    zipCode: "11201",
    homeLat: 40.6928,
    homeLng: -73.9903,
    ...extra,
  });
  return { token: r.token, user: r.user, email };
}

async function activateMechanic(mechanicId: number, tier: "detailer" | "technician" | "senior" | "master"): Promise<void> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  try {
    await client.query(
      `UPDATE users SET status = 'active', mechanic_tier = $1 WHERE id = $2`,
      [tier, mechanicId],
    );
  } finally {
    await client.end();
  }
}

async function relogin(email: string): Promise<string> {
  const r = await api<{ token: string }>("POST", "/auth/login", { email, password: "DemoPass!2026" });
  return r.token;
}

async function main(): Promise<void> {
  header("APS Ghost Garage — End-to-End Demo");
  info(`API base: ${BASE}`);
  info(`Database: ${DB_URL ? "(connected)" : "(missing DATABASE_URL!)"}`);
  if (!DB_URL) fail("DATABASE_URL not set");

  // ───────────── PERSONA 1: SHOP OWNER ─────────────
  header("Persona 1 — Shop Owner: Lift City Garage");
  step("SHOP OWNER", C.magenta, "Registering owner account…");
  const owner = await register("shop_owner", "lift");
  success(`Registered owner #${owner.user.id} (${owner.email})`);

  step("SHOP OWNER", C.magenta, "Creating shop \"Lift City Garage\"…");
  const shop = await api<{ id: number; name: string }>("POST", "/shops", {
    name: "Lift City Garage",
    address: "742 Industrial Pkwy",
    city: "Brooklyn",
    region: "NY",
    zipCode: "11231",
    lat: 40.6781,
    lng: -73.9442,
    phone: "+17185550199",
    insuranceCarrier: "Hartford Auto Shop Liability",
    insurancePolicyNumber: "ASL-DEMO-0001",
  }, owner.token);
  success(`Created shop #${shop.id} — ${shop.name}`);

  step("SHOP OWNER", C.magenta, "Adding Bay #1 (lift, repair-capable, technician+)…");
  const bay = await api<{ id: number; name: string }>("POST", `/shops/${shop.id}/bays`, {
    name: "Bay #1 — Two-Post Lift",
    hourlyRate: 35,
    equipment: ["two-post-lift", "scan-tool", "alignment-rack"],
    allowedJobCategories: ["repair", "diagnostic", "maintenance"],
    minMechanicTier: "technician",
    autoApprove: true,
  }, owner.token);
  success(`Created bay #${bay.id} — ${bay.name} ($35/hr, auto-approve ON)`);

  const myShops = await api<any[]>("GET", "/shops/mine", undefined, owner.token);
  success(`Owner now manages ${myShops.length} shop(s).`);

  // ───────────── PERSONA 2: CUSTOMER ─────────────
  header("Persona 2 — Customer: requests Ghost Garage job");
  step("CUSTOMER", C.blue, "Registering customer account…");
  const cust = await register("customer", "alex");
  success(`Registered customer #${cust.user.id} (${cust.email})`);

  step("CUSTOMER", C.blue, "Adding a 2018 Subaru Outback to garage…");
  const veh = await api<{ id: number; vin: string }>("POST", "/vehicles", {
    vin: "JF2SJAEC9JH" + String(TS).slice(-6),
    plateNumber: `DEMO-${String(TS).slice(-4)}`,
    make: "Subaru",
    model: "Outback",
    year: 2018,
    trim: "Limited",
    color: "Crystal White",
    mileage: 78420,
  }, cust.token);
  success(`Vehicle #${veh.id} added (VIN ${veh.vin}).`);

  step("CUSTOMER", C.blue, "Creating Ghost Garage job (CV axle replacement)…");
  const job = await api<{ id: number; status: string; requiresGhostGarage: boolean }>(
    "POST",
    "/jobs",
    {
      vehicleId: veh.id,
      jobType: "repair",
      description: "Front-left CV axle clicking on hard-left turns. Needs lift to drop subframe.",
      locationAddress: "100 Main St, Brooklyn NY 11201",
      locationLat: 40.6928,
      locationLng: -73.9903,
      estimatedPrice: 380,
      requiresGhostGarage: true,
    },
    cust.token,
  );
  success(`Job #${job.id} created — requiresGhostGarage=${job.requiresGhostGarage}, status=${job.status}`);

  // ───────────── PERSONA 3: MECHANIC ─────────────
  header("Persona 3 — Mechanic: accepts and works the job");
  step("MECHANIC", C.yellow, "Registering mechanic account (starts as 'pending')…");
  const mech = await register("mechanic", "morgan", { serviceRadiusMiles: 30 });
  success(`Registered mechanic #${mech.user.id} (status=${mech.user.status}, tier=${mech.user.mechanicTier ?? "(none)"})`);

  step("MECHANIC", C.yellow, "Admin activates mechanic and promotes to 'technician' (DB write)…");
  await activateMechanic(mech.user.id, "technician");
  const mechToken = await relogin(mech.email);
  success("Mechanic is now active @ technician tier.");

  step("MECHANIC", C.yellow, "Browsing available jobs…");
  const available = await api<any[]>("GET", "/jobs/available", undefined, mechToken);
  const targetJob = available.find((j) => j.id === job.id);
  if (!targetJob) fail(`Job #${job.id} not visible to mechanic in /jobs/available.`);
  success(`Sees ${available.length} job(s); target job #${job.id} is in the list.`);

  step("MECHANIC", C.yellow, `Accepting job #${job.id}…`);
  await api("POST", `/jobs/${job.id}/accept`, {}, mechToken);
  success("Job accepted.");

  // ───────────── CUSTOMER: TRANSPORT APPROVAL ─────────────
  header("Customer approves transport to a shop bay");
  step("CUSTOMER", C.blue, "Approving vehicle transport to shop…");
  await api("POST", `/jobs/${job.id}/transport-approval`, {}, cust.token);
  const jobAfterApproval = await api<any>("GET", `/jobs/${job.id}`, undefined, cust.token);
  if (!jobAfterApproval.customerTransportApproved) fail("Transport approval flag not set.");
  success(`customerTransportApproved=${jobAfterApproval.customerTransportApproved}`);

  // ───────────── MECHANIC: PRE-INSPECTION ─────────────
  header("Mechanic captures pre-inspection at customer's address");
  step("MECHANIC", C.yellow, "Submitting PRE-inspection (78,420 mi, no damage, transport pickup mileage)…");
  const preInsp = await api<{ id: number; kind: string }>("POST", `/jobs/${job.id}/inspections`, {
    kind: "pre",
    mileage: 78420,
    mediaUrls: [
      "https://demo.aps/pre/front.jpg",
      "https://demo.aps/pre/driver-side.jpg",
      "https://demo.aps/pre/rear.jpg",
      "https://demo.aps/pre/odometer.jpg",
    ],
    damageChecklist: {
      scratches: { ok: true, notes: "Minor curb-rash front-left rim, pre-existing." },
      dents: { ok: true },
      glass: { ok: true },
      wheels: { ok: true, notes: "All ~6/32 tread." },
      lights: { ok: true },
      interior: { ok: true },
      fluidLeaks: { ok: true, notes: "Coolant a touch low; topped off later." },
    },
    notes: "Vehicle started fine. Customer present at handoff.",
    transportPickupMileage: 78420,
  }, mechToken);
  success(`Pre-inspection #${preInsp.id} captured.`);

  // ───────────── MECHANIC: BOOK BAY ─────────────
  header("Mechanic finds and books a bay");
  step("MECHANIC", C.yellow, "Searching available bays for repair / technician…");
  const availableBays = await api<any[]>("GET", "/bays/available?jobCategory=repair&minTier=technician", undefined, mechToken);
  const targetBay = availableBays.find((b) => b.id === bay.id);
  if (!targetBay) fail(`Bay #${bay.id} not found in available list.`);
  success(`Found ${availableBays.length} bay(s). Target bay #${bay.id} is reservable.`);

  step("MECHANIC", C.yellow, "Booking bay for 2 hours starting in 15 min…");
  const startTime = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const booking = await api<{ id: number; status: string }>("POST", `/bays/${bay.id}/bookings`, {
    jobId: job.id,
    startTime,
    estimatedHours: 2,
  }, mechToken);
  success(`Booking #${booking.id} created (status=${booking.status}).`);

  step("MECHANIC", C.yellow, "Marking job EN_ROUTE then IN_PROGRESS…");
  await api("PATCH", `/jobs/${job.id}/status`, { status: "EN_ROUTE" }, mechToken);
  await api("PATCH", `/jobs/${job.id}/status`, { status: "IN_PROGRESS" }, mechToken);
  success("Job is IN_PROGRESS.");

  step("MECHANIC", C.yellow, "Starting the bay booking (clock-in)…");
  await api("PATCH", `/bookings/${booking.id}/start`, {}, mechToken);
  success("Bay booking started.");

  step("MECHANIC", C.yellow, "Completing the bay booking (clock-out)…");
  await api("PATCH", `/bookings/${booking.id}/complete`, {}, mechToken);
  success("Bay booking completed.");

  // ───────────── MECHANIC: POST-INSPECTION ─────────────
  header("Mechanic captures post-inspection at the shop");
  step("MECHANIC", C.yellow, "Submitting POST-inspection (78,431 mi, no new damage, transport arrival)…");
  const postInsp = await api<{ id: number }>("POST", `/jobs/${job.id}/inspections`, {
    kind: "post",
    mileage: 78431,
    mediaUrls: [
      "https://demo.aps/post/front.jpg",
      "https://demo.aps/post/driver-side.jpg",
      "https://demo.aps/post/rear.jpg",
      "https://demo.aps/post/odometer.jpg",
      "https://demo.aps/post/test-drive.mp4",
    ],
    damageChecklist: {
      scratches: { ok: true, notes: "Same pre-existing curb rash." },
      dents: { ok: true },
      glass: { ok: true },
      wheels: { ok: true },
      lights: { ok: true },
      interior: { ok: true },
      fluidLeaks: { ok: true, notes: "Coolant topped to MAX." },
    },
    notes: "10-minute test drive: clicking gone. Vehicle clean.",
    transportArrivalMileage: 78429,
  }, mechToken);
  success(`Post-inspection #${postInsp.id} captured.`);

  // ───────────── MECHANIC: WORK LOG ─────────────
  header("Mechanic submits the diagnostic-rich work log");
  step("MECHANIC", C.yellow, "Submitting work log with all Phase-3 diagnostic fields…");
  const workLog = await api<{ id: number }>("POST", "/worklogs", {
    jobId: job.id,
    serviceCategory: "repair",
    serviceDescription: "Front-left CV axle replacement (OEM-grade reman).",
    mileageAtService: 78431,
    laborCost: 220,
    partsCost: 165,
    partsUsed: ["GSP NCV23568 reman CV axle", "axle nut", "subframe bolts (qty 4)"],
    notes: "Subframe dropped, axle popped clean. Re-torqued to spec.",
    beforeImages: ["https://demo.aps/wl/before.jpg"],
    afterImages: ["https://demo.aps/wl/after.jpg"],
    laborHours: 1.75,
    diagnosticCodes: [],
    rootCauseDiagnosis: "Inner CV joint had play causing the click on left turns; outer boot was intact but joint had wear.",
    repairSteps: "Lift + secure. Remove wheel, axle nut, ball joint. Drop subframe one side. Pry axle from transaxle. Install new axle (clipped, verified seated). Reassemble. Torque to spec. Test drive.",
    observedSymptoms: "Click on hard-left turns, especially under throttle.",
    recommendedMonitoring: "Re-check axle nut torque at 500 mi. Watch for boot tears.",
    recurringIssueTags: ["cv-axle-wear", "subaru-outback-2018"],
    bayBookingId: booking.id,
  }, mechToken);
  success(`Work log #${workLog.id} submitted.`);

  // ───────────── FINAL VERIFICATION ─────────────
  header("Final verification");
  const finalJob = await api<any>("GET", `/jobs/${job.id}`, undefined, cust.token);
  const finalInsps = await api<any[]>("GET", `/jobs/${job.id}/inspections`, undefined, cust.token);
  step("CUSTOMER", C.blue, `Job #${job.id} now status=${finalJob.status}, inspections=${finalInsps.length}.`);
  if (finalInsps.length !== 2) fail(`Expected 2 inspections, got ${finalInsps.length}.`);
  success("Customer can see both pre and post inspections.");
  success("Ghost Garage end-to-end demo PASSED 🎉");

  process.stdout.write(`\n${C.bold}${C.green}╔════════════════════════════════════════════════════╗\n║  All 3 personas executed every endpoint cleanly.   ║\n╚════════════════════════════════════════════════════╝${C.reset}\n\n`);
}

main().catch((e) => {
  process.stdout.write(`\n${C.red}${C.bold}DEMO FAILED:${C.reset} ${C.red}${e?.message ?? e}${C.reset}\n`);
  process.exit(1);
});
