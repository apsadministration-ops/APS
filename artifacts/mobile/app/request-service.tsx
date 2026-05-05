import { View, Text, StyleSheet, Pressable, ActivityIndicator, ScrollView, TextInput, Alert } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useListVehicles, useCreateJob } from "@workspace/api-client-react";
import { useRouter, Stack } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useState } from "react";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import * as Location from "expo-location";
import * as Haptics from "expo-haptics";

const JOB_TYPES = ["repair", "diagnostic", "maintenance", "detailing"] as const;

export default function RequestServiceScreen() {
  const colors = useColors();
  const router = useRouter();
  const { data: vehicles } = useListVehicles();
  const createMutation = useCreateJob();

  const [selectedVehicleId, setSelectedVehicleId] = useState<number | null>(null);
  const [jobType, setJobType] = useState<string>("repair");
  const [description, setDescription] = useState("");
  const [locationAddress, setLocationAddress] = useState("");
  const [locationLat, setLocationLat] = useState<number | null>(null);
  const [locationLng, setLocationLng] = useState<number | null>(null);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState("");

  const handleDetectLocation = async () => {
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permission denied", "Location permission is needed to auto-fill your address.");
        return;
      }
      const loc = await Location.getCurrentPositionAsync({});
      setLocationLat(loc.coords.latitude);
      setLocationLng(loc.coords.longitude);
      const [addr] = await Location.reverseGeocodeAsync({
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
      });
      if (addr) {
        setLocationAddress(`${addr.street ?? ""} ${addr.city ?? ""}, ${addr.region ?? ""}`.trim());
      }
    } catch {
      Alert.alert("Error", "Could not detect location.");
    } finally {
      setLocating(false);
    }
  };

  const handleSubmit = () => {
    setError("");
    if (!selectedVehicleId) {
      setError("Please select a vehicle.");
      return;
    }
    if (!description.trim()) {
      setError("Please describe the issue.");
      return;
    }
    createMutation.mutate(
      {
        data: {
          vehicleId: selectedVehicleId,
          jobType: jobType as "repair" | "diagnostic" | "maintenance" | "detailing",
          description,
          locationAddress: locationAddress || undefined,
          locationLat: locationLat ?? undefined,
          locationLng: locationLng ?? undefined,
        },
      },
      {
        onSuccess: (job) => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          router.replace(`/job/${job.id}`);
        },
        onError: (e: any) => {
          setError(e?.message ?? "Failed to create job. Please try again.");
        },
      }
    );
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: "Request Service",
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.foreground,
          headerShown: true,
          presentation: "modal",
        }}
      />
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <KeyboardAwareScrollViewCompat
          contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
          bottomOffset={20}
        >
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>VEHICLE</Text>
          {!vehicles || vehicles.length === 0 ? (
            <View style={[styles.emptyVehicles, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Feather name="truck" size={24} color={colors.mutedForeground} />
              <Text style={[styles.emptyVehiclesText, { color: colors.mutedForeground }]}>
                No vehicles registered. Add one first.
              </Text>
            </View>
          ) : (
            <View style={styles.vehicleList}>
              {vehicles.map((v) => (
                <Pressable
                  key={v.id}
                  style={[
                    styles.vehicleOption,
                    { backgroundColor: colors.card, borderColor: selectedVehicleId === v.id ? colors.primary : colors.border },
                  ]}
                  onPress={() => setSelectedVehicleId(v.id)}
                >
                  <Feather
                    name={selectedVehicleId === v.id ? "check-circle" : "circle"}
                    size={20}
                    color={selectedVehicleId === v.id ? colors.primary : colors.mutedForeground}
                  />
                  <View style={styles.vehicleInfo}>
                    <Text style={[styles.vehicleName, { color: colors.foreground }]}>
                      {v.year} {v.make} {v.model}
                    </Text>
                    <Text style={[styles.vehicleVin, { color: colors.mutedForeground }]}>VIN: {v.vin}</Text>
                  </View>
                </Pressable>
              ))}
            </View>
          )}

          <Text style={[styles.sectionLabel, { color: colors.mutedForeground, marginTop: 20 }]}>SERVICE TYPE</Text>
          <View style={styles.typeGrid}>
            {JOB_TYPES.map((t) => (
              <Pressable
                key={t}
                style={[
                  styles.typeOption,
                  { backgroundColor: jobType === t ? colors.primary : colors.card, borderColor: jobType === t ? colors.primary : colors.border },
                ]}
                onPress={() => setJobType(t)}
              >
                <Text style={[styles.typeText, { color: jobType === t ? "white" : colors.foreground }]}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </Text>
              </Pressable>
            ))}
          </View>

          <Text style={[styles.sectionLabel, { color: colors.mutedForeground, marginTop: 20 }]}>DESCRIPTION</Text>
          <TextInput
            style={[styles.textarea, { backgroundColor: colors.card, color: colors.foreground, borderColor: colors.border }]}
            placeholder="Describe the issue or service needed..."
            placeholderTextColor={colors.mutedForeground}
            multiline
            numberOfLines={5}
            value={description}
            onChangeText={setDescription}
            textAlignVertical="top"
          />

          <Text style={[styles.sectionLabel, { color: colors.mutedForeground, marginTop: 20 }]}>LOCATION (OPTIONAL)</Text>
          <View style={styles.locationRow}>
            <TextInput
              style={[styles.input, { flex: 1, backgroundColor: colors.card, color: colors.foreground, borderColor: colors.border }]}
              placeholder="Enter address or use GPS"
              placeholderTextColor={colors.mutedForeground}
              value={locationAddress}
              onChangeText={setLocationAddress}
            />
            <Pressable
              style={[styles.locateBtn, { backgroundColor: colors.secondary, borderColor: colors.border }]}
              onPress={handleDetectLocation}
              disabled={locating}
            >
              {locating
                ? <ActivityIndicator color={colors.foreground} size="small" />
                : <Feather name="navigation" size={18} color={colors.foreground} />}
            </Pressable>
          </View>

          {error ? <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}

          <Pressable
            style={[styles.submitBtn, { backgroundColor: colors.primary }, createMutation.isPending && { opacity: 0.6 }]}
            onPress={handleSubmit}
            disabled={createMutation.isPending}
          >
            {createMutation.isPending
              ? <ActivityIndicator color="white" />
              : <Text style={styles.submitText}>Request Service</Text>}
          </Pressable>
        </KeyboardAwareScrollViewCompat>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  sectionLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 1, marginBottom: 8 },
  vehicleList: { gap: 8 },
  vehicleOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 2,
  },
  vehicleInfo: { flex: 1 },
  vehicleName: { fontSize: 15, fontWeight: "600" },
  vehicleVin: { fontSize: 12, fontFamily: "monospace" },
  emptyVehicles: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  emptyVehiclesText: { fontSize: 14, flex: 1 },
  typeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  typeOption: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1.5,
  },
  typeText: { fontSize: 14, fontWeight: "600" },
  textarea: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    minHeight: 120,
  },
  locationRow: { flexDirection: "row", gap: 8 },
  input: {
    height: 48,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    fontSize: 15,
  },
  locateBtn: {
    width: 48,
    height: 48,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  error: { fontSize: 14, marginTop: 8 },
  submitBtn: {
    height: 56,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 24,
  },
  submitText: { color: "white", fontWeight: "700", fontSize: 17 },
});
