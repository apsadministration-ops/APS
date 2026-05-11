import { View, Text, StyleSheet, Pressable, ActivityIndicator, TextInput, Platform } from "react-native";
import { alertMessage } from "@/utils/confirm";
import { useColors } from "@/hooks/useColors";
import { useListVehicles, useCreateJob } from "@workspace/api-client-react";
import { useRouter, Stack, useLocalSearchParams } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useMemo, useState } from "react";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import * as Location from "expo-location";
import { success as hapticSuccess } from "@/utils/haptics";
import { JOB_CATALOG, type ServiceDef } from "@workspace/tier-catalog";

// Customer-facing category labels. Detailing is intentionally excluded — it
// has its own dedicated booking page (`/detailing`) with package pricing.
const CATEGORY_ORDER: Array<{ key: "maintenance" | "repair" | "diagnostic"; label: string; icon: keyof typeof Feather.glyphMap }> = [
  { key: "maintenance", label: "Maintenance",  icon: "tool" },
  { key: "repair",      label: "Repairs",      icon: "settings" },
  { key: "diagnostic",  label: "Diagnostics",  icon: "activity" },
];

const DIAGNOSTIC_SLUG = "basic_diagnostic_scan";

// Mirrors artifacts/api-server/src/lib/transportKeywords.ts so the customer
// sees the same lift-detection result the server will compute. The server
// remains the source of truth — this is just an inline UX hint.
function detectLiftReason(description: string): string | null {
  const text = description.toLowerCase();
  if (/\btire/.test(text) || /\bwheel\s+(mount|balance)/.test(text)) return "New tires / wheel work";
  if (/\bexhaust|muffler|catalytic|cat[-\s]?back/.test(text)) return "Exhaust work";
  if (/\btransmission|clutch|differential|driveshaft/.test(text)) return "Transmission / drivetrain";
  if (/\bsuspension|strut|shock|control\s+arm|ball\s+joint|tie\s+rod|sway\s+bar|coilover|alignment/.test(text)) return "Suspension / alignment";
  return null;
}

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
  const [locationAddress, setLocationAddress] = useState("");
  const [locationLat, setLocationLat] = useState<number | null>(null);
  const [locationLng, setLocationLng] = useState<number | null>(null);
  const [zipCode, setZipCode] = useState("");
  const [locating, setLocating] = useState(false);
  const [lookingUpZip, setLookingUpZip] = useState(false);
  const [error, setError] = useState("");

  const liftReason = useMemo(() => detectLiftReason(description), [description]);
  const selectedService = useMemo<ServiceDef | null>(
    () => JOB_CATALOG.find((s) => s.slug === serviceSlug) ?? null,
    [serviceSlug],
  );
  // Group services by customer-facing category for the picker (NOT by tier —
  // tiers are an internal pricing/skill concept the customer shouldn't see).
  // Detailing services are intentionally excluded — those live on the
  // dedicated /detailing page with package pricing.
  const grouped = useMemo(() => {
    const q = serviceQuery.trim().toLowerCase();
    return CATEGORY_ORDER.map((cat) => ({
      category: cat,
      services: JOB_CATALOG
        .filter((s) => s.category === cat.key)
        .filter((s) => q === "" || s.name.toLowerCase().includes(q))
        .sort((a, b) => a.name.localeCompare(b.name)),
    })).filter((g) => g.services.length > 0);
  }, [serviceQuery]);

  const pickDiagnostic = () => {
    setServiceSlug(DIAGNOSTIC_SLUG);
    setServiceQuery("");
  };
  const goToDetailing = () => {
    router.replace("/detailing");
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
    if (!selectedVehicleId) { setError("Please select a vehicle."); return; }
    if (!selectedService) { setError("Please pick the service you need."); return; }
    if (!description.trim()) { setError("Please describe the issue."); return; }
    if (!locationAddress.trim() && !zipCode.trim() && locationLat == null) {
      setError("Please share your location: tap the arrow, enter your ZIP code, or type an address.");
      return;
    }
    const finalAddress = locationAddress.trim() || (zipCode.trim() ? `ZIP ${zipCode.trim()}` : "");
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
          locationAddress: finalAddress || undefined,
          locationLat: locationLat ?? undefined,
          locationLng: locationLng ?? undefined,
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
            <View style={[styles.locBadge, { backgroundColor: colors.primary + "20", borderColor: colors.primary, marginTop: 0, marginBottom: 16 }]}>
              <Feather name="user-check" size={14} color={colors.primary} />
              <Text style={[styles.locBadgeText, { color: colors.foreground }]}>
                Requesting <Text style={{ fontWeight: "800" }}>{requestedMechanicName}</Text> directly
              </Text>
              <Pressable onPress={() => router.replace("/request-service")} hitSlop={8} style={{ marginLeft: "auto" }}>
                <Feather name="x" size={14} color={colors.mutedForeground} />
              </Pressable>
            </View>
          ) : null}

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

          <Text style={[styles.sectionLabel, { color: colors.mutedForeground, marginTop: 20 }]}>SERVICE</Text>
          {selectedService ? (
            <View style={[styles.selectedSvc, { backgroundColor: colors.primary + "12", borderColor: colors.primary }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.selectedSvcName, { color: colors.foreground }]}>{selectedService.name}</Text>
              </View>
              <Pressable onPress={() => setServiceSlug(null)} hitSlop={8} style={[styles.changeBtn, { borderColor: colors.primary }]}>
                <Text style={[styles.changeBtnText, { color: colors.primary }]}>Change</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <TextInput
                style={[styles.input, { backgroundColor: colors.card, color: colors.foreground, borderColor: colors.border }]}
                placeholder="Search services (e.g. oil change, brakes, battery)…"
                placeholderTextColor={colors.mutedForeground}
                value={serviceQuery}
                onChangeText={setServiceQuery}
                autoCapitalize="none"
              />

              {/* "Not sure what you need?" — picks the diagnostic scan service. */}
              <Pressable
                onPress={pickDiagnostic}
                style={[styles.unsureCard, { backgroundColor: colors.primary + "0F", borderColor: colors.primary }]}
              >
                <View style={[styles.unsureIcon, { backgroundColor: colors.primary }]}>
                  <Feather name="help-circle" size={18} color="white" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.unsureTitle, { color: colors.foreground }]}>Not sure what's wrong?</Text>
                  <Text style={[styles.unsureSub, { color: colors.mutedForeground }]}>
                    Request a diagnostic — describe the issue below and a mechanic will scan and identify it for you.
                  </Text>
                </View>
                <Feather name="chevron-right" size={18} color={colors.primary} />
              </Pressable>

              {/* Detailing pointer — keep these flows separated. */}
              <Pressable
                onPress={goToDetailing}
                style={[styles.detailPointer, { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                <Feather name="droplet" size={16} color={colors.primary} />
                <Text style={[styles.detailPointerText, { color: colors.foreground }]}>
                  Looking for a wash, wax, or full detail?{" "}
                  <Text style={{ color: colors.primary, fontWeight: "700" }}>Book detailing →</Text>
                </Text>
              </Pressable>

              <View style={styles.svcList}>
                {grouped.map((g) => (
                  <View key={g.category.key} style={{ marginTop: 14 }}>
                    <View style={styles.catHeaderRow}>
                      <Feather name={g.category.icon} size={14} color={colors.mutedForeground} />
                      <Text style={[styles.catHeader, { color: colors.mutedForeground }]}>
                        {g.category.label}
                      </Text>
                    </View>
                    <View style={{ gap: 6, marginTop: 6 }}>
                      {g.services.map((s) => (
                        <Pressable
                          key={s.slug}
                          style={[styles.svcRow, { backgroundColor: colors.card, borderColor: colors.border }]}
                          onPress={() => setServiceSlug(s.slug)}
                        >
                          <Text style={[styles.svcName, { color: colors.foreground }]}>{s.name}</Text>
                          <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
                        </Pressable>
                      ))}
                    </View>
                  </View>
                ))}
                {grouped.length === 0 ? (
                  <Text style={[styles.helper, { color: colors.mutedForeground, marginTop: 12 }]}>
                    No service matches "{serviceQuery}". Clear the search to browse all, or tap "Not sure what's wrong?" above to request a diagnostic.
                  </Text>
                ) : null}
              </View>
            </>
          )}

          <Text style={[styles.sectionLabel, { color: colors.mutedForeground, marginTop: 20 }]}>DESCRIPTION</Text>
          <TextInput
            style={[styles.textarea, { backgroundColor: colors.card, color: colors.foreground, borderColor: colors.border }]}
            placeholder="Tell the mechanic anything specific they should know…"
            placeholderTextColor={colors.mutedForeground}
            multiline
            numberOfLines={5}
            value={description}
            onChangeText={setDescription}
            textAlignVertical="top"
          />

          {liftReason ? (
            <View style={[styles.liftHit, { backgroundColor: "#F9731612", borderColor: "#F97316" }]}>
              <Feather name="zap" size={16} color="#F97316" />
              <Text style={[styles.liftHitText, { color: colors.foreground }]}>
                <Text style={{ fontWeight: "800" }}>{liftReason}</Text> looks like a shop-bay job — we'll route it to one of our approved shops automatically.
              </Text>
            </View>
          ) : null}

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

          {/* Static reassurance card — replaces the old "Needs an indoor shop bay" toggle. */}
          <View style={[styles.shopCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.shopCardHeader}>
              <View style={[styles.shopCardIcon, { backgroundColor: colors.primary + "1F" }]}>
                <Feather name="shield" size={18} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.shopCardTitle, { color: colors.foreground }]}>
                  Some jobs need a lift
                </Text>
                <Text style={[styles.shopCardSub, { color: colors.mutedForeground }]}>
                  New tires, exhaust, transmission, and suspension work are performed at one of our approved shops.
                </Text>
              </View>
            </View>
            <View style={styles.shopCardBullets}>
              <View style={styles.bulletRow}>
                <Feather name="check-circle" size={14} color="#22C55E" />
                <Text style={[styles.bulletText, { color: colors.foreground }]}>Fully licensed and insured mechanics</Text>
              </View>
              <View style={styles.bulletRow}>
                <Feather name="check-circle" size={14} color="#22C55E" />
                <Text style={[styles.bulletText, { color: colors.foreground }]}>Your vehicle is treated with respect, end to end</Text>
              </View>
              <View style={styles.bulletRow}>
                <Feather name="check-circle" size={14} color="#22C55E" />
                <Text style={[styles.bulletText, { color: colors.foreground }]}>Live GPS tracking from pickup → shop → return, with mileage logged on every leg</Text>
              </View>
            </View>
          </View>

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
    flexDirection: "row", alignItems: "center", gap: 12,
    padding: 14, borderRadius: 12, borderWidth: 2,
  },
  vehicleInfo: { flex: 1 },
  vehicleName: { fontSize: 15, fontWeight: "600" },
  vehicleVin: { fontSize: 12, fontFamily: "monospace" },
  emptyVehicles: {
    flexDirection: "row", alignItems: "center", gap: 12,
    padding: 16, borderRadius: 12, borderWidth: 1,
  },
  emptyVehiclesText: { fontSize: 14, flex: 1 },
  selectedSvc: {
    flexDirection: "row", alignItems: "center", gap: 12,
    padding: 14, borderRadius: 12, borderWidth: 2,
  },
  selectedSvcName: { fontSize: 15, fontWeight: "700" },
  selectedSvcMeta: { fontSize: 12, marginTop: 2 },
  changeBtn: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1.5,
  },
  changeBtnText: { fontSize: 12, fontWeight: "700" },
  svcList: {},
  catHeaderRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  catHeader: { fontSize: 11, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase" },
  unsureCard: {
    flexDirection: "row", alignItems: "center", gap: 12,
    padding: 14, borderRadius: 14, borderWidth: 1.5, marginTop: 12,
  },
  unsureIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  unsureTitle: { fontSize: 14, fontWeight: "800" },
  unsureSub: { fontSize: 12, marginTop: 3, lineHeight: 17 },
  detailPointer: {
    flexDirection: "row", alignItems: "center", gap: 10,
    padding: 12, borderRadius: 12, borderWidth: 1, marginTop: 8,
  },
  detailPointerText: { flex: 1, fontSize: 13, lineHeight: 18 },
  svcRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    padding: 12, borderRadius: 10, borderWidth: 1,
  },
  svcName: { flex: 1, fontSize: 14, fontWeight: "500" },
  textarea: { borderWidth: 1, borderRadius: 12, padding: 14, fontSize: 15, minHeight: 120 },
  liftHit: {
    flexDirection: "row", alignItems: "flex-start", gap: 10,
    padding: 12, borderRadius: 12, borderWidth: 1.5, marginTop: 10,
  },
  liftHitText: { flex: 1, fontSize: 13, lineHeight: 18 },
  locationRow: { flexDirection: "row", gap: 8 },
  input: { height: 48, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, fontSize: 15 },
  locateBtn: { width: 48, height: 48, borderRadius: 10, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  zipBtn: { height: 48, paddingHorizontal: 16, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  zipBtnText: { color: "white", fontWeight: "700", fontSize: 14 },
  helper: { fontSize: 12, marginTop: 6 },
  locBadge: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
    borderWidth: 1, alignSelf: "flex-start", marginTop: 10,
  },
  locBadgeText: { fontSize: 12, fontWeight: "600" },
  shopCard: {
    marginTop: 24, padding: 14, borderRadius: 14, borderWidth: 1,
  },
  shopCardHeader: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  shopCardIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  shopCardTitle: { fontSize: 15, fontWeight: "800", marginBottom: 4 },
  shopCardSub: { fontSize: 12, lineHeight: 17 },
  shopCardBullets: { gap: 8, marginTop: 12, paddingLeft: 4 },
  bulletRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  bulletText: { flex: 1, fontSize: 13, lineHeight: 18 },
  error: { fontSize: 14, marginTop: 8 },
  submitBtn: { height: 56, borderRadius: 14, alignItems: "center", justifyContent: "center", marginTop: 24 },
  submitText: { color: "white", fontWeight: "700", fontSize: 17 },
});
