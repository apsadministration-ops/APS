import React, { useMemo, useState } from "react";
import {
  ScrollView, View, Text, TextInput, Pressable, StyleSheet,
  ActivityIndicator, RefreshControl,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { alertMessage } from "@/utils/confirm";
import {
  useListMyShops, useListVehicles, useCreateVehicle,
  getListMyShopsQueryKey, getListVehiclesQueryKey,
} from "@workspace/api-client-react";

export default function FleetVehiclesScreen() {
  const colors = useColors();
  const { user } = useAuth();
  const qc = useQueryClient();
  const enabled = !!user && user.role === "shop_owner";

  const { data: shops } = useListMyShops({ query: { enabled, queryKey: getListMyShopsQueryKey() } });
  const { data: vehicles, isLoading, refetch, isRefetching } = useListVehicles({
    query: { enabled, queryKey: getListVehiclesQueryKey() },
  });
  const createMutation = useCreateVehicle();

  const fleetShops = useMemo(
    () => (shops ?? []).filter((s: any) => s.partnerKind === "dealership" || s.partnerKind === "fleet" || s.partnerKind === "gsa"),
    [shops],
  );
  const fleetVehicles = useMemo(
    () => (vehicles ?? []).filter((v: any) => v.ownerShopId != null),
    [vehicles],
  );

  const [showForm, setShowForm] = useState(false);
  const [shopId, setShopId] = useState<number | null>(null);
  const [vin, setVin] = useState("");
  const [plate, setPlate] = useState("");
  const [year, setYear] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [mileage, setMileage] = useState("");
  const [insCarrier, setInsCarrier] = useState("");
  const [insPolicy, setInsPolicy] = useState("");
  const [error, setError] = useState("");

  React.useEffect(() => {
    if (shopId == null && fleetShops.length > 0) setShopId(fleetShops[0].id);
  }, [fleetShops, shopId]);

  const submit = () => {
    setError("");
    if (!shopId) { setError("Pick a partner location."); return; }
    if (vin.trim().length !== 17) { setError("VIN must be exactly 17 characters."); return; }
    const y = parseInt(year.trim(), 10);
    const m = parseInt(mileage.trim(), 10);
    if (!Number.isFinite(y) || y < 1900 || y > 2100) { setError("Enter a valid year."); return; }
    if (!make.trim() || !model.trim()) { setError("Make and model are required."); return; }
    if (!Number.isFinite(m) || m < 0) { setError("Enter mileage as a non-negative number."); return; }
    createMutation.mutate(
      {
        data: {
          vin: vin.trim().toUpperCase(),
          plateNumber: plate.trim() || undefined,
          make: make.trim(),
          model: model.trim(),
          year: y,
          mileage: m,
          insuranceCarrier: insCarrier.trim() || undefined,
          insurancePolicyNumber: insPolicy.trim() || undefined,
          ownerShopId: shopId,
        },
      },
      {
        onSuccess: () => {
          setShowForm(false);
          setVin(""); setPlate(""); setYear(""); setMake(""); setModel("");
          setMileage(""); setInsCarrier(""); setInsPolicy("");
          qc.invalidateQueries({ queryKey: getListVehiclesQueryKey() });
          void alertMessage("Fleet vehicle added", "VIN registered. Service history will accrue under this partner location.");
        },
        onError: (e: any) => setError(e?.message ?? "Failed to add vehicle."),
      },
    );
  };

  if (isLoading) {
    return <View style={[styles.center, { backgroundColor: colors.background }]}><ActivityIndicator color={colors.primary} /></View>;
  }

  if (fleetShops.length === 0) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background, padding: 24 }]}>
        <Feather name="truck" size={42} color={colors.mutedForeground} />
        <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No fleet locations yet</Text>
        <Text style={[styles.emptyDesc, { color: colors.mutedForeground }]}>
          Add a Dealership, Fleet, or Government / GSA partner location first — independent shops don't own vehicles.
        </Text>
      </View>
    );
  }

  const shopName = (id: number | null | undefined) => {
    const s = (shops ?? []).find((x: any) => x.id === id);
    return s?.name ?? `Shop #${id ?? "?"}`;
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <KeyboardAwareScrollViewCompat
        contentContainerStyle={{ padding: 16, paddingBottom: 120, gap: 12 }}
        bottomOffset={20}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
      >
        <Text style={[styles.heading, { color: colors.foreground }]}>Fleet Vehicles</Text>
        <Text style={[styles.sub, { color: colors.mutedForeground }]}>
          Register VINs to your partner locations. Service history will follow each VIN across ownership changes.
        </Text>

        {fleetVehicles.length === 0 ? (
          <View style={[styles.empty, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="truck" size={36} color={colors.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No fleet vehicles yet</Text>
            <Text style={[styles.emptyDesc, { color: colors.mutedForeground }]}>Add your first VIN to start tracking service history.</Text>
          </View>
        ) : (
          <View style={{ gap: 10 }}>
            {fleetVehicles.map((v: any) => (
              <View key={v.id} style={[styles.vehCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.vehTitle, { color: colors.foreground }]}>
                    {v.year} {v.make} {v.model}
                  </Text>
                  <Text style={[styles.vehMono, { color: colors.mutedForeground }]} numberOfLines={1}>
                    VIN {v.vin}{v.plateNumber ? `  ·  ${v.plateNumber}` : ""}
                  </Text>
                  <Text style={[styles.vehMeta, { color: colors.mutedForeground }]}>
                    {shopName(v.ownerShopId)} · {v.mileage?.toLocaleString?.() ?? v.mileage} mi
                  </Text>
                  {v.insuranceCarrier ? (
                    <Text style={[styles.vehMeta, { color: colors.mutedForeground }]} numberOfLines={1}>
                      <Feather name="shield" size={10} /> {v.insuranceCarrier}
                      {v.insurancePolicyNumber ? `  ·  ${v.insurancePolicyNumber}` : ""}
                    </Text>
                  ) : null}
                </View>
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
            {showForm ? "Cancel" : "Add a Vehicle"}
          </Text>
        </Pressable>

        {showForm && (
          <View style={[styles.formCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.formTitle, { color: colors.foreground }]}>Add Fleet Vehicle</Text>

            <Text style={[styles.label, { color: colors.mutedForeground }]}>PARTNER LOCATION *</Text>
            <View style={{ gap: 8 }}>
              {fleetShops.map((s: any) => {
                const selected = shopId === s.id;
                return (
                  <Pressable
                    key={s.id}
                    onPress={() => setShopId(s.id)}
                    style={[
                      styles.shopRow,
                      {
                        backgroundColor: selected ? colors.primary + "14" : colors.background,
                        borderColor: selected ? colors.primary : colors.border,
                      },
                    ]}
                  >
                    <Feather
                      name={s.partnerKind === "fleet" ? "truck" : s.partnerKind === "gsa" ? "shield" : "award"}
                      size={18}
                      color={selected ? colors.primary : colors.mutedForeground}
                    />
                    <Text style={[styles.shopRowText, { color: selected ? colors.primary : colors.foreground }]} numberOfLines={1}>
                      {s.name}
                    </Text>
                    {selected && <Feather name="check-circle" size={16} color={colors.primary} />}
                  </Pressable>
                );
              })}
            </View>

            <Text style={[styles.label, { color: colors.mutedForeground }]}>VIN * (17 chars)</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
              placeholder="1HGBH41JXMN109186"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="characters"
              maxLength={17}
              value={vin}
              onChangeText={setVin}
            />

            <Text style={[styles.label, { color: colors.mutedForeground }]}>PLATE NUMBER</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
              placeholder="ABC-1234"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="characters"
              value={plate}
              onChangeText={setPlate}
            />

            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.label, { color: colors.mutedForeground }]}>YEAR *</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
                  placeholder="2023" placeholderTextColor={colors.mutedForeground}
                  keyboardType="number-pad" maxLength={4} value={year} onChangeText={setYear}
                />
              </View>
              <View style={{ flex: 2 }}>
                <Text style={[styles.label, { color: colors.mutedForeground }]}>MAKE *</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
                  placeholder="Ford" placeholderTextColor={colors.mutedForeground}
                  value={make} onChangeText={setMake}
                />
              </View>
              <View style={{ flex: 2 }}>
                <Text style={[styles.label, { color: colors.mutedForeground }]}>MODEL *</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
                  placeholder="F-150" placeholderTextColor={colors.mutedForeground}
                  value={model} onChangeText={setModel}
                />
              </View>
            </View>

            <Text style={[styles.label, { color: colors.mutedForeground }]}>CURRENT MILEAGE *</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
              placeholder="24500" placeholderTextColor={colors.mutedForeground}
              keyboardType="number-pad" value={mileage} onChangeText={setMileage}
            />

            <Text style={[styles.section, { color: colors.foreground }]}>Insurance (optional)</Text>

            <Text style={[styles.label, { color: colors.mutedForeground }]}>INSURANCE CARRIER</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
              placeholder="State Farm Commercial" placeholderTextColor={colors.mutedForeground}
              value={insCarrier} onChangeText={setInsCarrier}
            />

            <Text style={[styles.label, { color: colors.mutedForeground }]}>POLICY NUMBER</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
              placeholder="POL-12345" placeholderTextColor={colors.mutedForeground}
              value={insPolicy} onChangeText={setInsPolicy}
            />

            {!!error && (
              <View style={[styles.errBox, { backgroundColor: "#FEE2E2", borderColor: "#DC2626" }]}>
                <Text style={{ color: "#991B1B", fontSize: 13 }}>{error}</Text>
              </View>
            )}

            <Pressable
              style={[styles.submitBtn, { backgroundColor: colors.primary, opacity: createMutation.isPending ? 0.6 : 1 }]}
              onPress={submit}
              disabled={createMutation.isPending}
            >
              {createMutation.isPending
                ? <ActivityIndicator color="white" />
                : <Text style={styles.submitText}>Add Vehicle</Text>}
            </Pressable>
          </View>
        )}
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8 },
  heading: { fontSize: 22, fontWeight: "800" },
  sub: { fontSize: 13, lineHeight: 18 },
  section: { fontSize: 14, fontWeight: "700", marginTop: 10 },
  empty: { padding: 28, alignItems: "center", borderWidth: 1, borderStyle: "dashed", borderRadius: 14 },
  emptyTitle: { fontSize: 16, fontWeight: "700", marginTop: 10, textAlign: "center" },
  emptyDesc: { fontSize: 13, marginTop: 4, textAlign: "center", lineHeight: 18 },
  vehCard: { flexDirection: "row", padding: 14, borderRadius: 14, borderWidth: 1, gap: 12, alignItems: "center" },
  vehTitle: { fontSize: 15, fontWeight: "700" },
  vehMono: { fontSize: 12, marginTop: 4, fontVariant: ["tabular-nums"] },
  vehMeta: { fontSize: 12, marginTop: 4 },
  shopRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: 10, borderWidth: 1 },
  shopRowText: { flex: 1, fontSize: 13, fontWeight: "600" },
  toggleBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 48, borderRadius: 12, borderWidth: 1, marginTop: 4 },
  toggleBtnText: { fontSize: 15, fontWeight: "700" },
  formCard: { borderWidth: 1, borderRadius: 14, padding: 16, gap: 8 },
  formTitle: { fontSize: 17, fontWeight: "700", marginBottom: 4 },
  label: { fontSize: 11, fontWeight: "700", letterSpacing: 1, marginTop: 6 },
  input: { height: 44, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, fontSize: 14 },
  errBox: { padding: 12, borderRadius: 10, borderWidth: 1, marginTop: 4 },
  submitBtn: { height: 50, borderRadius: 14, alignItems: "center", justifyContent: "center", marginTop: 12 },
  submitText: { color: "white", fontWeight: "700", fontSize: 16 },
});
