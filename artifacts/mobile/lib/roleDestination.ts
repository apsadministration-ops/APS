import type { UserRole } from "@workspace/api-client-react";

export type RoleDestination =
  | "/(customer)"
  | "/(mechanic)"
  | "/(admin)"
  | "/(shop-owner)";

const ROLE_DESTINATIONS: Record<UserRole, RoleDestination> = {
  customer: "/(customer)",
  mechanic: "/(mechanic)",
  admin: "/(admin)",
  shop_owner: "/(shop-owner)",
};

/**
 * Keep every auth redirect and role guard on the same mapping.  In
 * particular, shop_owner must not fall through to the customer/mechanic
 * branches or the group layouts will redirect one another forever.
 */
export function getRoleDestination(role: string | null | undefined): RoleDestination | null {
  if (!role || !(role in ROLE_DESTINATIONS)) return null;
  return ROLE_DESTINATIONS[role as UserRole];
}