import assert from "node:assert/strict";
import test from "node:test";
import { isBayIntervalAvailable, normalizeBayAvailabilityConfig } from "./bayAvailability";

const overnightMonday = {
  timezone: "UTC" as const,
  weekly: [{ dayOfWeek: 1, open: "19:00", close: "08:00" }],
};

function utc(day: string, time: string): Date {
  return new Date(`${day}T${time}:00.000Z`);
}

test("overnight windows include both sides of the UTC day boundary", () => {
  assert.equal(
    isBayIntervalAvailable(
      overnightMonday,
      utc("2099-12-07", "19:00"),
      utc("2099-12-07", "21:00"),
    ),
    true,
  );
  assert.equal(
    isBayIntervalAvailable(
      overnightMonday,
      utc("2099-12-07", "19:00"),
      utc("2099-12-08", "08:00"),
    ),
    true,
  );
  assert.equal(
    isBayIntervalAvailable(
      overnightMonday,
      utc("2099-12-08", "01:00"),
      utc("2099-12-08", "03:00"),
    ),
    true,
  );
  assert.equal(
    isBayIntervalAvailable(
      overnightMonday,
      utc("2099-12-08", "08:00"),
      utc("2099-12-08", "09:00"),
    ),
    false,
  );
});

test("normal windows, equal times, and legacy blank configs retain their contracts", () => {
  const daytimeMonday = {
    timezone: "UTC" as const,
    weekly: [{ dayOfWeek: 1, open: "08:00", close: "17:00" }],
  };
  assert.equal(
    isBayIntervalAvailable(
      daytimeMonday,
      utc("2099-12-07", "08:00"),
      utc("2099-12-07", "17:00"),
    ),
    true,
  );
  assert.equal(
    isBayIntervalAvailable(
      daytimeMonday,
      utc("2099-12-08", "08:00"),
      utc("2099-12-08", "09:00"),
    ),
    false,
  );
  assert.equal(
    isBayIntervalAvailable(
      { timezone: "UTC", weekly: [{ dayOfWeek: 1, open: "08:00", close: "08:00" }] },
      utc("2099-12-07", "08:00"),
      utc("2099-12-07", "09:00"),
    ),
    false,
  );
  assert.equal(isBayIntervalAvailable(null, utc("2099-12-07", "08:00"), utc("2099-12-07", "09:00")), true);
  assert.equal(isBayIntervalAvailable({}, utc("2099-12-07", "08:00"), utc("2099-12-07", "09:00")), true);
  assert.equal(isBayIntervalAvailable({ timezone: "UTC", weekly: [] }, utc("2099-12-07", "08:00"), utc("2099-12-07", "09:00")), true);
});

test("normalization rejects malformed values but accepts a non-zero overnight window", () => {
  const accepted = normalizeBayAvailabilityConfig(overnightMonday);
  assert.equal(accepted.error, undefined);
  assert.deepEqual(accepted.config, overnightMonday);

  const equal = normalizeBayAvailabilityConfig({
    timezone: "UTC",
    weekly: [{ dayOfWeek: 1, open: "08:00", close: "08:00" }],
  });
  assert.match(equal.error ?? "", /non-zero interval/);

  const malformed = normalizeBayAvailabilityConfig({
    timezone: "UTC",
    weekly: [{ dayOfWeek: 1, open: "8:00", close: "17:00" }],
  });
  assert.match(malformed.error ?? "", /HH:mm/);
});