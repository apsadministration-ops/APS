import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator,
  TextInput,
} from "react-native";
import { confirm } from "@/utils/confirm";
import { useColors } from "@/hooks/useColors";
import { useListVehicles, useCreateVehicle } from "@workspace/api-client-react";
import { Feather } from "@expo/vector-icons";
import { VehicleCard } from "@/components/VehicleCard";
import { useState } from "react";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";

export default function VehiclesScreen() {
  const colors = useColors();
  const { data: vehicles, isLoading, refetch } = useListVehicles();
  const createMutation = useCreateVehicle();
  const domain = process.env.EXPO_PUBLIC_DOMAIN;

  const [showForm, setShowForm] = useState(false);
  const [vin, setVin] = useState("");
  const [plateNumber, setPlateNumber] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState("");
  const [trim, setTrim] = useState("");
  const [color, setColor] = useState("");
  const [error, setError] = useState("");
  const [removingId, setRemovingId] = useState<number | null>(null);

  const handleAdd = () => {
    setError("");
    if (!vin || !plateNumber || !make || !model || !year) {
      setError("VIN, plate number, make, model and year are required.");
      return;
    }
    if (vin.length !== 17) {
      setError("VIN must be exactly 17 characters.");
      return;
    }
    createMutation.mutate(
      {
        data: {
          vin: vin.toUpperCase(),
          plateNumber: plateNumber.toUpperCase(),
          make, model,
          year: parseInt(year, 10),
          trim: trim || undefined,
          color: color || undefined,
        } as any,
      },
      {
        onSuccess: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          setShowForm(false);
          setVin(""); setPlateNumber(""); setMake(""); setModel(""); setYear(""); setTrim(""); setColor("");
          refetch();
        },
        onError: (e: any) => {
          setError(e?.message ?? "Failed to add vehicle.");
        },
      },
    );
  };

  const handleRemove = async (vehicleId: number, vehicleName: string) => {
    const ok = await confirm({
      title: "Remove Vehicle",
      message: `Remove ${vehicleName} from your account? The vehicle history will be preserved.`,
      confirmText: "Remove",
      destructive: true,
    });
    if (!ok) return;
    setRemovingId(vehicleId);
    try {
      const token = await AsyncStorage.getItem("auth_token");
      const res = await fetch(`https://${domain}/api/vehicles/${vehicleId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        try { await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); } catch { /* web */ }
        refetch();
      }
    } catch { /* non-fatal */ }
    finally { setRemovingId(null); }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <KeyboardAwareScrollViewCompat
        contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
        contentInsetAdjustmentBehavior="automatic"
        bottomOffset={20}
      >
        {showForm && (
          <View style={[styles.form, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.formTitle, { color: colors.foreground }]}>Add Vehicle</Text>
            {[
              { label: "VIN (17 chars) *", value: vin, set: setVin, placeholder: "e.g. 1HGCM82633A004352", upper: true, max: 17 },
              { label: "Plate Number *", value: plateNumber, set: setPlateNumber, placeholder: "e.g. ABC-1234", upper: true, max: undefined },
              { label: "Make *", value: make, set: setMake, placeholder: "e.g. Honda", upper: false },
              { label: "Model *", value: model, set: setModel, placeholder: "e.g. Accord", upper: false },
              { label: "Year *", value: year, set: setYear, placeholder: "e.g. 2020", numeric: true },
              { label: "Trim (optional)", value: trim, set: setTrim, placeholder: "e.g. Sport" },
              { label: "Color (optional)", value: color, set: setColor, placeholder: "e.g. Blue" },
            ].map(({ label, value, set, placeholder, upper, numeric, max }) => (
              <View key={label} style={styles.fieldGroup}>
                <Text style={[styles.label, { color: colors.foreground }]}>{label}</Text>
                <TextInput
                  style={[styles.input, {
                    backgroundColor: colors.background,
                    color: colors.foreground,
                    borderColor: colors.border,
                  }]}
                  placeholder={placeholder}
                  placeholderTextColor={colors.mutedForeground}
                  value={value}
                  onChangeText={upper ? (t) => set(t.toUpperCase()) : set}
                  keyboardType={numeric ? "number-pad" : "default"}
                  autoCapitalize={upper ? "characters" : "words"}
                  maxLength={max}
                />
              </View>
            ))}
            {error ? <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}
            <View style={styles.formButtons}>
              <Pressable
                style={[styles.btn, { backgroundColor: colors.secondary }]}
                onPress={() => { setShowForm(false); setError(""); }}
              >
                <Text style={[styles.btnText, { color: colors.secondaryForeground }]}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.btn, { backgroundColor: colors.primary, flex: 1 }]}
                onPress={handleAdd}
                disabled={createMutation.isPending}
              >
                {createMutation.isPending
                  ? <ActivityIndicator color={colors.primaryForeground} />
                  : <Text style={[styles.btnText, { color: colors.primaryForeground }]}>Add Vehicle</Text>}
              </Pressable>
            </View>
          </View>
        )}

        {isLoading ? (
          <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
        ) : vehicles && vehicles.length > 0 ? (
          vehicles.map((v) => (
            <View key={v.id} style={styles.vehicleWrapper}>
              <VehicleCard vehicle={v} />
              {(v as any).plateNumber && (
                <View style={[styles.plateBadge, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
                  <Feather name="credit-card" size={12} color={colors.mutedForeground} />
                  <Text style={[styles.plateText, { color: colors.mutedForeground }]}>{(v as any).plateNumber}</Text>
                </View>
              )}
              <Pressable
                style={styles.removeBtn}
                onPress={() => handleRemove(v.id, `${v.year} ${v.make} ${v.model}`)}
                disabled={removingId === v.id}
              >
                {removingId === v.id
                  ? <ActivityIndicator size="small" color={colors.destructive} />
                  : <>
                    <Feather name="trash-2" size={14} color={colors.destructive} />
                    <Text style={[styles.removeBtnText, { color: colors.destructive }]}>Remove from my account</Text>
                  </>}
              </Pressable>
            </View>
          ))
        ) : (
          <View style={[styles.emptyState, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="truck" size={48} color={colors.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No vehicles yet</Text>
            <Text style={[styles.emptyDesc, { color: colors.mutedForeground }]}>
              Add a vehicle using its 17-character VIN and plate number.
            </Text>
          </View>
        )}
      </KeyboardAwareScrollViewCompat>

      {!showForm && (
        <Pressable
          style={[styles.fab, { backgroundColor: colors.primary }]}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            setShowForm(true);
          }}
        >
          <Feather name="plus" size={24} color={colors.primaryForeground} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 40 },
  form: { borderWidth: 1, borderRadius: 16, padding: 20, marginBottom: 20, gap: 12 },
  formTitle: { fontSize: 18, fontWeight: "700", marginBottom: 4 },
  fieldGroup: { gap: 6 },
  label: { fontSize: 13, fontWeight: "600" },
  input: { height: 48, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, fontSize: 15 },
  error: { fontSize: 13, marginTop: -4 },
  formButtons: { flexDirection: "row", gap: 12, marginTop: 4 },
  btn: { height: 48, borderRadius: 10, alignItems: "center", justifyContent: "center", paddingHorizontal: 20 },
  btnText: { fontSize: 15, fontWeight: "700" },
  vehicleWrapper: { marginBottom: 12, gap: 6 },
  plateBadge: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1,
    alignSelf: "flex-start",
  },
  plateText: { fontSize: 13, fontWeight: "600", fontFamily: "monospace" },
  removeBtn: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6, paddingHorizontal: 4 },
  removeBtnText: { fontSize: 13, fontWeight: "600" },
  emptyState: {
    padding: 40, alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderRadius: 16, borderStyle: "dashed", marginTop: 16,
  },
  emptyTitle: { fontSize: 16, fontWeight: "600", marginTop: 16, marginBottom: 8 },
  emptyDesc: { fontSize: 14, textAlign: "center" },
  fab: {
    position: "absolute", right: 24, bottom: 100,
    width: 56, height: 56, borderRadius: 28,
    alignItems: "center", justifyContent: "center",
    elevation: 4, shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25, shadowRadius: 4,
  },
});
