import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import {
  PartnerOrganizationStatus,
  type PartnerOrganization,
  type PartnerOrganizationSubtype,
  useCreatePartnerOrganization,
  useGetPartnerOrganization,
  useLinkPartnerOrganizationLocation,
  useListMyShops,
  useListPartnerOrganizationLocations,
  useListPartnerOrganizations,
  useUpdatePartnerOrganization,
  getGetPartnerOrganizationQueryKey,
  getGetShopQueryKey,
  getListMyShopsQueryKey,
  getListPartnerOrganizationLocationsQueryKey,
  getListPartnerOrganizationsQueryKey,
  getListAvailableBaysQueryKey,
  getListMyBookingsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { usePathname, useRouter } from "expo-router";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import {
  PARTNER_ORGANIZATION_SUBTYPE_OPTIONS,
  partnerOrganizationsQueryKey,
  partnerOrganizationSubtypeLabel,
} from "@/lib/partnerOrganization";
import { useSelectedPartnerOrganization } from "@/hooks/useSelectedPartnerOrganization";
import { alertMessage } from "@/utils/confirm";
import {
  isPartnerRouteActive,
  partnerRouteAccessibilityProps,
} from "@/lib/partnerRouteAccessibility";

type FormMode = "create" | "edit" | null;

type OrganizationForm = {
  legalName: string;
  name: string;
  subtype: PartnerOrganizationSubtype;
  contactName: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  region: string;
  zipCode: string;
  status: PartnerOrganizationStatus;
};

const EMPTY_FORM: OrganizationForm = {
  legalName: "",
  name: "",
  subtype: "shop",
  contactName: "",
  phone: "",
  email: "",
  address: "",
  city: "",
  region: "",
  zipCode: "",
  status: "active",
};

const SUBTYPE_ICONS: Record<PartnerOrganizationSubtype, keyof typeof Feather.glyphMap> = {
  shop: "tool",
  dealership: "award",
  fleet: "truck",
  commercial_business: "briefcase",
};

function errorMessage(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

function displayAddress(organization: PartnerOrganization) {
  return [organization.address, organization.city, organization.region, organization.zipCode]
    .filter(Boolean)
    .join(", ");
}

function organizationLegalName(organization: PartnerOrganization) {
  return (organization as PartnerOrganization & { legalName?: string | null }).legalName ?? "";
}

export default function PartnerOrganizationsScreen() {
  const colors = useColors();
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const enabled = !!user && user.role === "shop_owner";

  const {
    data: organizations,
    error: organizationsError,
    isLoading: organizationsLoading,
    isRefetching: organizationsRefetching,
    refetch: refetchOrganizations,
  } = useListPartnerOrganizations({
    query: { enabled, queryKey: partnerOrganizationsQueryKey(user?.id) },
  });
  const {
    data: shops,
    error: shopsError,
    isLoading: shopsLoading,
    refetch: refetchShops,
  } = useListMyShops({
    query: { enabled, queryKey: getListMyShopsQueryKey() },
  });

  const {
    selectedId,
    selectedOrganization: selectedOrganizationFromList,
    selectOrganization,
    isSelectionReady,
    storageError: selectionStorageError,
  } = useSelectedPartnerOrganization(user?.id, organizations);
  const {
    data: selectedOrganizationDetail,
    error: selectedOrganizationError,
  } = useGetPartnerOrganization(selectedId ?? 0, {
    query: {
      enabled: enabled && isSelectionReady && selectedId != null,
      queryKey: getGetPartnerOrganizationQueryKey(selectedId ?? 0),
    },
  });
  const selectedOrganization = selectedOrganizationDetail ?? selectedOrganizationFromList;

  const {
    data: linkedLocations,
    error: linkedLocationsError,
    isLoading: linkedLocationsLoading,
    isRefetching: linkedLocationsRefetching,
    refetch: refetchLinkedLocations,
  } = useListPartnerOrganizationLocations(selectedId ?? 0, {
    query: {
      enabled: enabled && isSelectionReady && selectedId != null,
      queryKey: getListPartnerOrganizationLocationsQueryKey(selectedId ?? 0),
    },
  });

  const createMutation = useCreatePartnerOrganization();
  const updateMutation = useUpdatePartnerOrganization();
  const linkMutation = useLinkPartnerOrganizationLocation();

  const [formMode, setFormMode] = useState<FormMode>(null);
  const [form, setForm] = useState<OrganizationForm>(EMPTY_FORM);
  const [formError, setFormError] = useState("");
  const [actionError, setActionError] = useState("");

  const unlinkedLocations = useMemo(
    () => (shops ?? []).filter((shop) => shop.organizationId == null),
    [shops],
  );
  const otherOrganizationLocations = useMemo(
    () =>
      (shops ?? []).filter(
        (shop) =>
          shop.organizationId != null && shop.organizationId !== selectedOrganization?.id,
      ),
    [selectedOrganization?.id, shops],
  );

  const setField = <K extends keyof OrganizationForm>(field: K, value: OrganizationForm[K]) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const openCreate = () => {
    setActionError("");
    setFormError("");
    setForm({ ...EMPTY_FORM });
    setFormMode("create");
  };

  const openEdit = () => {
    if (!selectedOrganization) return;
    setActionError("");
    setFormError("");
    setForm({
      legalName: organizationLegalName(selectedOrganization),
      name: selectedOrganization.name,
      subtype: selectedOrganization.subtype,
      contactName: selectedOrganization.contactName ?? "",
      phone: selectedOrganization.phone,
      email: selectedOrganization.email,
      address: selectedOrganization.address,
      city: selectedOrganization.city,
      region: selectedOrganization.region,
      zipCode: selectedOrganization.zipCode ?? "",
      status: selectedOrganization.status,
    });
    setFormMode("edit");
  };

  const closeForm = () => {
    setFormMode(null);
    setFormError("");
  };

  const submitForm = () => {
    setFormError("");
    const requiredFields: Array<[string, string]> = [
      ["name", form.name],
      ["phone", form.phone],
      ["email", form.email],
      ["street address", form.address],
      ["city", form.city],
      ["state or region", form.region],
    ];
    const missing = requiredFields.find(([, value]) => !value.trim());
    if (missing) {
      setFormError(`Enter the organization ${missing[0]}.`);
      return;
    }

    if (formMode === "create") {
      createMutation.mutate(
        {
          data: {
            ...(form.legalName.trim() ? { legalName: form.legalName.trim() } : {}),
            name: form.name.trim(),
            subtype: form.subtype,
            ...(form.contactName.trim() ? { contactName: form.contactName.trim() } : {}),
            phone: form.phone.trim(),
            email: form.email.trim(),
            address: form.address.trim(),
            city: form.city.trim(),
            region: form.region.trim(),
            ...(form.zipCode.trim() ? { zipCode: form.zipCode.trim() } : {}),
          },
        },
        {
          onSuccess: (organization) => {
            closeForm();
            selectOrganization(organization.id);
            queryClient.invalidateQueries({ queryKey: getListPartnerOrganizationsQueryKey() });
            void alertMessage(
              "Organization created",
              `${organization.name} is ready for explicit location linking.`,
            );
          },
          onError: (error) =>
            setFormError(errorMessage(error, "Unable to create this organization.")),
        },
      );
      return;
    }

    if (!selectedOrganization) return;

    updateMutation.mutate(
      {
        organizationId: selectedOrganization.id,
        data: {
          legalName: form.legalName.trim() || null,
          name: form.name.trim(),
          subtype: form.subtype,
          contactName: form.contactName.trim() || null,
          phone: form.phone.trim(),
          email: form.email.trim(),
          address: form.address.trim(),
          city: form.city.trim(),
          region: form.region.trim(),
          zipCode: form.zipCode.trim() || null,
          status: form.status,
        },
      },
      {
        onSuccess: () => {
          closeForm();
          queryClient.invalidateQueries({ queryKey: getListPartnerOrganizationsQueryKey() });
          queryClient.invalidateQueries({
            queryKey: getGetPartnerOrganizationQueryKey(selectedOrganization.id),
          });
          void alertMessage("Organization updated", "Your organization details were saved.");
        },
        onError: (error) =>
          setFormError(errorMessage(error, "Unable to update this organization.")),
      },
    );
  };

  const linkLocation = (shopId: number) => {
    if (!selectedOrganization) return;
    setActionError("");
    linkMutation.mutate(
      { organizationId: selectedOrganization.id, data: { shopId } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({
            queryKey: getListPartnerOrganizationLocationsQueryKey(selectedOrganization.id),
          });
          queryClient.invalidateQueries({ queryKey: getListMyShopsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetShopQueryKey(shopId) });
          queryClient.invalidateQueries({ queryKey: getListAvailableBaysQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListMyBookingsQueryKey() });
          void alertMessage("Location linked", "This existing location now appears in the organization.");
        },
        onError: (error) =>
          setActionError(errorMessage(error, "Unable to link this location.")),
      },
    );
  };

  const refresh = () => {
    void refetchOrganizations();
    void refetchShops();
    if (selectedId != null) void refetchLinkedLocations();
  };

  const isLoading = organizationsLoading || shopsLoading || !isSelectionReady;
  const isSaving = createMutation.isPending || updateMutation.isPending;
  const queryError =
    organizationsError ?? shopsError ?? selectedOrganizationError ?? linkedLocationsError;

  if (!isPartnerRouteActive(pathname, "organizations")) {
    return (
      <View
        style={styles.container}
        {...partnerRouteAccessibilityProps(false)}
      />
    );
  }

  if (isLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
        <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>
          Loading organizations…
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <KeyboardAwareScrollViewCompat
        contentContainerStyle={styles.content}
        bottomOffset={24}
        refreshControl={
          <RefreshControl
            refreshing={organizationsRefetching || linkedLocationsRefetching}
            onRefresh={refresh}
            tintColor={colors.primary}
          />
        }
      >
        <View style={styles.headerRow}>
          <View style={styles.headerCopy}>
            <Text
              accessibilityRole="header"
              accessibilityLabel="Organizations"
              style={[styles.heading, { color: colors.foreground }]}
            >
              Organizations
            </Text>
            <Text style={[styles.subheading, { color: colors.mutedForeground }]}>
              Manage your partner organizations separately from existing locations.
            </Text>
          </View>
          <Pressable
            testID="button-create-organization"
            accessibilityRole="button"
            accessibilityLabel="Create organization"
            onPress={openCreate}
            style={[styles.iconButton, { backgroundColor: colors.primary }]}
          >
            <Feather name="plus" size={20} color={colors.primaryForeground} />
          </Pressable>
        </View>

        {queryError ? (
          <View
            testID="error-organization-query"
            style={[
              styles.notice,
              { backgroundColor: colors.destructive + "14", borderColor: colors.destructive },
            ]}
          >
            <Feather name="alert-circle" size={16} color={colors.destructive} />
            <Text style={[styles.noticeText, { color: colors.destructive }]}>
              {errorMessage(queryError, "Unable to load organization data. Pull to refresh and try again.")}
            </Text>
          </View>
        ) : null}
        {selectionStorageError ? (
          <View
            testID="error-organization-selection-storage"
            style={[
              styles.notice,
              { backgroundColor: colors.destructive + "14", borderColor: colors.destructive },
            ]}
          >
            <Feather name="alert-circle" size={16} color={colors.destructive} />
            <Text style={[styles.noticeText, { color: colors.destructive }]}>
              {selectionStorageError}
            </Text>
          </View>
        ) : null}

        {organizations && organizations.length > 0 ? (
          <View style={styles.organizationList}>
            {organizations.map((organization) => {
              const selected = organization.id === selectedId;
              return (
                <Pressable
                  key={organization.id}
                  testID={`card-organization-${organization.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${selected ? "Selected" : "Select"} ${organization.name}, ${partnerOrganizationSubtypeLabel(organization.subtype)}, ${organization.status}`}
                  accessibilityState={{ selected }}
                  onPress={() => {
                    setActionError("");
                    closeForm();
                    selectOrganization(organization.id);
                  }}
                  style={[
                    styles.organizationCard,
                    {
                      backgroundColor: colors.card,
                      borderColor: selected ? colors.primary : colors.border,
                      borderWidth: selected ? 2 : 1,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.organizationIcon,
                      { backgroundColor: selected ? colors.primary + "20" : colors.muted },
                    ]}
                  >
                    <Feather
                      name={SUBTYPE_ICONS[organization.subtype]}
                      size={19}
                      color={selected ? colors.primary : colors.mutedForeground}
                    />
                  </View>
                  <View style={styles.organizationCopy}>
                    <Text
                      testID={`text-organization-name-${organization.id}`}
                      style={[styles.organizationName, { color: colors.foreground }]}
                      numberOfLines={1}
                    >
                      {organization.name}
                    </Text>
                    <Text style={[styles.organizationSubtype, { color: colors.primary }]}>
                      {partnerOrganizationSubtypeLabel(organization.subtype)}
                    </Text>
                  </View>
                  <View style={styles.organizationStatus}>
                    <View
                      style={[
                        styles.statusDot,
                        {
                          backgroundColor:
                            organization.status === "active" ? "#22C55E" : "#F59E0B",
                        },
                      ]}
                    />
                    <Text
                      testID={`status-organization-${organization.id}`}
                      style={[styles.statusText, { color: colors.mutedForeground }]}
                    >
                      {organization.status}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        ) : (
          <View
            testID="empty-organizations"
            style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <Feather name="briefcase" size={40} color={colors.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
              No organizations yet
            </Text>
            <Text style={[styles.emptyDescription, { color: colors.mutedForeground }]}>
              Create an organization when you are ready. Existing locations stay unchanged until
              you explicitly link them.
            </Text>
            <Pressable
              testID="button-create-first-organization"
              accessibilityRole="button"
              onPress={openCreate}
              style={[styles.primaryButton, { backgroundColor: colors.primary }]}
            >
              <Feather name="plus" size={18} color={colors.primaryForeground} />
              <Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>
                Create organization
              </Text>
            </Pressable>
          </View>
        )}

        {formMode ? (
          <OrganizationFormCard
            colors={colors}
            form={form}
            mode={formMode}
            error={formError}
            isSaving={isSaving}
            onChange={setField}
            onCancel={closeForm}
            onSubmit={submitForm}
          />
        ) : selectedOrganization ? (
          <View style={styles.detailSection}>
            <View style={styles.sectionHeadingRow}>
              <View style={styles.sectionHeadingCopy}>
                <Text
                  accessibilityRole="header"
                  accessibilityLabel={`Selected organization: ${selectedOrganization.name}`}
                  style={[styles.sectionTitle, { color: colors.foreground }]}
                >
                  {selectedOrganization.name}
                </Text>
                <Text style={[styles.sectionDescription, { color: colors.mutedForeground }]}>
                  {partnerOrganizationSubtypeLabel(selectedOrganization.subtype)} ·{" "}
                  {selectedOrganization.status}
                </Text>
              </View>
              <Pressable
                testID="button-edit-organization"
                accessibilityRole="button"
                onPress={openEdit}
                style={[styles.outlineButton, { borderColor: colors.primary }]}
              >
                <Feather name="edit-2" size={15} color={colors.primary} />
                <Text style={[styles.outlineButtonText, { color: colors.primary }]}>Edit</Text>
              </Pressable>
            </View>

            <View style={[styles.detailCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text testID="text-selected-organization-subtype" style={[styles.detailLineStrong, { color: colors.primary }]}>
                {partnerOrganizationSubtypeLabel(selectedOrganization.subtype)}
              </Text>
              {selectedOrganization.contactName ? (
                <Text style={[styles.detailLine, { color: colors.foreground }]}>
                  {selectedOrganization.contactName}
                </Text>
              ) : null}
              {organizationLegalName(selectedOrganization) &&
              organizationLegalName(selectedOrganization) !== selectedOrganization.name ? (
                <Text testID="text-selected-organization-legal-name" style={[styles.detailLine, { color: colors.foreground }]}>
                  Legal name: {organizationLegalName(selectedOrganization)}
                </Text>
              ) : null}
              <Text style={[styles.detailLine, { color: colors.mutedForeground }]}>
                {selectedOrganization.phone} · {selectedOrganization.email}
              </Text>
              <Text style={[styles.detailLine, { color: colors.mutedForeground }]}>
                {displayAddress(selectedOrganization)}
              </Text>
            </View>

            <View style={styles.locationsHeader}>
              <View style={styles.sectionHeadingCopy}>
                <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                  Linked locations
                </Text>
                <Text style={[styles.sectionDescription, { color: colors.mutedForeground }]}>
                  Existing owned locations linked explicitly to this organization.
                </Text>
              </View>
              <Text testID="text-linked-location-count" style={[styles.countText, { color: colors.primary }]}>
                {linkedLocations?.length ?? 0}
              </Text>
            </View>

            {selectedOrganization.status !== "active" ? (
              <View style={[styles.notice, { backgroundColor: colors.accent, borderColor: colors.border }]}>
                <Feather name="info" size={16} color={colors.accentForeground} />
                <Text style={[styles.noticeText, { color: colors.accentForeground }]}>
                  Activate this organization before linking another location.
                </Text>
              </View>
            ) : null}

            {actionError ? (
              <Text testID="error-organization-action" style={[styles.errorText, { color: colors.destructive }]}>
                {actionError}
              </Text>
            ) : null}

            {linkedLocationsLoading ? (
              <ActivityIndicator color={colors.primary} />
            ) : linkedLocations && linkedLocations.length > 0 ? (
              <View style={styles.locationList}>
                {linkedLocations.map((location) => (
                  <Pressable
                    key={location.id}
                    testID={`card-linked-location-${location.id}`}
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${location.name}`}
                    onPress={() => router.push(`/shop/${location.id}`)}
                    style={[styles.locationCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                  >
                    <View style={[styles.locationIcon, { backgroundColor: colors.primary + "18" }]}>
                      <Feather name="map-pin" size={16} color={colors.primary} />
                    </View>
                    <View style={styles.locationCopy}>
                      <Text style={[styles.locationName, { color: colors.foreground }]}>
                        {location.name}
                      </Text>
                      <Text style={[styles.locationAddress, { color: colors.mutedForeground }]} numberOfLines={2}>
                        {[location.address, location.city, location.region, location.zipCode]
                          .filter(Boolean)
                          .join(", ")}
                      </Text>
                    </View>
                    <Text style={[styles.linkedLabel, { color: "#22C55E" }]}>Linked</Text>
                    <Feather name="chevron-right" size={17} color={colors.mutedForeground} />
                  </Pressable>
                ))}
              </View>
            ) : (
              <View style={[styles.inlineEmpty, { borderColor: colors.border }]}>
                <Text style={[styles.inlineEmptyText, { color: colors.mutedForeground }]}>
                  No locations linked to this organization yet.
                </Text>
              </View>
            )}

            <Text style={[styles.subsectionTitle, { color: colors.foreground }]}>
              Link an existing location
            </Text>
            <Text style={[styles.sectionDescription, { color: colors.mutedForeground }]}>
              Only owned locations without an organization can be linked. Linking never changes
              the location’s existing classification.
            </Text>

            {unlinkedLocations.length > 0 ? (
              <View style={styles.locationList}>
                {unlinkedLocations.map((location) => (
                  <View
                    key={location.id}
                    testID={`card-unlinked-location-${location.id}`}
                    style={[styles.locationCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                  >
                    <View style={[styles.locationIcon, { backgroundColor: colors.muted }]}>
                      <Feather name="map-pin" size={16} color={colors.mutedForeground} />
                    </View>
                    <View style={styles.locationCopy}>
                      <Text style={[styles.locationName, { color: colors.foreground }]}>
                        {location.name}
                      </Text>
                      <Text style={[styles.locationAddress, { color: colors.mutedForeground }]} numberOfLines={1}>
                        {[location.city, location.region].filter(Boolean).join(", ")}
                      </Text>
                    </View>
                    <Pressable
                      testID={`button-link-location-${location.id}`}
                      accessibilityRole="button"
                      accessibilityLabel={`Link ${location.name}`}
                      accessibilityState={{
                        disabled:
                          selectedOrganization.status !== "active" || linkMutation.isPending,
                      }}
                      onPress={() => linkLocation(location.id)}
                      disabled={
                        selectedOrganization.status !== "active" || linkMutation.isPending
                      }
                      style={[
                        styles.smallButton,
                        {
                          borderColor: colors.primary,
                          opacity:
                            selectedOrganization.status !== "active" || linkMutation.isPending
                              ? 0.5
                              : 1,
                        },
                      ]}
                    >
                      {linkMutation.isPending ? (
                        <ActivityIndicator size="small" color={colors.primary} />
                      ) : (
                        <Text style={[styles.smallButtonText, { color: colors.primary }]}>Link</Text>
                      )}
                    </Pressable>
                  </View>
                ))}
              </View>
            ) : (
              <View style={[styles.inlineEmpty, { borderColor: colors.border }]}>
                <Text style={[styles.inlineEmptyText, { color: colors.mutedForeground }]}>
                  There are no unlinked owned locations available.
                </Text>
              </View>
            )}

            {otherOrganizationLocations.length > 0 ? (
              <Text style={[styles.footnote, { color: colors.mutedForeground }]}>
                {otherOrganizationLocations.length} location
                {otherOrganizationLocations.length === 1 ? "" : "s"} already linked to another
                organization {otherOrganizationLocations.length === 1 ? "is" : "are"} not available
                for reassignment.
              </Text>
            ) : null}
          </View>
        ) : null}

        <Pressable
          testID="link-back-to-locations"
          accessibilityRole="button"
          onPress={() => router.push("/(shop-owner)")}
          style={styles.backLink}
        >
          <Feather name="arrow-left" size={15} color={colors.primary} />
          <Text style={[styles.backLinkText, { color: colors.primary }]}>Back to locations</Text>
        </Pressable>
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

type OrganizationFormCardProps = {
  colors: ReturnType<typeof useColors>;
  form: OrganizationForm;
  mode: Exclude<FormMode, null>;
  error: string;
  isSaving: boolean;
  onChange: <K extends keyof OrganizationForm>(field: K, value: OrganizationForm[K]) => void;
  onCancel: () => void;
  onSubmit: () => void;
};

function OrganizationFormCard({
  colors,
  form,
  mode,
  error,
  isSaving,
  onChange,
  onCancel,
  onSubmit,
}: OrganizationFormCardProps) {
  return (
    <View style={[styles.formCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.sectionHeadingRow}>
        <View style={styles.sectionHeadingCopy}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
            {mode === "create" ? "Create organization" : "Edit organization"}
          </Text>
          <Text style={[styles.sectionDescription, { color: colors.mutedForeground }]}>
            Use one canonical organization subtype. Existing locations are never inferred or
            linked automatically.
          </Text>
        </View>
        <Pressable
          testID="button-cancel-organization-form"
          accessibilityRole="button"
              accessibilityLabel="Close organization form"
          onPress={onCancel}
          style={styles.closeButton}
        >
          <Feather name="x" size={20} color={colors.mutedForeground} />
        </Pressable>
      </View>

      <Text style={[styles.label, { color: colors.mutedForeground }]}>ORGANIZATION TYPE *</Text>
      <View style={styles.subtypeList}>
        {PARTNER_ORGANIZATION_SUBTYPE_OPTIONS.map((option) => {
          const selected = form.subtype === option.value;
          return (
            <Pressable
              key={option.value}
              testID={`button-subtype-${option.value}`}
              accessibilityRole="button"
              accessibilityLabel={`${selected ? "Selected" : "Select"} organization type ${option.label}`}
              accessibilityState={{ selected }}
              onPress={() => onChange("subtype", option.value)}
              style={[
                styles.subtypeOption,
                {
                  backgroundColor: selected ? colors.primary + "14" : colors.background,
                  borderColor: selected ? colors.primary : colors.border,
                },
              ]}
            >
              <Feather
                name={SUBTYPE_ICONS[option.value]}
                size={17}
                color={selected ? colors.primary : colors.mutedForeground}
              />
              <View style={styles.subtypeCopy}>
                <Text style={[styles.subtypeLabel, { color: selected ? colors.primary : colors.foreground }]}>
                  {option.label}
                </Text>
                <Text style={[styles.subtypeDescription, { color: colors.mutedForeground }]}>
                  {option.description}
                </Text>
              </View>
              {selected ? <Feather name="check-circle" size={17} color={colors.primary} /> : null}
            </Pressable>
          );
        })}
      </View>

      <OrganizationInput
        colors={colors}
        testID="input-organization-legal-name"
        label="LEGAL BUSINESS NAME"
        placeholder="Optional legal name"
        value={form.legalName}
        onChangeText={(value) => onChange("legalName", value)}
      />
      <OrganizationInput
        colors={colors}
        testID="input-organization-name"
        label="NAME *"
        placeholder="Northstar Service Group"
        value={form.name}
        onChangeText={(value) => onChange("name", value)}
      />
      <OrganizationInput
        colors={colors}
        testID="input-organization-contact-name"
        label="CONTACT NAME"
        placeholder="Optional contact"
        value={form.contactName}
        onChangeText={(value) => onChange("contactName", value)}
      />
      <View style={styles.inputRow}>
        <View style={styles.inputHalf}>
          <OrganizationInput
            colors={colors}
            testID="input-organization-phone"
            label="PHONE *"
            placeholder="+1 555 0100"
            keyboardType="phone-pad"
            value={form.phone}
            onChangeText={(value) => onChange("phone", value)}
          />
        </View>
        <View style={styles.inputHalf}>
          <OrganizationInput
            colors={colors}
            testID="input-organization-email"
            label="EMAIL *"
            placeholder="ops@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
            value={form.email}
            onChangeText={(value) => onChange("email", value)}
          />
        </View>
      </View>
      <OrganizationInput
        colors={colors}
        testID="input-organization-address"
        label="STREET ADDRESS *"
        placeholder="100 Main Street"
        value={form.address}
        onChangeText={(value) => onChange("address", value)}
      />
      <View style={styles.inputRow}>
        <View style={styles.cityInput}>
          <OrganizationInput
            colors={colors}
            testID="input-organization-city"
            label="CITY *"
            placeholder="Brooklyn"
            value={form.city}
            onChangeText={(value) => onChange("city", value)}
          />
        </View>
        <View style={styles.regionInput}>
          <OrganizationInput
            colors={colors}
            testID="input-organization-region"
            label="STATE / REGION *"
            placeholder="NY"
            autoCapitalize="characters"
            value={form.region}
            onChangeText={(value) => onChange("region", value)}
          />
        </View>
        <View style={styles.zipInput}>
          <OrganizationInput
            colors={colors}
            testID="input-organization-zip"
            label="ZIP"
            placeholder="11201"
            value={form.zipCode}
            onChangeText={(value) => onChange("zipCode", value)}
          />
        </View>
      </View>

      {mode === "edit" ? (
        <>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>STATUS</Text>
          <View style={styles.statusOptions}>
            {(["active", "inactive"] as const).map((status) => {
              const selected = form.status === status;
              return (
                <Pressable
                  key={status}
                  testID={`button-organization-status-${status}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${selected ? "Selected" : "Select"} organization status ${status}`}
                  accessibilityState={{ selected }}
                  onPress={() => onChange("status", status)}
                  style={[
                    styles.statusOption,
                    {
                      borderColor: selected ? colors.primary : colors.border,
                      backgroundColor: selected ? colors.primary + "14" : colors.background,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.statusDot,
                      { backgroundColor: status === "active" ? "#22C55E" : "#F59E0B" },
                    ]}
                  />
                  <Text style={[styles.statusOptionText, { color: selected ? colors.primary : colors.foreground }]}>
                    {status}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </>
      ) : null}

      {error ? (
        <Text testID="error-organization-form" style={[styles.errorText, { color: colors.destructive }]}>
          {error}
        </Text>
      ) : null}
      <Pressable
        testID={mode === "create" ? "button-submit-create-organization" : "button-submit-edit-organization"}
        accessibilityRole="button"
        onPress={onSubmit}
        disabled={isSaving}
        style={[styles.primaryButton, { backgroundColor: colors.primary, opacity: isSaving ? 0.6 : 1 }]}
      >
        {isSaving ? (
          <ActivityIndicator color={colors.primaryForeground} />
        ) : (
          <>
            <Feather name="check" size={18} color={colors.primaryForeground} />
            <Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>
              {mode === "create" ? "Create organization" : "Save changes"}
            </Text>
          </>
        )}
      </Pressable>
    </View>
  );
}

type OrganizationInputProps = {
  colors: ReturnType<typeof useColors>;
  testID: string;
  label: string;
  placeholder: string;
  value: string;
  onChangeText: (value: string) => void;
  keyboardType?: "default" | "email-address" | "phone-pad";
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
};

function OrganizationInput({
  colors,
  testID,
  label,
  placeholder,
  value,
  onChangeText,
  keyboardType = "default",
  autoCapitalize = "sentences",
}: OrganizationInputProps) {
  return (
    <View style={styles.inputGroup}>
      <Text style={[styles.label, { color: colors.mutedForeground }]}>{label}</Text>
      <TextInput
        testID={testID}
        accessibilityLabel={label}
        style={[styles.input, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, paddingBottom: 120, gap: 14 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  loadingText: { fontSize: 13 },
  headerRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  headerCopy: { flex: 1 },
  heading: { fontSize: 24, fontWeight: "800" },
  subheading: { fontSize: 13, lineHeight: 19, marginTop: 5 },
  iconButton: { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  organizationList: { gap: 9 },
  organizationCard: { minHeight: 68, borderRadius: 14, padding: 12, flexDirection: "row", alignItems: "center", gap: 11 },
  organizationIcon: { width: 38, height: 38, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  organizationCopy: { flex: 1, minWidth: 0 },
  organizationName: { fontSize: 15, fontWeight: "700" },
  organizationSubtype: { fontSize: 12, fontWeight: "700", marginTop: 3 },
  organizationStatus: { flexDirection: "row", alignItems: "center", gap: 5 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 11, textTransform: "capitalize", fontWeight: "600" },
  emptyCard: { borderWidth: 1, borderStyle: "dashed", borderRadius: 15, alignItems: "center", padding: 24 },
  emptyTitle: { fontSize: 17, fontWeight: "700", marginTop: 12 },
  emptyDescription: { textAlign: "center", fontSize: 13, lineHeight: 19, marginTop: 5, maxWidth: 320 },
  detailSection: { gap: 11 },
  sectionHeadingRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  sectionHeadingCopy: { flex: 1, minWidth: 0 },
  sectionTitle: { fontSize: 17, fontWeight: "800" },
  sectionDescription: { fontSize: 12, lineHeight: 17, marginTop: 3 },
  outlineButton: { height: 36, borderRadius: 9, borderWidth: 1, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 5 },
  outlineButtonText: { fontSize: 13, fontWeight: "700" },
  detailCard: { borderWidth: 1, borderRadius: 13, padding: 13, gap: 4 },
  detailLineStrong: { fontSize: 12, fontWeight: "800" },
  detailLine: { fontSize: 13, lineHeight: 18 },
  locationsHeader: { marginTop: 5, flexDirection: "row", alignItems: "flex-start", gap: 10 },
  countText: { fontSize: 18, fontWeight: "800" },
  notice: { borderWidth: 1, borderRadius: 10, padding: 10, flexDirection: "row", alignItems: "center", gap: 8 },
  noticeText: { flex: 1, fontSize: 12, lineHeight: 17 },
  errorText: { fontSize: 13, lineHeight: 18 },
  locationList: { gap: 8 },
  locationCard: { minHeight: 61, borderWidth: 1, borderRadius: 12, padding: 10, flexDirection: "row", alignItems: "center", gap: 9 },
  locationIcon: { width: 32, height: 32, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  locationCopy: { flex: 1, minWidth: 0 },
  locationName: { fontSize: 13, fontWeight: "700" },
  locationAddress: { fontSize: 11, lineHeight: 15, marginTop: 2 },
  linkedLabel: { fontSize: 11, fontWeight: "700" },
  inlineEmpty: { borderWidth: 1, borderStyle: "dashed", borderRadius: 10, padding: 12 },
  inlineEmptyText: { fontSize: 12, textAlign: "center" },
  subsectionTitle: { fontSize: 15, fontWeight: "800", marginTop: 5 },
  smallButton: { minWidth: 54, height: 32, borderRadius: 8, borderWidth: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 9 },
  smallButtonText: { fontSize: 12, fontWeight: "800" },
  footnote: { fontSize: 11, lineHeight: 16 },
  backLink: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 8 },
  backLinkText: { fontSize: 13, fontWeight: "700" },
  formCard: { borderWidth: 1, borderRadius: 15, padding: 15, gap: 8 },
  closeButton: { padding: 3 },
  label: { fontSize: 10, fontWeight: "800", letterSpacing: 0.9, marginTop: 4, marginBottom: 3 },
  subtypeList: { gap: 7 },
  subtypeOption: { minHeight: 54, borderWidth: 1, borderRadius: 11, padding: 10, flexDirection: "row", alignItems: "center", gap: 9 },
  subtypeCopy: { flex: 1, minWidth: 0 },
  subtypeLabel: { fontSize: 13, fontWeight: "700" },
  subtypeDescription: { fontSize: 11, lineHeight: 15, marginTop: 2 },
  inputGroup: { gap: 0 },
  inputRow: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  inputHalf: { flex: 1, minWidth: 0 },
  cityInput: { flex: 2, minWidth: 0 },
  regionInput: { flex: 1.2, minWidth: 0 },
  zipInput: { flex: 1.1, minWidth: 0 },
  input: { height: 44, borderWidth: 1, borderRadius: 10, paddingHorizontal: 11, fontSize: 14 },
  statusOptions: { flexDirection: "row", gap: 8 },
  statusOption: { flex: 1, minHeight: 40, borderWidth: 1, borderRadius: 9, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 7 },
  statusOptionText: { fontSize: 13, textTransform: "capitalize", fontWeight: "700" },
  primaryButton: { minHeight: 46, borderRadius: 11, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, marginTop: 5 },
  primaryButtonText: { fontSize: 14, fontWeight: "800" },
});