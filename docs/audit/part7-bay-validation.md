# Part 7 bay availability validation audit

Date: 2026-09-13 (UTC)  
Scope: the owner bay editor, the Part 6 availability contract, and the
server-side booking/discovery gates.

## Finding

The initial browser audit called a saved Monday `19:00–08:00` window a
validation defect. That conclusion does not match the implementation contract:

- `artifacts/api-server/src/lib/bayAvailability.ts` explicitly treats a
  non-equal `open > close` pair as an overnight UTC window.
- The Part 6 contract defines UTC `HH:mm` windows and rejects malformed or
  zero-length intervals, but does not prohibit crossing midnight.
- Therefore Monday `19:00–08:00` is valid: the window opens Monday at 19:00
  and closes Tuesday at 08:00. The successful owner save and persistence
  observed in the browser were expected, not an acceptance of malformed data.
- An empty `weekly` array remains the legacy always-available configuration.

There was a real boundary bug in the interval evaluator: a booking beginning
on the continuation day (for example Tuesday `01:00–03:00`) was compared only
with Tuesday windows, so it was rejected even while Monday's overnight window
was still open.

## Fixes

- The backend evaluator now compares the requested interval with both the
  window's opening day and the previous day when the window is overnight. It
  still rejects malformed/equal windows, intervals that do not fit completely,
  and invalid timestamps.
- The owner editor now performs the same `HH:mm` and non-zero checks before
  submitting. Reversed times remain intentionally allowed and the editor
  explains that they continue into the following UTC day.
- No change was made to blank/legacy availability, bay status, tier/category
  filtering, or booking identity derivation.

## Regression coverage

- `artifacts/api-server/src/lib/bayAvailability.test.ts` covers:
  - Monday evening and Tuesday-morning portions of an overnight window,
  - exact close boundaries,
  - normal windows,
  - malformed/equal values, and
  - null, `{}`, and empty-weekly legacy always-available behavior.
- The opt-in Part 6 integration suite adds a scoped Part 7 case covering:
  - a configured Monday overnight window excluding Tuesday daytime,
  - manual requests remaining `pending` until owner approval,
  - auto-approved requests becoming `reserved` immediately, and
  - the same bay settings being enforced at booking time.

The integration suite remains opt-in and uses its existing synthetic fixture and
cleanup guard; no shared or production data is required.