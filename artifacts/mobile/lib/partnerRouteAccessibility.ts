export type PartnerRoute =
  | "organizations"
  | "partner-vehicles"
  | "service-requests"
  | "service-request-new"
  | "service-request-detail";

function normalizedPathSegments(pathname: string) {
  return pathname
    .split("?")[0]
    .split("/")
    .filter((segment) => segment.length > 0 && !segment.startsWith("("));
}

/**
 * Expo Router can keep a previous tab/stack screen mounted while another
 * route is visible. Route components use this predicate to remove those
 * mounted-but-inactive screens from the accessibility tree as well as from
 * the focus order.
 */
export function isPartnerRouteActive(pathname: string, route: PartnerRoute) {
  const segments = normalizedPathSegments(pathname);

  if (route === "organizations") {
    return segments.length === 1 && segments[0] === "organizations";
  }
  if (route === "partner-vehicles") {
    return segments.length === 1 && segments[0] === "partner-vehicles";
  }

  const serviceRequestsIndex = segments.indexOf("service-requests");
  if (serviceRequestsIndex < 0) return false;

  const child = segments[serviceRequestsIndex + 1];
  const childCount = segments.length - serviceRequestsIndex - 1;
  if (route === "service-requests") {
    return childCount === 0;
  }
  if (route === "service-request-new") {
    return childCount === 1 && child === "new";
  }
  return childCount === 1 && child !== "new";
}

export function isPartnerServiceRequestDetailActive(pathname: string, requestId: number) {
  if (!Number.isInteger(requestId) || requestId <= 0) return false;
  const segments = normalizedPathSegments(pathname);
  const serviceRequestsIndex = segments.indexOf("service-requests");
  if (serviceRequestsIndex < 0) return false;

  const child = segments[serviceRequestsIndex + 1];
  const childCount = segments.length - serviceRequestsIndex - 1;
  return childCount === 1 && child !== "new" && child === String(requestId);
}

export function partnerRouteAccessibilityProps(active: boolean) {
  return {
    accessibilityElementsHidden: !active,
    importantForAccessibility: (active ? "auto" : "no-hide-descendants") as
      | "auto"
      | "no-hide-descendants",
    "aria-hidden": !active,
  };
}