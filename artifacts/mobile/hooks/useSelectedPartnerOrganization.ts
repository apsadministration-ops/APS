import { useCallback, useEffect, useMemo } from "react";
import type { PartnerOrganization } from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  readSelectedPartnerOrganizationId,
  resolveSelectedPartnerOrganizationId,
  writeSelectedPartnerOrganizationId,
  clearSelectedPartnerOrganizationId,
} from "@/lib/partnerOrganization";

const SELECTION_QUERY_PREFIX = "partner-organization-selection";

function selectionQueryKey(userId: number | null | undefined) {
  return [SELECTION_QUERY_PREFIX, userId ?? "signed-out"] as const;
}

function selectionErrorMessage(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

export function useSelectedPartnerOrganization(
  userId: number | null | undefined,
  organizations: PartnerOrganization[] | undefined,
) {
  const queryClient = useQueryClient();
  const scopedSelectionKey = selectionQueryKey(userId);
  const storageErrorKey = [...scopedSelectionKey, "storage-error"] as const;
  const selectionQuery = useQuery<number | null>({
    queryKey: scopedSelectionKey,
    enabled: userId != null,
    retry: false,
    staleTime: Infinity,
    queryFn: async () => {
      try {
        return await readSelectedPartnerOrganizationId(userId as number);
      } catch (error) {
        throw new Error(
          selectionErrorMessage(error, "Unable to load the saved organization selection."),
        );
      }
    },
  });
  const storageErrorQuery = useQuery<string | null>({
    queryKey: storageErrorKey,
    // Local cache state only; errors are set by the storage write handler.
    enabled: false,
    queryFn: () => null,
    initialData: null,
    staleTime: Infinity,
  });

  const selectedId = resolveSelectedPartnerOrganizationId(selectionQuery.data, organizations);

  // Organization selections are scoped to the authenticated user. Drop a
  // stale id from this account, and persist the safe sole-organization
  // default so a subsequent login restores the same validated context.
  useEffect(() => {
    if (userId == null || !organizations || selectionQuery.status === "pending") return;
    const savedId = selectionQuery.data ?? null;
    if (
      savedId != null &&
      !organizations.some((organization) => organization.id === savedId)
    ) {
      queryClient.setQueryData(scopedSelectionKey, null);
      queryClient.setQueryData(storageErrorKey, null);
      void clearSelectedPartnerOrganizationId(userId);
      return;
    }
    if (organizations.length === 1 && savedId !== organizations[0].id) {
      queryClient.setQueryData(scopedSelectionKey, organizations[0].id);
      void writeSelectedPartnerOrganizationId(userId, organizations[0].id);
    }
  }, [
    organizations,
    queryClient,
    selectionQuery.data,
    scopedSelectionKey,
    selectionQuery.status,
    storageErrorKey,
    userId,
  ]);

  const selectOrganization = useCallback(
    (organizationId: number) => {
      if (
        userId == null ||
        !organizations?.some((organization) => organization.id === organizationId)
      ) {
        return;
      }
      const queryKey = selectionQueryKey(userId);
      const errorKey = [...queryKey, "storage-error"] as const;
      queryClient.setQueryData(queryKey, organizationId);
      queryClient.setQueryData(errorKey, null);
      void writeSelectedPartnerOrganizationId(userId, organizationId).catch((error: unknown) => {
        queryClient.setQueryData(
          errorKey,
          selectionErrorMessage(error, "Unable to save the organization selection on this device."),
        );
      });
    },
    [organizations, queryClient, userId],
  );

  const selectedOrganization = useMemo(
    () => organizations?.find((organization) => organization.id === selectedId) ?? null,
    [organizations, selectedId],
  );

  return {
    selectedId,
    selectedOrganization,
    selectOrganization,
    isSelectionReady: userId == null || selectionQuery.status !== "pending",
    storageError:
      storageErrorQuery.data ??
      (selectionQuery.error
        ? selectionErrorMessage(
            selectionQuery.error,
            "Unable to load the saved organization selection.",
          )
        : null),
  };
}