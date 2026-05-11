import { View, Text, StyleSheet, Pressable, ActivityIndicator, TextInput, Platform } from "react-native";
import { alertMessage } from "@/utils/confirm";
import { useColors } from "@/hooks/useColors";
import { useListVehicles, useCreateJob } from "@workspace/api-client-react";
import { useRouter, Stack, useLocalSearchParams } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useEffect, useMemo, useState } from "react";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import * as Location from "expo-location";
import { success as hapticSuccess } from "@/utils/haptics";
import { JOB_CATALOG, type ServiceDef } from "@workspace/tier-catalog";

const DIAGNOSTIC_SLUG = "basic_diagnostic_scan";

// Detailing services live on the dedicated /detailing page — exclude them here.
const SERVICES: ServiceDef[] = JOB_CATALOG
  .filter((s) => s.category !== "detailing")
  .sort((a, b) => a.name.localeCompare(b.name));

export default function RequestServiceScreen() {
  const colors = useColors();
  const router = useRouter();
  const { data: vehicles } = useListVehicles();
  const createMutation = useCreateJob();
  const params = useLocalSearchParams<{ mechanicId?: string; mechanicName?: string }>();
  const requestedMechanicId = params.mechanicId ? parseInt(params.mechanicId, 10) : null;
  const requestedMechanicName = params.mechanicName ?? null;

  const [selectedVehicleId, setSelectedVehicleId] = useState<number | null>(null);
  const [serviceSlug, setServiceSlug] = useState<string | null>(null);
  const [serviceQuery, setServiceQuery] = useState("");
  const [description, setDescription] = useState("");
  const [locationText, setLocationText] = useState("");
  const [locationLat, setLocationLat] = useState<number | null>(null);
  const [locationLng, setLocationLng] = useState<number | null>(null);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState("");

  // Auto-select the only vehicle to remove an unnecessary tap.
  useEffect(() => {
    if (vehicles && vehicles.length === 1 && selectedVehicleId == null) {
      setSelectedVehicleId(vehicles[0].id);
    }
  }, [vehicles, selectedVehicleId]);

  const selectedService = useMemo<ServiceDef | null>(
    () => JOB_CATALOG.find((s) => s.slug === serviceSlug) ?? null,
    [serviceSlug],
  );
  const filteredServices = useMemo(() => {
    const q = serviceQuery.trim().toLowerCase();
    if (!q) return SERVICES;
    return SERVICES.filter((s) => s.name.toLowerCase().includes(q));
  }, [serviceQuery]);

  const pickDiagnostic = () => {
    setServiceSlug(DIAGNOSTIC_SLUG);
    setServiceQuery("");
  };

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
      const json = await res.json() as { display_name?: string };
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
          "We couldn't access your location. Please type an address or ZIP code instead.",
        );
        return;
      }
      setLocationLat(coords.lat);
      setLocationLng(coords.lng);
      const addr = await reverseGeocode(coords.lat, coords.lng);
      if (addr) setLocationText(addr);
    } catch {
      void alertMessage("Error", "Could not detect location. Try typing an address or ZIP code instead.");
    } finally {
      setLocating(false);
    }
  };

  // If the customer typed (and didn't auto-detect), resolve the address/ZIP to
  // coordinates on submit. Free-text is forwarded either way — coords just
  // help dispatch.
  const resolveTypedLocation = async (text: string): Promise<{ lat: number; lng: number } | null> => {
    const q = text.trim();
    if (!q) return null;
    const isZip = /^\d{5}(-\d{4})?$/.test(q);
    const url = isZip
      ? `https://nominatim.openstreetmap.org/search?postalcode=${encodeURIComponent(q)}&country=USA&format=json&limit=1`
      : `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1`;
    const res = await fetchWithTimeout(url);
    if (!res || !res.ok) return null;
    try {
      const json = await res.json() as Array<{ lat: string; lon: string }>;
      const hit = json?.[0];
      if (!hit) return null;
      return { lat: parseFloat(hit.lat), lng: parseFloat(hit.lon) };
    } catch {
      return null;
    }
  };

  const handleSubmit = async () => {
    setError("");
    if (!selectedVehicleId) { setError("Please select a vehicle."); return; }
    if (!selectedService) { setError("Please pick the service you need."); return; }
    if (!description.trim()) { setError("Please describe the issue."); return; }
    if (!locationText.trim() && locationLat == null) {
      setError("Please share your location: tap the locate button or type an address / ZIP.");
      return;
    }

    // If the user typed an address/ZIP and never auto-detected, resolve it
    // silently in the background so dispatch has coords. Don't block on it —
    // free-text is fine if Nominatim is unreachable.
    let lat = locationLat;
    let lng = locationLng;
    if (lat == null && locationText.trim()) {
      const resolved = await resolveTypedLocation(locationText);
      if (resolved) { lat = resolved.lat; lng = resolved.lng; }
    }

    createMutation.mutate(
      {
        data: {
          vehicleId: selectedVehicleId,
          // serviceSlug is the source of truth — the server derives jobType +
          // requiredTier from the catalog. We still send jobType for older
          // server builds that haven't shipped the catalog yet.
          serviceSlug: selectedService.slug,
          jobType: selectedService.category,
          description,
          locationAddress: locationText.trim() || undefined,
          locationLat: lat ?? undefined,
          locationLng: lng ?? undefined,
          requestedMechanicId: requestedMechanicId ?? undefined,
        },
      },
      {
        onSuccess: (job) => {
          hapticSuccess();
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
          {requestedMechanicId && requestedMechanicName ? (
            <View style={[styles.directBadge, { backgroundColor: colors.primary + "18", borderColor: colors.primary }]}>
              <Feather name="user-check" size={14} color={colors.primary} />
              <Text style={[styles.directBadgeText, { color: colors.foreground }]} numberOfLines={1}>
                Requesting <Text style={{ fontWeight: "800" }}>{requestedMechanicName}</Text>
              </Text>
              <Pressable onPress={() => router.replace("/request-service")} hitSlop={8} style={{ marginLeft: "auto" }}>
                <Feather name="x" size={14} color={colors.mutedForeground} />
              </Pressable>
            </View>
          ) : null}

          {/* 1. Vehicle — auto-selected if only one; compact picker if multiple. */}
          {!vehicles || vehicles.length === 0 ? (
            <View style={[styles.emptyVehicles, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Feather name="truck" size={20} color={colors.mutedForeground} />
              <Text style={[styles.emptyVehiclesText, { color: colors.mutedForeground }]}>
                Add a vehicle first.
              </Text>
            </View>
          ) : vehicles.length === 1 ? null : (
            <>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>Vehicle</Text>
              <View style={styles.vehicleChips}>
                {vehicles.map((v) => {
                  const sel = selectedVehicleId === v.id;
                  return (
                    <Pressable
                      key={v.id}
                      style={[
                        styles.vehicleChip,
                        { backgroundColor: sel ? colors.primary : colors.card, borderColor: sel ? colors.primary : colors.border },
                      ]}
                      onPress={() => setSelectedVehicleId(v.id)}
                    >
                      <Text style={[styles.vehicleChipText, { color: sel ? "white" : colors.foreground }]}>
                        {v.year} {v.make} {v.model}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </>
          )}

          {/* 2. Service — search + flat list. Two inline links handle the edge cases. */}
          <Text style={[styles.label, { color: colors.mutedForeground, marginTop: vehicles && vehicles.length === 1 ? 0 : 16 }]}>Service</Text>
          {selectedService ? (
            <Pressable
              style={[styles.selectedSvc, { backgroundColor: colors.primary + "12", borderColor: colors.primary }]}
              onPress={() => setServiceSlug(null)}
            >
              <Feather name="check-circle" size={18} color={colors.primary} />
              <Text style={[styles.selectedSvcName, { color: colors.foreground }]} numberOfLines={1}>{selectedService.name}</Text>
              <Text style={[styles.changeLink, { color: colors.primary }]}>Change</Text>
            </Pressable>
          ) : (
            <>
              <TextInput
                style={[styles.input, { backgroundColor: colors.card, color: colors.foreground, borderColor: colors.border }]}
                placeholder="Search (oil change, brakes, battery…)"
                placeholderTextColor={colors.mutedForeground}
                value={serviceQuery}
                onChangeText={setServiceQuery}
                autoCapitalize="none"
              />
              <View style={styles.linkRow}>
                <Pressable onPress={pickDiagnostic} hitSlop={6}>
                  <Text style={[styles.inlineLink, { color: colors.primary }]}>Not sure? Request diagnostic</Text>
                </Pressable>
                <Text style={[styles.linkSep, { color: colors.mutedForeground }]}>·</Text>
                <Pressable onPress={() => router.replace("/detailing")} hitSlop={6}>
                  <Text style={[styles.inlineLink, { color: colors.primary }]}>Detailing →</Text>
                </Pressable>
              </View>
              <View style={[styles.svcListBox, { borderColor: colors.border }]}>
                {filteredServices.length === 0 ? (
                  <Text style={[styles.helper, { color: colors.mutedForeground, padding: 14 }]}>
                    No service matches "{serviceQuery}". Tap "Request diagnostic" above and describe the issue.
                  </Text>
                ) : (
                  filteredServices.map((s, i) => (
                    <Pressable
                      key={s.slug}
                      style={[
                        styles.svcRow,
                        { backgroundColor: colors.card, borderTopColor: colors.border, borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth },
                      ]}
                      onPress={() => setServiceSlug(s.slug)}
                    >
                      <Text style={[styles.svcName, { color: colors.foreground }]}>{s.name}</Text>
                      <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
                    </Pressable>
                  ))
                )}
              </View>
            </>
          )}

          {/* 3. What's wrong */}
          <Text style={[styles.label, { color: colors.mutedForeground, marginTop: 16 }]}>What's wrong?</Text>
          <TextInput
            style={[styles.textarea, { backgroundColor: colors.card, color: colors.foreground, borderColor: colors.border }]}
            placeholder="Briefly describe the issue or what you'd like done."
            placeholderTextColor={colors.mutedForeground}
            multiline
            numberOfLines={3}
            value={description}
            onChangeText={setDescription}
            textAlignVertical="top"
          />

          {/* 4. Location — single field accepts address OR ZIP; GPS button on right. */}
          <Text style={[styles.label, { color: colors.mutedForeground, marginTop: 16 }]}>Where</Text>
          <View style={styles.locationRow}>
            <TextInput
              style={[styles.input, { flex: 1, backgroundColor: colors.card, color: colors.foreground, borderColor: colors.border }]}
              placeholder="Address or ZIP"
              placeholderTextColor={colors.mutedForeground}
              value={locationText}
              onChangeText={(t) => { setLocationText(t); setLocationLat(null); setLocationLng(null); }}
            />
            <Pressable
              style={[styles.locateBtn, { backgroundColor: locationLat != null ? colors.primary : colors.secondary, borderColor: colors.border }]}
              onPress={handleDetectLocation}
              disabled={locating}
            >
              {locating
                ? <ActivityIndicator color={locationLat != null ? "white" : colors.foreground} size="small" />
                : <Feather name="navigation" size={18} color={locationLat != null ? "white" : colors.foreground} />}
            </Pressable>
          </View>

          {error ? <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}

          <Pressable
            style={[styles.submitBtn, { backgroundColor: colors.primary }, (createMutation.isPending || locating) && { opacity: 0.6 }]}
            onPress={handleSubmit}
            disabled={createMutation.isPending || locating}
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
  label: { fontSize: 12, fontWeight: "700", letterSpacing: 0.4, marginBottom: 8 },

  directBadge: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10,
    borderWidth: 1, marginBottom: 14,
  },
  directBadgeText: { fontSize: 13, flex: 1 },

  emptyVehicles: {
    flexDirection: "row", alignItems: "center", gap: 10,
    padding: 14, borderRadius: 12, borderWidth: 1, marginBottom: 8,
  },
  emptyVehiclesText: { fontSize: 14, flex: 1 },

  vehicleChips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  vehicleChip: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, borderWidth: 1 },
  vehicleChipText: { fontSize: 13, fontWeight: "600" },

  input: { height: 46, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, fontSize: 15 },
  textarea: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 15, minHeight: 80 },

  selectedSvc: {
    flexDirection: "row", alignItems: "center", gap: 10,
    padding: 12, borderRadius: 10, borderWidth: 1.5,
  },
  selectedSvcName: { flex: 1, fontSize: 15, fontWeight: "700" },
  changeLink: { fontSize: 13, fontWeight: "700" },

  linkRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },
  inlineLink: { fontSize: 12, fontWeight: "700" },
  linkSep: { fontSize: 12 },

  svcListBox: { borderWidth: 1, borderRadius: 10, marginTop: 10, overflow: "hidden" },
  svcRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingVertical: 12 },
  svcName: { flex: 1, fontSize: 14, fontWeight: "500" },

  locationRow: { flexDirection: "row", gap: 8 },
  locateBtn: { width: 46, height: 46, borderRadius: 10, borderWidth: 1, alignItems: "center", justifyContent: "center" },

  helper: { fontSize: 12 },
  error: { fontSize: 14, marginTop: 12 },
  submitBtn: { height: 52, borderRadius: 12, alignItems: "center", justifyContent: "center", marginTop: 20 },
  submitText: { color: "white", fontWeight: "700", fontSize: 16 },
});
