import { and, eq } from "drizzle-orm";
import {
  db,
  jobsTable,
  partnerOrganizationsTable,
  partnerServiceRequestsTable,
  shopsTable,
} from "@workspace/db";

/**
 * A commercial owner is a principal for a linked APS job only when the source
 * request, source organization, and job all point at each other and the
 * organization is owned by that exact account. Do not broaden this to every
 * shop_owner: shop_owner is an account role, not a staff membership grant.
 */
export async function isCommercialJobOwner(
  job: Pick<
    typeof jobsTable.$inferSelect,
    "id" | "sourceOrganizationId" | "sourceServiceRequestId" | "customerId"
  >,
  userId: number,
): Promise<boolean> {
  if (
    job.sourceOrganizationId == null ||
    job.sourceServiceRequestId == null ||
    job.customerId !== userId
  ) {
    return false;
  }
  const [link] = await db
    .select({
      organizationId: partnerOrganizationsTable.id,
      primaryOwnerId: partnerOrganizationsTable.primaryOwnerId,
      requestOrganizationId: partnerServiceRequestsTable.organizationId,
      linkedApsJobId: partnerServiceRequestsTable.linkedApsJobId,
    })
    .from(partnerOrganizationsTable)
    .innerJoin(
      partnerServiceRequestsTable,
      and(
        eq(
          partnerServiceRequestsTable.organizationId,
          partnerOrganizationsTable.id,
        ),
        eq(
          partnerServiceRequestsTable.id,
          job.sourceServiceRequestId,
        ),
      ),
    )
    .where(
      and(
        eq(partnerOrganizationsTable.id, job.sourceOrganizationId),
        eq(partnerOrganizationsTable.primaryOwnerId, userId),
      ),
    );
  return Boolean(
    link &&
      link.organizationId === job.sourceOrganizationId &&
      link.requestOrganizationId === job.sourceOrganizationId &&
      link.linkedApsJobId === job.id,
  );
}

/**
 * Legacy partner jobs retain their existing owner policy. Commercial bridge
 * jobs use the strict organization/request link above.
 */
export async function isPartnerJobOwner(
  job: Pick<
    typeof jobsTable.$inferSelect,
    | "id"
    | "sourceOrganizationId"
    | "sourceServiceRequestId"
    | "customerId"
    | "postedByShopId"
  >,
  userId: number,
): Promise<boolean> {
  if (job.sourceOrganizationId != null || job.sourceServiceRequestId != null) {
    return isCommercialJobOwner(job, userId);
  }
  if (job.customerId !== userId || job.postedByShopId == null) {
    return false;
  }
  const [shop] = await db
    .select({ ownerId: shopsTable.ownerId })
    .from(shopsTable)
    .where(eq(shopsTable.id, job.postedByShopId));
  return shop?.ownerId === userId;
}