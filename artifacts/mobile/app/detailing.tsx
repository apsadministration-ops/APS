import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator,
} from "react-native";
import { alertMessage } from "@/utils/confirm";
import { Stack, useRouter } from "expo-router";
import { useState } from "react";
import { useColors } from "@/hooks/useColors";
import { useListVehicles, useCreateJob } from "@workspace/api-client-react";
import { Feather } from "@expo/vector-icons";
import * as Location from "expo-location";
import * as Haptics from "expo-haptics";

interface Package {
  id: string;
  name: string;
  description: string;
  duration: string;
  price: string;
  priceValue: number;
  features: string[];
  color: string;
}

const PACKAGES: Package[] = [
  {
    id: "express",
    name: "Express Wash",
    description: "Quick exterior wash and basic interior wipe-down.",
    duration: "45–60 min",
    price: "$30–$50",
    priceValue: 40,
    features: ["Exterior hand wash", "Wheel cleaning", "Interior vacuum", "Window cleaning"],
    color: "#0EA5E9",
  },
  {
    id: "interior",
    name: "Interior Detail",
    description: "Deep clean of all interior surfaces, seats, and carpet.",
    duration: "2–3 hours",
    price: "$80–$120",
    priceValue: 100,
    features: ["Full interior vacuum", "Seat shampooing", "Dashboard & trim clean", "Odor treatment", "Carpet shampoo"],
    color: "#8B5CF6",
  },
  {
    id: "full",
    name: "Full Detail",
    description: "Complete interior + exterior detailing for showroom results.",
    duration: "3–5 hours",
    price: "$150–$220",
    priceValue: 185,
    features: ["Everything in Express + Interior", "Clay bar decontamination", "Polish & wax protection", "Engine bay clean", "Tire dressing"],
    color: "#F97316",
  },
  {
    id: "premium",
    name: "Premium Package",
    description: "The ultimate detailing experience with ceramic coating prep.",
    duration: "5–8 hours",
    price: "$300–$500",
    priceValue: 400,
    features: ["Everything in Full Detail", "Paint correction", "Ceramic coating prep", "Leather conditioning", "Headlight restoration", "Before & after photos"],
    color: "#FBBF24",
  },
];

export default function DetailingScreen() {
  const colors = useColors();
  const router = useRouter();
  const { data: vehicles } = useListVehicles();
  const createMutation = useCreateJob();

  const [selectedPackage, setSelectedPackage] = useState<Package | null>(null);
  const [selectedVehicleId, setSelectedVehicleId] = useState<number | null>(null);
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
        void alertMessage("Permission denied", "Location permission is needed to auto-fill your address.");
        return;
      }
      const loc = await Location.getCurrentPositionAsync({});
      setLocationLat(loc.coords.latitude);
      setLocationLng(loc.coords.longitude);
      const [addr] = await Location.reverseGeocodeAsync({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
      if (addr) setLocationAddress(`${addr.street ?? ""} ${addr.city ?? ""}, ${addr.region ?? ""}`.trim());
    } catch { void alertMessage("Error", "Could not detect location."); }
    finally { setLocating(false); }
  };

  const handleSubmit = () => {
    setError("");
    if (!selectedVehicleId) { setError("Please select your vehicle."); return; }
    if (!selectedPackage) { setError("Please choose a detailing package."); return; }

    const pkg = selectedPackage;
    const vehicle = vehicles?.find((v) => v.id === selectedVehicleId);
    const desc = `${pkg.name}: ${pkg.description} Vehicle: ${vehicle?.year} ${vehicle?.make} ${vehicle?.model}.`;

    createMutation.mutate(
      {
        data: {
          vehicleId: selectedVehicleId,
          jobType: "detailing",
          description: desc,
          estimatedPrice: pkg.priceValue,
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
          setError(e?.message ?? "Failed to book detailing. Please try again.");
        },
      },
    );
  };

  return (
    <>
      <Stack.Screen options={{
        title: "Book Detailing",
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.foreground,
        headerShown: true,
      }} />
      <ScrollView
        style={[styles.container, { backgroundColor: colors.background }]}
        contentContainerStyle={{ padding: 16, paddingBottom: 120, gap: 20 }}
      >
        {/* Hero */}
        <View style={[styles.hero, { backgroundColor: colors.primary + "12", borderColor: colors.primary + "30" }]}>
          <View style={[styles.heroIcon, { backgroundColor: colors.primary }]}>
            <Feather name="droplet" size={28} color="white" />
          </View>
          <View style={styles.heroText}>
            <Text style={[styles.heroTitle, { color: colors.foreground }]}>Mobile Detailing</Text>
            <Text style={[styles.heroDesc, { color: colors.mutedForeground }]}>
              Professional detailers come to you. Pick a package and we'll match you with a certified detailer.
            </Text>
          </View>
        </View>

        {/* Step 1: Vehicle */}
        <View>
          <View style={styles.stepHeader}>
            <View style={[styles.stepBadge, { backgroundColor: colors.primary }]}>
              <Text style={styles.stepNum}>1</Text>
            </View>
            <Text style={[styles.stepTitle, { color: colors.foreground }]}>Select Your Vehicle</Text>
          </View>
          {!vehicles || vehicles.length === 0 ? (
            <View style={[styles.emptyVehicle, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Feather name="truck" size={24} color={colors.mutedForeground} />
              <Text style={[styles.emptyVehicleText, { color: colors.mutedForeground }]}>
                Add a vehicle first from your Vehicles tab.
              </Text>
            </View>
          ) : (
            <View style={styles.vehicleList}>
              {vehicles.map((v) => (
                <Pressable
                  key={v.id}
                  style={[
                    styles.vehicleOption,
                    {
                      backgroundColor: selectedVehicleId === v.id ? colors.primary + "18" : colors.card,
                      borderColor: selectedVehicleId === v.id ? colors.primary : colors.border,
                    },
                  ]}
                  onPress={() => setSelectedVehicleId(v.id)}
                >
                  <View style={[styles.vehicleRadio, {
                    borderColor: selectedVehicleId === v.id ? colors.primary : colors.border,
                    backgroundColor: selectedVehicleId === v.id ? colors.primary : "transparent",
                  }]}>
                    {selectedVehicleId === v.id && <Feather name="check" size={12} color="white" />}
                  </View>
                  <View style={styles.vehicleInfo}>
                    <Text style={[styles.vehicleName, { color: colors.foreground }]}>
                      {v.year} {v.make} {v.model}
                    </Text>
                    <Text style={[styles.vehicleSub, { color: colors.mutedForeground }]}>
                      VIN: {v.vin}{v.plateNumber ? ` · ${v.plateNumber}` : ""}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </View>
          )}
        </View>

        {/* Step 2: Package */}
        <View>
          <View style={styles.stepHeader}>
            <View style={[styles.stepBadge, { backgroundColor: colors.primary }]}>
              <Text style={styles.stepNum}>2</Text>
            </View>
            <Text style={[styles.stepTitle, { color: colors.foreground }]}>Choose a Package</Text>
          </View>
          <View style={styles.packageList}>
            {PACKAGES.map((pkg) => {
              const isSelected = selectedPackage?.id === pkg.id;
              return (
                <Pressable
                  key={pkg.id}
                  style={[
                    styles.packageCard,
                    {
                      backgroundColor: isSelected ? pkg.color + "14" : colors.card,
                      borderColor: isSelected ? pkg.color : colors.border,
                      borderWidth: isSelected ? 2 : 1,
                    },
                  ]}
                  onPress={() => setSelectedPackage(pkg)}
                >
                  <View style={styles.packageHeader}>
                    <View style={[styles.packageIcon, { backgroundColor: pkg.color }]}>
                      <Feather name="droplet" size={18} color="white" />
                    </View>
                    <View style={styles.packageMeta}>
                      <Text style={[styles.packageName, { color: colors.foreground }]}>{pkg.name}</Text>
                      <View style={styles.packagePills}>
                        <View style={[styles.pill, { backgroundColor: pkg.color + "20" }]}>
                          <Feather name="clock" size={10} color={pkg.color} />
                          <Text style={[styles.pillText, { color: pkg.color }]}>{pkg.duration}</Text>
                        </View>
                        <View style={[styles.pill, { backgroundColor: "#22C55E20" }]}>
                          <Feather name="dollar-sign" size={10} color="#22C55E" />
                          <Text style={[styles.pillText, { color: "#22C55E" }]}>{pkg.price}</Text>
                        </View>
                      </View>
                    </View>
                    {isSelected && <Feather name="check-circle" size={22} color={pkg.color} />}
                  </View>
                  <Text style={[styles.packageDesc, { color: colors.mutedForeground }]}>{pkg.description}</Text>
                  <View style={styles.featureList}>
                    {pkg.features.map((f) => (
                      <View key={f} style={styles.featureRow}>
                        <Feather name="check" size={12} color={pkg.color} />
                        <Text style={[styles.featureText, { color: colors.foreground }]}>{f}</Text>
                      </View>
                    ))}
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Step 3: Location */}
        <View>
          <View style={styles.stepHeader}>
            <View style={[styles.stepBadge, { backgroundColor: colors.primary }]}>
              <Text style={styles.stepNum}>3</Text>
            </View>
            <Text style={[styles.stepTitle, { color: colors.foreground }]}>Service Location</Text>
          </View>
          <Pressable
            style={[styles.locationBtn, {
              backgroundColor: locationAddress ? colors.primary + "12" : colors.card,
              borderColor: locationAddress ? colors.primary : colors.border,
            }]}
            onPress={handleDetectLocation}
          >
            {locating
              ? <ActivityIndicator size="small" color={colors.primary} />
              : <Feather name="map-pin" size={18} color={locationAddress ? colors.primary : colors.mutedForeground} />}
            <Text style={[styles.locationText, { color: locationAddress ? colors.primary : colors.mutedForeground }]} numberOfLines={2}>
              {locationAddress || "Tap to use your current location"}
            </Text>
            {!locating && <Feather name="navigation" size={16} color={locationAddress ? colors.primary : colors.mutedForeground} />}
          </Pressable>
        </View>

        {error ? <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}

        {/* CTA */}
        <Pressable
          style={[styles.submitBtn, {
            backgroundColor: (selectedVehicleId && selectedPackage) ? colors.primary : colors.secondary,
            opacity: createMutation.isPending ? 0.7 : 1,
          }]}
          onPress={handleSubmit}
          disabled={createMutation.isPending || !selectedVehicleId || !selectedPackage}
        >
          {createMutation.isPending
            ? <ActivityIndicator color="white" />
            : <>
              <Feather name="droplet" size={18} color={selectedVehicleId && selectedPackage ? "white" : colors.mutedForeground} />
              <Text style={[styles.submitText, { color: selectedVehicleId && selectedPackage ? "white" : colors.mutedForeground }]}>
                {selectedPackage ? `Book ${selectedPackage.name}` : "Book Detailing"}
              </Text>
            </>}
        </Pressable>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  hero: { flexDirection: "row", gap: 14, padding: 16, borderRadius: 18, borderWidth: 1, alignItems: "flex-start" },
  heroIcon: { width: 56, height: 56, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  heroText: { flex: 1, gap: 6 },
  heroTitle: { fontSize: 20, fontWeight: "800" },
  heroDesc: { fontSize: 13, lineHeight: 20 },
  stepHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 },
  stepBadge: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  stepNum: { color: "white", fontSize: 13, fontWeight: "800" },
  stepTitle: { fontSize: 16, fontWeight: "700" },
  emptyVehicle: { flexDirection: "row", gap: 10, alignItems: "center", padding: 16, borderRadius: 12, borderWidth: 1 },
  emptyVehicleText: { fontSize: 14, flex: 1 },
  vehicleList: { gap: 8 },
  vehicleOption: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 12, borderWidth: 1 },
  vehicleRadio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  vehicleInfo: { flex: 1 },
  vehicleName: { fontSize: 15, fontWeight: "600" },
  vehicleSub: { fontSize: 12, marginTop: 2 },
  packageList: { gap: 12 },
  packageCard: { borderRadius: 16, padding: 16, gap: 10 },
  packageHeader: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  packageIcon: { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  packageMeta: { flex: 1, gap: 6 },
  packageName: { fontSize: 16, fontWeight: "700" },
  packagePills: { flexDirection: "row", gap: 6 },
  pill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  pillText: { fontSize: 11, fontWeight: "600" },
  packageDesc: { fontSize: 13, lineHeight: 20 },
  featureList: { gap: 6 },
  featureRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  featureText: { fontSize: 13 },
  locationBtn: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16, borderRadius: 14, borderWidth: 1 },
  locationText: { flex: 1, fontSize: 14 },
  error: { fontSize: 14 },
  submitBtn: {
    height: 56, borderRadius: 16, alignItems: "center", justifyContent: "center",
    flexDirection: "row", gap: 10,
  },
  submitText: { fontSize: 16, fontWeight: "700" },
});
