import {
  View, Text, StyleSheet, Pressable, ActivityIndicator, TextInput, ScrollView,
} from "react-native";
import { useColors } from "@/hooks/useColors";
import { useGetShop, useCreateBay, getGetShopQueryKey,
  CreateBayBodyAllowedJobCategoriesItem, CreateBayBodyMinMechanicTier,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, Stack } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useState } from "react";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { alertMessage } from "@/utils/confirm";

const CATEGORIES: CreateBayBodyAllowedJobCategoriesItem[] = ["repair", "diagnostic", "maintenance", "detailing"];
const TIERS: CreateBayBodyMinMechanicTier[] = ["detailer", "technician", "senior", "advanced", "master"];

export default function ShopDetailScreen() {
  const colors = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const shopId = parseInt(id, 10);
  const queryClient = useQueryClient();

  const { data: shop, isLoading } = useGetShop(shopId);
  const createBayMutation = useCreateBay();

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [hourlyRate, setHourlyRate] = useState("");
  const [equipment, setEquipment] = useState("");
  const [allowedCats, setAllowedCats] = useState<CreateBayBodyAllowedJobCategoriesItem[]>(["repair", "maintenance"]);
  const [minTier, setMinTier] = useState<CreateBayBodyMinMechanicTier>("technician");
  const [autoApprove, setAutoApprove] = useState(false);
  const [error, setError] = useState("");

  const toggleCat = (c: CreateBayBodyAllowedJobCategoriesItem) =>
    setAllowedCats((prev) => prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]);

  const submit = () => {
    setError("");
    const rateNum = parseFloat(hourlyRate);
    if (!name.trim()) { setError("Bay name is required."); return; }
    if (!Number.isFinite(rateNum) || rateNum < 0) { setError("Hourly rate must be a non-negative number."); return; }
    if (allowedCats.length === 0) { setError("Select at least one allowed job category."); return; }
    const equipList = equipment.split(",").map((s) => s.trim()).filter(Boolean);
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
        },
      },
      {
        onSuccess: () => {
          setShowForm(false);
          setName(""); setHourlyRate(""); setEquipment("");
          setAllowedCats(["repair", "maintenance"]); setMinTier("technician"); setAutoApprove(false);
          queryClient.invalidateQueries({ queryKey: getGetShopQueryKey(shopId) });
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
            <Text style={[styles.shopName, { color: colors.foreground }]}>{shop.name}</Text>
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
          </View>

          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Service Bays ({shop.bays.length})</Text>

          {shop.bays.length === 0 ? (
            <View style={[styles.empty, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Feather name="grid" size={40} color={colors.mutedForeground} />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No bays yet</Text>
              <Text style={[styles.emptyDesc, { color: colors.mutedForeground }]}>Add your first bay below.</Text>
            </View>
          ) : (
            <View style={{ gap: 10 }}>
              {shop.bays.map((b) => (
                <View key={b.id} style={[styles.bayCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View style={styles.bayHeader}>
                    <Text style={[styles.bayName, { color: colors.foreground }]}>{b.name}</Text>
                    <View style={[styles.statusChip, {
                      backgroundColor: b.status === "active" ? "#22C55E20" : "#F59E0B20",
                    }]}>
                      <Text style={[styles.statusChipText, {
                        color: b.status === "active" ? "#15803d" : "#A16207",
                      }]}>{b.status}</Text>
                    </View>
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
                      ⚡ Auto-approves bookings
                    </Text>
                  ) : null}
                </View>
              ))}
            </View>
          )}

          <Pressable
            style={[styles.toggleBtn, { borderColor: colors.primary, backgroundColor: showForm ? colors.card : colors.primary + "12" }]}
            onPress={() => setShowForm((v) => !v)}
          >
            <Feather name={showForm ? "x" : "plus"} size={18} color={colors.primary} />
            <Text style={[styles.toggleBtnText, { color: colors.primary }]}>
              {showForm ? "Cancel" : "Add a Bay"}
            </Text>
          </Pressable>

          {showForm && (
            <View style={[styles.formCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.formTitle, { color: colors.foreground }]}>New Bay</Text>

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
                  Auto-approve bookings
                </Text>
              </Pressable>

              {error ? <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}

              <Pressable
                style={[styles.submitBtn, { backgroundColor: colors.primary }, createBayMutation.isPending && { opacity: 0.6 }]}
                onPress={submit}
                disabled={createBayMutation.isPending}
              >
                {createBayMutation.isPending
                  ? <ActivityIndicator color="white" />
                  : <Text style={styles.submitText}>Create Bay</Text>}
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
  shopName: { fontSize: 18, fontWeight: "800" },
  shopAddr: { fontSize: 13, lineHeight: 18 },
  sectionTitle: { fontSize: 16, fontWeight: "700", marginBottom: 8 },
  empty: { padding: 28, alignItems: "center", borderWidth: 1, borderStyle: "dashed", borderRadius: 14 },
  emptyTitle: { fontSize: 16, fontWeight: "700", marginTop: 12 },
  emptyDesc: { fontSize: 13, marginTop: 4, textAlign: "center" },
  bayCard: { padding: 14, borderRadius: 14, borderWidth: 1, gap: 4 },
  bayHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  bayName: { fontSize: 15, fontWeight: "700" },
  statusChip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  statusChipText: { fontSize: 11, fontWeight: "700", textTransform: "uppercase" },
  bayLine: { fontSize: 13, lineHeight: 18 },
  toggleBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, height: 48, borderRadius: 12, borderWidth: 1, marginTop: 16,
  },
  toggleBtnText: { fontSize: 15, fontWeight: "700" },
  formCard: { borderWidth: 1, borderRadius: 14, padding: 16, marginTop: 12, gap: 8 },
  formTitle: { fontSize: 17, fontWeight: "700", marginBottom: 4 },
  label: { fontSize: 11, fontWeight: "700", letterSpacing: 1, marginTop: 8, marginBottom: 4 },
  input: { height: 46, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, fontSize: 15 },
  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 4 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1.5 },
  toggle: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 10, borderWidth: 1, marginTop: 8 },
  toggleText: { fontSize: 14, fontWeight: "600" },
  error: { fontSize: 14, marginTop: 8 },
  submitBtn: { height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center", marginTop: 12 },
  submitText: { color: "white", fontWeight: "700", fontSize: 16 },
});
