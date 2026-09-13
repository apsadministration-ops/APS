import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const generated = readFileSync(
  new URL("../../../lib/api-client-react/src/generated/api.ts", import.meta.url),
  "utf8",
);
for (const hook of [
  "useApproveBayBooking",
  "useRejectBayBooking",
  "useCancelBayBooking",
  "useGetJobLiftRequirement",
  "useSetJobLiftRequirement",
  "useGetJobApproval",
  "useApproveJobApproval",
  "useDeclineJobApproval",
]) {
  assert.match(generated, new RegExp(`export (?:const|function) ${hook}\\b`), hook);
}

const ownerBookings = read("app/(shop-owner)/bookings.tsx");
assert.match(ownerBookings, /useApproveBayBooking/);
assert.match(ownerBookings, /useRejectBayBooking/);
assert.match(ownerBookings, /b\.status === "pending"/);
assert.match(ownerBookings, /Confirm Reject/);
assert.match(ownerBookings, /reason: rejectReason/);

const jobDetail = read("app/job/[id].tsx");
assert.match(jobDetail, /useGetJobLiftRequirement/);
assert.match(jobDetail, /useSetJobLiftRequirement/);
assert.match(jobDetail, /requiresGhostGarage: true/);
assert.match(jobDetail, /useCancelBayBooking/);
assert.match(jobDetail, /Cancel & Reschedule/);
assert.match(jobDetail, /bookingStatus=/);
assert.match(jobDetail, /refetchInterval: 10_000/);
assert.match(jobDetail, /sourceOrganizationId/);
assert.match(jobDetail, /sourceServiceRequestId/);

const approval = read("app/job/[id]/approve.tsx");
assert.match(approval, /useGetJobApproval/);
assert.match(approval, /useApproveJobApproval/);
assert.match(approval, /useDeclineJobApproval/);
assert.doesNotMatch(approval, /\bfetch\(/);

const bayScheduler = read("app/bays/[jobId].tsx");
assert.match(bayScheduler, /startsAt: scheduleStart/);
assert.match(bayScheduler, /durationHours: hours/);
assert.match(bayScheduler, /booking\.status === "pending"/);
assert.match(bayScheduler, /Previous bay request/);

const shopDetail = read("app/shop/[id].tsx");
assert.match(shopDetail, /availabilityConfig/);
assert.match(shopDetail, /weekly:/);
assert.match(shopDetail, /WEEKLY AVAILABILITY \(UTC\)/);
assert.match(shopDetail, /validateAvailability/);
assert.match(shopDetail, /TIME_PATTERN/);
assert.match(shopDetail, /Overnight windows are supported/);

const worklog = read("app/worklog/[jobId].tsx");
assert.match(worklog, /WORKLOG_BOOKING_STATUSES/);
assert.match(worklog, /WORKLOG_BOOKING_STATUSES\.has\(b\.status\)/);
assert.doesNotMatch(worklog, /status.*pending.*satisfy/i);

console.log("Ghost Garage UI contract checks passed.");