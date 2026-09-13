import {
  View, Text, StyleSheet, Pressable, ActivityIndicator, TextInput, ScrollView,
} from "react-native";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import {
  useGetShop, useCreateShopBay, useUpdateShop, useUpdateBay,
  getGetShopQueryKey, getListMyShopsQueryKey, getListShopBaysQueryKey,
  getListAvailableBaysQueryKey, getListMyBookingsQueryKey,
  CreateBayBodyAllowedJobCategoriesItem, CreateBayBodyMinMechanicTier,
  UpdateBayBodyStatus, UpdateShopBodyStatus, type Bay, type BayAvailabilityConfig,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, Stack } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useState } from "react";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { alertMessage } from "@/utils/confirm";

const CATEGORIES: CreateBayBodyAllowedJobCategoriesItem[] = ["repair", "diagnostic", "maintenance", "detailing"];
const TIERS: CreateBayBodyMinMechanicTier[] = ["detailer", "technician", "senior", "advanced", "master"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type AvailabilityWindow = {
  dayOfWeek: number;
  open: string;
  close: string;
  enabled: boolean;
};

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function defaultAvailability(): AvailabilityWindow[] {
  return WEEKDAYS.map((_, dayOfWeek) => ({
    dayOfWeek,
    open: "08:00",
    close: "18:00",
    enabled: false,
  }));
}

function readAvailability(value: BayAvailabilityConfig): AvailabilityWindow[] {
  const next = defaultAvailability();
  for (const row of value.weekly) {
    next[row.dayOfWeek] = {
      dayOfWeek: row.dayOfWeek,
      open: row.open,
      close: row.close,
      enabled: true,
    };
  }
  return next;
}

function validateAvailability(windows: AvailabilityWindow[]): string | null {
  for (const day of windows) {
    if (!day.enabled) continue;
    if (!TIME_PATTERN.test(day.open) || !TIME_PATTERN.test(day.close)) {
      return `${WEEKDAYS[day.dayOfWeek]} availability must use HH:mm times.`;
    }
    if (day.open === day.close) {
      return `${WEEKDAYS[day.dayOfWeek]} availability must span a non-zero interval.`;
    }
  }
  return null;
}

export default function ShopDetailScreen() {
  const colors = useColors();
  const { user } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const shopId = parseInt(id, 10);
  const queryClient = useQueryClient();

  const { data: shop, isLoading } = useGetShop(shopId);
  const createBayMutation = useCreateShopBay();
  const updateShopMutation = useUpdateShop();
  const updateBayMutation = useUpdateBay();

  const [showForm, setShowForm] = useState(false);
  const [showLocationForm, setShowLocationForm] = useState(false);
  const [name, setName] = useState("");
  const [hourlyRate, setHourlyRate] = useState("");
  const [equipment, setEquipment] = useState("");
  const [allowedCats, setAllowedCats] = useState<CreateBayBodyAllowedJobCategoriesItem[]>(["repair", "maintenance"]);
  const [minTier, setMinTier] = useState<CreateBayBodyMinMechanicTier>("technician");
  const [autoApprove, setAutoApprove] = useState(false);
  const [availability, setAvailability] = useState<AvailabilityWindow[]>(defaultAvailability);
  const [error, setError] = useState("");
  const [locationError, setLocationError] = useState("");
  const [editingBayId, setEditingBayId] = useState<number | null>(null);
  const [locationName, setLocationName] = useState("");
  const [locationAddress, setLocationAddress] = useState("");
  const [locationCity, setLocationCity] = useState("");
  const [locationRegion, setLocationRegion] = useState("");
  const [locationZipCode, setLocationZipCode] = useState("");
  const [locationPhone, setLocationPhone] = useState("");
  const [locationStatus, setLocationStatus] = useState<UpdateShopBodyStatus>("active");

  const canManageShop = !!user && user.role === "shop_owner" && user.id === shop?.ownerId;

  const toggleCat = (c: CreateBayBodyAllowedJobCategoriesItem) =>
    setAllowedCats((prev) => prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]);

  const invalidateShopData = () => {
    queryClient.invalidateQueries({ queryKey: getGetShopQueryKey(shopId) });
    queryClient.invalidateQueries({ queryKey: getListMyShopsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListShopBaysQueryKey(shopId) });
    queryClient.invalidateQueries({ queryKey: getListAvailableBaysQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListMyBookingsQueryKey() });
  };

  const openLocationEdit = () => {
    if (!shop || !canManageShop) return;
    setLocationError("");
    setLocationName(shop.name);
    setLocationAddress(shop.address);
    setLocationCity(shop.city);
    setLocationRegion(shop.region);
    setLocationZipCode(shop.zipCode);
    setLocationPhone(shop.phone ?? "");
    setLocationStatus(shop.status);
    setShowLocationForm(true);
  };

  const submitLocationEdit = () => {
    setLocationError("");
    if (!locationName.trim() || !locationAddress.trim() || !locationCity.trim() ||
      !locationRegion.trim() || !locationZipCode.trim()) {
      setLocationError("Name, street, city, state, and ZIP are all required.");
      return;
    }
    updateShopMutation.mutate(
      {
        shopId,
        data: {
          name: locationName.trim(),
          address: locationAddress.trim(),
          city: locationCity.trim(),
          region: locationRegion.trim(),
          zipCode: locationZipCode.trim(),
          phone: locationPhone.trim() || undefined,
          status: locationStatus,
        },
      },
      {
        onSuccess: () => {
          setShowLocationForm(false);
          invalidateShopData();
          void alertMessage("Location updated", "The physical location details were saved.");
        },
        onError: (e: any) => setLocationError(e?.message ?? "Failed to update location."),
      },
    );
  };

  const resetBayForm = () => {
    setName("");
    setHourlyRate("");
    setEquipment("");
    setAllowedCats(["repair", "maintenance"]);
    setMinTier("technician");
    setAutoApprove(false);
    setAvailability(defaultAvailability());
  };

  const openBayEdit = (bay: Bay) => {
    if (!canManageShop) return;
    setError("");
    setEditingBayId(bay.id);
    setName(bay.name);
    setHourlyRate(String(bay.hourlyRate));
    setEquipment(bay.equipment.join(", "));
    setAllowedCats(bay.allowedJobCategories as CreateBayBodyAllowedJobCategoriesItem[]);
    setMinTier(bay.minMechanicTier as CreateBayBodyMinMechanicTier);
    setAutoApprove(bay.autoApprove);
    setAvailability(readAvailability(bay.availabilityConfig));
    setBayStatus(bay.status);
  };

  const [bayStatus, setBayStatus] = useState<UpdateBayBodyStatus>("active");

  const closeBayForm = () => {
    setEditingBayId(null);
    setShowForm(false);
    setError("");
    resetBayForm();
  };

  const submitBayUpdate = () => {
    setError("");
    const rateNum = parseFloat(hourlyRate);
    if (!name.trim()) { setError("Bay name is required."); return; }
    if (!Number.isFinite(rateNum) || rateNum < 0) { setError("Hourly rate must be a non-negative number."); return; }
    if (allowedCats.length === 0) { setError("Select at least one allowed job category."); return; }
    const availabilityError = validateAvailability(availability);
    if (availabilityError) { setError(availabilityError); return; }
    if (editingBayId == null) return;
    const availabilityConfig: BayAvailabilityConfig = {
      timezone: "UTC",
      weekly: availability.filter((day) => day.enabled).map(({ dayOfWeek, open, close }) => ({ dayOfWeek, open, close })),
    };
    updateBayMutation.mutate(
      {
        bayId: editingBayId,
        data: {
          name: name.trim(),
          hourlyRate: rateNum,
          equipment: equipment.split(",").map((s) => s.trim()).filter(Boolean),
          allowedJobCategories: allowedCats,
          minMechanicTier: minTier,
          autoApprove,
          status: bayStatus,
            availabilityConfig,
          },
      },
      {
        onSuccess: () => {
          closeBayForm();
          invalidateShopData();
          void alertMessage("Bay updated", "The rentable workspace configuration was saved.");
        },
        onError: (e: any) => setError(e?.message ?? "Failed to update bay."),
      },
    );
  };

  const submit = () => {
    setError("");
    const rateNum = parseFloat(hourlyRate);
    if (!name.trim()) { setError("Bay name is required."); return; }
    if (!Number.isFinite(rateNum) || rateNum < 0) { setError("Hourly rate must be a non-negative number."); return; }
    if (allowedCats.length === 0) { setError("Select at least one allowed job category."); return; }
    const availabilityError = validateAvailability(availability);
    if (availabilityError) { setError(availabilityError); return; }
    const equipList = equipment.split(",").map((s) => s.trim()).filter(Boolean);
    const availabilityConfig: BayAvailabilityConfig = {
      timezone: "UTC",
      weekly: availability.filter((day) => day.enabled).map(({ dayOfWeek, open, close }) => ({ dayOfWeek, open, close })),
    };
    createBayMutation.mutate(
      {
        shopId,
        data: {
          name: name.trim(),
          hourlyRate: rateNum,
          equipment: equipList,
          allowedJobCategories: allowedCats,
          minMechanicTier: minTier,
          autoApprove,
            availabilityConfig,
          },
      },
      {
        onSuccess: () => {
          closeBayForm();
          invalidateShopData();
          void alertMessage("Bay added", "Mechanics can now book this bay.");
        },
        onError: (e: any) => setError(e?.message ?? "Failed to create bay."),
      },
    );
  };

  if (isLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (!shop) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.destructive }}>Shop not found.</Text>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: shop.name,
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.foreground,
          headerShown: true,
        }}
      />
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <KeyboardAwareScrollViewCompat
          contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
          bottomOffset={20}
        >
          <View style={[styles.headerCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.headerRow}>
              <View style={{ flex: 1 }}>
                {canManageShop ? (
                  <Text style={[styles.eyebrow, { color: colors.primary }]}>PHYSICAL LOCATION</Text>
                ) : null}
                <Text style={[styles.shopName, { color: colors.foreground }]}>{shop.name}</Text>
              </View>
              {canManageShop ? (
                <Pressable
                  testID="button-edit-location"
                  accessibilityRole="button"
                  onPress={openLocationEdit}
                  style={[styles.outlineBtn, { borderColor: colors.primary }]}
                >
                  <Feather name="edit-2" size={14} color={colors.primary} />
                  <Text style={[styles.outlineBtnText, { color: colors.primary }]}>Edit</Text>
                </Pressable>
              ) : null}
            </View>
            <Text style={[styles.shopAddr, { color: colors.mutedForeground }]}>
              {shop.address}, {shop.city}, {shop.region} {shop.zipCode}
            </Text>
            {shop.phone ? (
              <Text style={[styles.shopAddr, { color: colors.mutedForeground }]}>📞 {shop.phone}</Text>
            ) : null}
            {shop.insuranceCarrier ? (
              <Text style={[styles.shopAddr, { color: colors.mutedForeground }]}>
                Insurance: {shop.insuranceCarrier}{shop.insurancePolicyNumber ? ` (#${shop.insurancePolicyNumber})` : ""}
              </Text>
            ) : null}
            {canManageShop ? (
              <Text style={[styles.contextText, { color: colors.mutedForeground }]}>
                {shop.organizationId != null
                  ? "Linked organization · this location is the address where workspaces are rented."
                  : "No organization linked · this location remains independently managed until you explicitly link it."}
              </Text>
            ) : null}
          </View>

          {showLocationForm && canManageShop ? (
            <View style={[styles.formCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.formHeaderRow}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.formTitle, { color: colors.foreground }]}>Edit physical location</Text>
                  <Text style={[styles.formHint, { color: colors.mutedForeground }]}>
                    This updates the location record, not the organization entity or its rentable workspaces.
                  </Text>
                </View>
                <Pressable
                  testID="button-cancel-location-edit"
                  accessibilityRole="button"
                  onPress={() => setShowLocationForm(false)}
                >
                  <Feather name="x" size={20} color={colors.mutedForeground} />
                </Pressable>
              </View>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>NAME *</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
                value={locationName}
                onChangeText={setLocationName}
                placeholder="Location name"
                placeholderTextColor={colors.mutedForeground}
              />
              <Text style={[styles.label, { color: colors.mutedForeground }]}>STREET ADDRESS *</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
                value={locationAddress}
                onChangeText={setLocationAddress}
                placeholder="123 Garage Way"
                placeholderTextColor={colors.mutedForeground}
              />
              <View style={{ flexDirection: "row", gap: 10 }}>
                <View style={{ flex: 2 }}>
                  <Text style={[styles.label, { color: colors.mutedForeground }]}>CITY *</Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
                    value={locationCity}
                    onChangeText={setLocationCity}
                    placeholder="Austin"
                    placeholderTextColor={colors.mutedForeground}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.label, { color: colors.mutedForeground }]}>STATE *</Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
                    value={locationRegion}
                    onChangeText={setLocationRegion}
                    placeholder="TX"
                    placeholderTextColor={colors.mutedForeground}
                    autoCapitalize="characters"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.label, { color: colors.mutedForeground }]}>ZIP *</Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
                    value={locationZipCode}
                    onChangeText={setLocationZipCode}
                    placeholder="78701"
                    placeholderTextColor={colors.mutedForeground}
                  />
                </View>
              </View>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>PHONE</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
                value={locationPhone}
                onChangeText={setLocationPhone}
                placeholder="(555) 555-1234"
                placeholderTextColor={colors.mutedForeground}
                keyboardType="phone-pad"
              />
              <Text style={[styles.label, { color: colors.mutedForeground }]}>LOCATION STATUS</Text>
              <View style={styles.chipsRow}>
                {(["active", "inactive"] as UpdateShopBodyStatus[]).map((status) => {
                  const selected = locationStatus === status;
                  return (
                    <Pressable
                      key={status}
                      style={[styles.chip, {
                        backgroundColor: selected ? colors.primary : colors.background,
                        borderColor: selected ? colors.primary : colors.border,
                      }]}
                      onPress={() => setLocationStatus(status)}
                    >
                      <Text style={{ color: selected ? "white" : colors.foreground, fontWeight: "600", fontSize: 13 }}>
                        {status}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {locationError ? <Text style={[styles.error, { color: colors.destructive }]}>{locationError}</Text> : null}
              <Pressable
                testID="button-save-location"
                accessibilityRole="button"
                style={[styles.submitBtn, { backgroundColor: colors.primary }, updateShopMutation.isPending && { opacity: 0.6 }]}
                onPress={submitLocationEdit}
                disabled={updateShopMutation.isPending}
              >
                {updateShopMutation.isPending
                  ? <ActivityIndicator color="white" />
                  : <Text style={styles.submitText}>Save Location</Text>}
              </Pressable>
            </View>
          ) : null}

          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
            {canManageShop ? "Rentable workspaces · Service Bays" : "Service Bays"} ({shop.bays.length})
          </Text>

          {shop.bays.length === 0 ? (
            <View style={[styles.empty, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Feather name="grid" size={40} color={colors.mutedForeground} />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No bays yet</Text>
              <Text style={[styles.emptyDesc, { color: colors.mutedForeground }]}>
                {canManageShop ? "Add your first rentable workspace below." : "This location has no rentable workspaces yet."}
              </Text>
            </View>
          ) : (
            <View style={{ gap: 10 }}>
              {shop.bays.map((b) => (
                <View key={b.id} style={[styles.bayCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View style={styles.bayHeader}>
                    <View style={{ flex: 1 }}>
                      {canManageShop ? (
                        <Text style={[styles.bayLabel, { color: colors.primary }]}>RENTABLE WORKSPACE</Text>
                      ) : null}
                      <Text style={[styles.bayName, { color: colors.foreground }]}>{b.name}</Text>
                    </View>
                    <View style={[styles.statusChip, {
                      backgroundColor: b.status === "active" ? "#22C55E20" : "#F59E0B20",
                    }]}>
                      <Text style={[styles.statusChipText, {
                        color: b.status === "active" ? "#15803d" : "#A16207",
                      }]}>{b.status}</Text>
                    </View>
                    {canManageShop ? (
                      <Pressable
                        testID={`button-edit-bay-${b.id}`}
                        accessibilityRole="button"
                        onPress={() => openBayEdit(b)}
                        style={[styles.smallOutlineBtn, { borderColor: colors.primary }]}
                      >
                        <Feather name="edit-2" size={13} color={colors.primary} />
                        <Text style={[styles.smallOutlineBtnText, { color: colors.primary }]}>Edit</Text>
                      </Pressable>
                    ) : null}
                  </View>
                  <Text style={[styles.bayLine, { color: colors.foreground }]}>
                    ${b.hourlyRate.toFixed(2)}/hr · min tier: <Text style={{ fontWeight: "700" }}>{b.minMechanicTier}</Text>
                  </Text>
                  <Text style={[styles.bayLine, { color: colors.mutedForeground }]}>
                    Allowed: {b.allowedJobCategories.join(", ") || "—"}
                  </Text>
                  {(b.equipment.length > 0) && (
                    <Text style={[styles.bayLine, { color: colors.mutedForeground }]}>
                      Equipment: {b.equipment.join(", ")}
                    </Text>
                  )}
                  {b.autoApprove ? (
                    <Text style={[styles.bayLine, { color: colors.primary }]}>
                      Auto-confirm booking requests
                    </Text>
                  ) : null}
                </View>
              ))}
            </View>
          )}

          {canManageShop ? (
            <Pressable
              style={[styles.toggleBtn, { borderColor: colors.primary, backgroundColor: showForm || editingBayId != null ? colors.card : colors.primary + "12" }]}
              onPress={() => {
                if (showForm || editingBayId != null) closeBayForm();
                else {
                  setError("");
                  resetBayForm();
                  setBayStatus("active");
                  setShowForm(true);
                }
              }}
            >
              <Feather name={showForm || editingBayId != null ? "x" : "plus"} size={18} color={colors.primary} />
              <Text style={[styles.toggleBtnText, { color: colors.primary }]}>
                {showForm || editingBayId != null ? "Cancel" : "Add a Bay"}
              </Text>
            </Pressable>
          ) : null}

          {(showForm || editingBayId != null) && canManageShop && (
            <View style={[styles.formCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.formTitle, { color: colors.foreground }]}>
                {editingBayId != null ? "Edit rentable workspace" : "New rentable workspace"}
              </Text>
              {editingBayId != null ? (
                <Text style={[styles.formHint, { color: colors.mutedForeground }]}>
                  Changes apply to this bay only. Existing booking times and rate snapshots are not rewritten.
                </Text>
              ) : null}

              <Text style={[styles.label, { color: colors.mutedForeground }]}>NAME *</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
                placeholder="Bay 1 — 2-post lift"
                placeholderTextColor={colors.mutedForeground}
                value={name}
                onChangeText={setName}
              />

              <Text style={[styles.label, { color: colors.mutedForeground }]}>HOURLY RATE ($) *</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
                placeholder="40"
                placeholderTextColor={colors.mutedForeground}
                keyboardType="decimal-pad"
                value={hourlyRate}
                onChangeText={setHourlyRate}
              />

              <Text style={[styles.label, { color: colors.mutedForeground }]}>EQUIPMENT (comma-separated)</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
                placeholder="2-post lift, A/C recovery, scan tool"
                placeholderTextColor={colors.mutedForeground}
                value={equipment}
                onChangeText={setEquipment}
              />

              <Text style={[styles.label, { color: colors.mutedForeground }]}>ALLOWED JOB CATEGORIES *</Text>
              <View style={styles.chipsRow}>
                {CATEGORIES.map((c) => {
                  const sel = allowedCats.includes(c);
                  return (
                    <Pressable
                      key={c}
                      style={[styles.chip, {
                        backgroundColor: sel ? colors.primary : colors.background,
                        borderColor: sel ? colors.primary : colors.border,
                      }]}
                      onPress={() => toggleCat(c)}
                    >
                      <Text style={{ color: sel ? "white" : colors.foreground, fontWeight: "600", fontSize: 13 }}>{c}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={[styles.label, { color: colors.mutedForeground }]}>MIN MECHANIC TIER *</Text>
              <View style={styles.chipsRow}>
                {TIERS.map((t) => {
                  const sel = minTier === t;
                  return (
                    <Pressable
                      key={t}
                      style={[styles.chip, {
                        backgroundColor: sel ? colors.primary : colors.background,
                        borderColor: sel ? colors.primary : colors.border,
                      }]}
                      onPress={() => setMinTier(t)}
                    >
                      <Text style={{ color: sel ? "white" : colors.foreground, fontWeight: "600", fontSize: 13 }}>{t}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <Pressable
                style={[styles.toggle, { borderColor: colors.border, backgroundColor: colors.background }]}
                onPress={() => setAutoApprove((v) => !v)}
              >
                <Feather name={autoApprove ? "check-square" : "square"} size={20} color={autoApprove ? colors.primary : colors.mutedForeground} />
                <Text style={[styles.toggleText, { color: colors.foreground }]}>
                   Auto-confirm booking requests
                </Text>
              </Pressable>
              <Text style={[styles.formHint, { color: colors.mutedForeground }]}>
                 Requests for this active workspace are confirmed automatically when the scheduled slot is available.
              </Text>

               <Text style={[styles.label, { color: colors.mutedForeground }]}>WEEKLY AVAILABILITY (UTC)</Text>
               <Text style={[styles.formHint, { color: colors.mutedForeground }]}>
                 Leave every day off for the existing always-available behavior. Enabled windows must contain the full scheduled lift interval.
               </Text>
                <Text style={[styles.formHint, { color: colors.mutedForeground }]}>
                  Overnight windows are supported; for example, 19:00–08:00 continues into the following UTC day.
                </Text>
               <View style={styles.availabilityList}>
                 {availability.map((day) => (
                   <View key={day.dayOfWeek} style={[styles.availabilityRow, { borderColor: colors.border }]}>
                     <Pressable
                       style={styles.dayToggle}
                       onPress={() => setAvailability((prev) => prev.map((item) =>
                         item.dayOfWeek === day.dayOfWeek ? { ...item, enabled: !item.enabled } : item,
                       ))}
                       accessibilityRole="button"
                       accessibilityLabel={`${WEEKDAYS[day.dayOfWeek]} availability`}
                     >
                       <Feather
                         name={day.enabled ? "check-square" : "square"}
                         size={18}
                         color={day.enabled ? colors.primary : colors.mutedForeground}
                       />
                       <Text style={[styles.dayLabel, { color: colors.foreground }]}>{WEEKDAYS[day.dayOfWeek]}</Text>
                     </Pressable>
                     {day.enabled ? (
                       <View style={styles.availabilityTimes}>
                         <TextInput
                           style={[styles.timeInput, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
                           value={day.open}
                           onChangeText={(open) => setAvailability((prev) => prev.map((item) =>
                             item.dayOfWeek === day.dayOfWeek ? { ...item, open } : item,
                           ))}
                           placeholder="08:00"
                           placeholderTextColor={colors.mutedForeground}
                           keyboardType="numbers-and-punctuation"
                           accessibilityLabel={`${WEEKDAYS[day.dayOfWeek]} opens`}
                         />
                         <Text style={{ color: colors.mutedForeground }}>–</Text>
                         <TextInput
                           style={[styles.timeInput, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
                           value={day.close}
                           onChangeText={(close) => setAvailability((prev) => prev.map((item) =>
                             item.dayOfWeek === day.dayOfWeek ? { ...item, close } : item,
                           ))}
                           placeholder="18:00"
                           placeholderTextColor={colors.mutedForeground}
                           keyboardType="numbers-and-punctuation"
                           accessibilityLabel={`${WEEKDAYS[day.dayOfWeek]} closes`}
                         />
                       </View>
                     ) : (
                       <Text style={[styles.closedLabel, { color: colors.mutedForeground }]}>Closed</Text>
                     )}
                   </View>
                 ))}
               </View>

              {editingBayId != null ? (
                <>
                  <Text style={[styles.label, { color: colors.mutedForeground }]}>WORKSPACE STATUS</Text>
                  <View style={styles.chipsRow}>
                    {(["active", "inactive"] as UpdateBayBodyStatus[]).map((status) => {
                      const selected = bayStatus === status;
                      return (
                        <Pressable
                          key={status}
                          style={[styles.chip, {
                            backgroundColor: selected ? colors.primary : colors.background,
                            borderColor: selected ? colors.primary : colors.border,
                          }]}
                          onPress={() => setBayStatus(status)}
                        >
                          <Text style={{ color: selected ? "white" : colors.foreground, fontWeight: "600", fontSize: 13 }}>
                            {status}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </>
              ) : null}

              {error ? <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}

              <Pressable
                style={[
                  styles.submitBtn,
                  { backgroundColor: colors.primary },
                  (createBayMutation.isPending || updateBayMutation.isPending) && { opacity: 0.6 },
                ]}
                onPress={editingBayId != null ? submitBayUpdate : submit}
                disabled={createBayMutation.isPending || updateBayMutation.isPending}
              >
                {createBayMutation.isPending || updateBayMutation.isPending
                  ? <ActivityIndicator color="white" />
                  : <Text style={styles.submitText}>{editingBayId != null ? "Save Workspace" : "Create Bay"}</Text>}
              </Pressable>
            </View>
          )}
        </KeyboardAwareScrollViewCompat>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  headerCard: { padding: 16, borderRadius: 14, borderWidth: 1, marginBottom: 16, gap: 4 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  eyebrow: { fontSize: 10, fontWeight: "800", letterSpacing: 0.8, marginBottom: 2 },
  shopName: { fontSize: 18, fontWeight: "800" },
  shopAddr: { fontSize: 13, lineHeight: 18 },
  contextText: { fontSize: 12, lineHeight: 17, marginTop: 5 },
  outlineBtn: {
    flexDirection: "row", alignItems: "center", gap: 5,
    borderWidth: 1, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 7,
  },
  outlineBtnText: { fontSize: 12, fontWeight: "700" },
  sectionTitle: { fontSize: 16, fontWeight: "700", marginBottom: 8 },
  empty: { padding: 28, alignItems: "center", borderWidth: 1, borderStyle: "dashed", borderRadius: 14 },
  emptyTitle: { fontSize: 16, fontWeight: "700", marginTop: 12 },
  emptyDesc: { fontSize: 13, marginTop: 4, textAlign: "center" },
  bayCard: { padding: 14, borderRadius: 14, borderWidth: 1, gap: 4 },
  bayHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  bayLabel: { fontSize: 9, fontWeight: "800", letterSpacing: 0.7, marginBottom: 2 },
  bayName: { fontSize: 15, fontWeight: "700" },
  statusChip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  statusChipText: { fontSize: 11, fontWeight: "700", textTransform: "uppercase" },
  smallOutlineBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    borderWidth: 1, borderRadius: 7, paddingHorizontal: 7, paddingVertical: 5, marginLeft: 6,
  },
  smallOutlineBtnText: { fontSize: 11, fontWeight: "700" },
  bayLine: { fontSize: 13, lineHeight: 18 },
  toggleBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, height: 48, borderRadius: 12, borderWidth: 1, marginTop: 16,
  },
  toggleBtnText: { fontSize: 15, fontWeight: "700" },
  formCard: { borderWidth: 1, borderRadius: 14, padding: 16, marginTop: 12, gap: 8 },
  formHeaderRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  formTitle: { fontSize: 17, fontWeight: "700", marginBottom: 4 },
  formHint: { fontSize: 12, lineHeight: 17 },
  label: { fontSize: 11, fontWeight: "700", letterSpacing: 1, marginTop: 8, marginBottom: 4 },
  input: { height: 46, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, fontSize: 15 },
  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 4 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1.5 },
  toggle: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 10, borderWidth: 1, marginTop: 8 },
  toggleText: { fontSize: 14, fontWeight: "600" },
  availabilityList: { gap: 6, marginTop: 4 },
  availabilityRow: { flexDirection: "row", alignItems: "center", borderBottomWidth: 1, paddingVertical: 7, gap: 8 },
  dayToggle: { width: 72, flexDirection: "row", alignItems: "center", gap: 6 },
  dayLabel: { fontSize: 13, fontWeight: "600" },
  availabilityTimes: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 5 },
  timeInput: { width: 74, height: 36, borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, fontSize: 13, textAlign: "center" },
  closedLabel: { flex: 1, textAlign: "right", fontSize: 12 },
  error: { fontSize: 14, marginTop: 8 },
  submitBtn: { height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center", marginTop: 12 },
  submitText: { color: "white", fontWeight: "700", fontSize: 16 },
});
