import { View, Text, StyleSheet, Pressable, ActivityIndicator, ScrollView, TextInput, Platform } from "react-native";
import { alertMessage } from "@/utils/confirm";
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
  const [zipCode, setZipCode] = useState("");
  const [locating, setLocating] = useState(false);
  const [lookingUpZip, setLookingUpZip] = useState(false);
  const [error, setError] = useState("");

  const fetchWithTimeout = async (url: string, ms = 8000): Promise<Response | null> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
      return await fetch(url, { headers: { "Accept-Language": "en" }, signal: ctrl.signal });
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };

  const getCurrentCoords = async (): Promise<{ lat: number; lng: number } | null> => {
    // On web, expo-location's reverse-geocode is unsupported and the permission
    // dialog can be blocked inside iframes. Use navigator.geolocation directly.
    if (Platform.OS === "web") {
      if (typeof navigator === "undefined" || !navigator.geolocation) return null;
      return await new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
          () => resolve(null),
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
        );
      });
    }
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") return null;
    const loc = await Location.getCurrentPositionAsync({});
    return { lat: loc.coords.latitude, lng: loc.coords.longitude };
  };

  const reverseGeocode = async (lat: number, lng: number): Promise<string | null> => {
    const res = await fetchWithTimeout(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=18&addressdetails=1`,
    );
    if (!res || !res.ok) return null;
    try {
      const json = await res.json() as { display_name?: string; address?: { postcode?: string } };
      if (json?.address?.postcode && !zipCode) setZipCode(json.address.postcode);
      return json?.display_name ?? null;
    } catch {
      return null;
    }
  };

  const handleDetectLocation = async () => {
    setLocating(true);
    try {
      const coords = await getCurrentCoords();
      if (!coords) {
        void alertMessage(
          "Location unavailable",
          "We couldn't access your location. Please allow location access in your browser/system settings, or enter your ZIP code below as a fallback.",
        );
        return;
      }
      setLocationLat(coords.lat);
      setLocationLng(coords.lng);
      const addr = await reverseGeocode(coords.lat, coords.lng);
      if (addr) setLocationAddress(addr);
    } catch {
      void alertMessage("Error", "Could not detect location. Try entering your ZIP code instead.");
    } finally {
      setLocating(false);
    }
  };

  const handleLookupZip = async () => {
    const zip = zipCode.trim();
    if (!zip) {
      void alertMessage("Enter ZIP code", "Type your ZIP/postal code above first.");
      return;
    }
    setLookingUpZip(true);
    try {
      const res = await fetchWithTimeout(
        `https://nominatim.openstreetmap.org/search?postalcode=${encodeURIComponent(zip)}&country=USA&format=json&addressdetails=1&limit=1`,
      );
      if (!res || !res.ok) {
        void alertMessage("Lookup failed", "Could not look up that ZIP code right now. Please try again.");
        return;
      }
      const json = await res.json() as Array<{ lat: string; lon: string; display_name: string }>;
      const hit = json?.[0];
      if (!hit) {
        void alertMessage("ZIP not found", `No location found for "${zip}". Double-check the ZIP code.`);
        return;
      }
      setLocationLat(parseFloat(hit.lat));
      setLocationLng(parseFloat(hit.lon));
      setLocationAddress(hit.display_name);
    } catch {
      void alertMessage("Lookup failed", "Could not look up that ZIP code right now. Please try again.");
    } finally {
      setLookingUpZip(false);
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
    if (!locationAddress.trim() && !zipCode.trim() && locationLat == null) {
      setError("Please share your location: tap the arrow, enter your ZIP code, or type an address.");
      return;
    }
    const finalAddress = locationAddress.trim() || (zipCode.trim() ? `ZIP ${zipCode.trim()}` : "");
    createMutation.mutate(
      {
        data: {
          vehicleId: selectedVehicleId,
          jobType: jobType as "repair" | "diagnostic" | "maintenance" | "detailing",
          description,
          locationAddress: finalAddress || undefined,
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

          <Text style={[styles.sectionLabel, { color: colors.mutedForeground, marginTop: 20 }]}>LOCATION</Text>
          <View style={styles.locationRow}>
            <TextInput
              style={[styles.input, { flex: 1, backgroundColor: colors.card, color: colors.foreground, borderColor: colors.border }]}
              placeholder="Address (auto-filled or type your own)"
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
          <Text style={[styles.helper, { color: colors.mutedForeground }]}>
            Tap the arrow to use your current location, or enter your ZIP code below.
          </Text>

          <View style={[styles.locationRow, { marginTop: 12 }]}>
            <TextInput
              style={[styles.input, { flex: 1, backgroundColor: colors.card, color: colors.foreground, borderColor: colors.border }]}
              placeholder="ZIP / postal code"
              placeholderTextColor={colors.mutedForeground}
              value={zipCode}
              onChangeText={setZipCode}
              keyboardType="number-pad"
              maxLength={10}
              autoCapitalize="characters"
            />
            <Pressable
              style={[styles.zipBtn, { backgroundColor: colors.primary }, lookingUpZip && { opacity: 0.6 }]}
              onPress={handleLookupZip}
              disabled={lookingUpZip}
            >
              {lookingUpZip
                ? <ActivityIndicator color="white" size="small" />
                : <Text style={styles.zipBtnText}>Use ZIP</Text>}
            </Pressable>
          </View>
          {locationLat != null && locationLng != null ? (
            <View style={[styles.locBadge, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
              <Feather name="map-pin" size={12} color={colors.primary} />
              <Text style={[styles.locBadgeText, { color: colors.foreground }]} numberOfLines={1}>
                Location set ({locationLat.toFixed(3)}, {locationLng.toFixed(3)})
              </Text>
            </View>
          ) : null}

          {error ? <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}

          <Pressable
            style={[styles.submitBtn, { backgroundColor: colors.primary }, (createMutation.isPending || locating || lookingUpZip) && { opacity: 0.6 }]}
            onPress={handleSubmit}
            disabled={createMutation.isPending || locating || lookingUpZip}
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
  zipBtn: {
    height: 48,
    paddingHorizontal: 16,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  zipBtnText: { color: "white", fontWeight: "700", fontSize: 14 },
  helper: { fontSize: 12, marginTop: 6 },
  locBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    alignSelf: "flex-start",
    marginTop: 10,
  },
  locBadgeText: { fontSize: 12, fontWeight: "600" },
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
