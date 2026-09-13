/**
 * Fields that are safe to return when a mechanic profile is requested by
 * another authenticated user.  Contact details, referral identifiers,
 * balances, and account status remain private to the mechanic/admin surfaces.
 */
export function formatPublicMechanicProfile(user: {
  id: number;
  name: string;
  role: string;
  avatarUrl?: string | null;
  mechanicTier?: string | null;
  certifications?: string | null;
  createdAt: Date;
}) {
  return {
    id: user.id,
    name: user.name,
    role: user.role,
    avatarUrl: user.avatarUrl ?? null,
    mechanicTier: user.mechanicTier ?? null,
    certifications: user.certifications ?? "[]",
    createdAt: user.createdAt,
  };
}