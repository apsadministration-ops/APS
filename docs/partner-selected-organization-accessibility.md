# Focused selected-organization accessibility verification

## Scope

Only Partner screen accessibility, keyboard focus, labels, selection context,
and retained navigation were examined. No Part 6 implementation or broader
Part 7 audit, security review, or regression process was started.

## Confirmed improvements

- Inactive Partner tab/stack content is excluded from layout, keyboard focus,
  and accessibility navigation while retaining component state.
- Detail routes require exact request identity and focus. Their original
  organization association is preserved while inactive.
- Selected-organization labels/states and scoped form/control labels were
  improved; context-changing queries and forms are gated.
- Forward and reverse keyboard walks on two request details and the new
  request form did not enter hidden or display-none ancestors.
- Switching between two organizations owned by the same account showed only
  the selected organization's request cards, vehicle fields, and locations.

## Unresolved blocker

The browser accessibility tree still exposes a retained previous-organization
request back-link on the newly selected organization's request list. The link
is not visibly rendered. Content-focus boundaries, index header-back suppression,
and dismiss-to-list navigation did not eliminate it in the final targeted check.

This verification is **not complete**. Do not treat the accessibility
requirement as passed or proceed to Part 6 on the basis of these checks.
Further work should locate the exact retained link's DOM/navigation owner
before changing more screen-level flags or rerunning the same flow.

## Verification and cleanup

Mobile typecheck, focused route-helper checks, and diff checks passed.
Browser keyboard/accessibility-tree checks were performed; native
VoiceOver/TalkBack was not certified.

All synthetic fixtures were removed. Final counts: 52 users, 4 shops, 4 bays,
2 bookings, 13 vehicles, 12 ownership-history rows, 8 jobs, and zero
organizations, operations, requests, and request-history rows.