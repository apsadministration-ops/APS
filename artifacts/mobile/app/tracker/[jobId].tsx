import {
  View, Text, StyleSheet, ActivityIndicator, Pressable, Platform,
} from "react-native";
import { useLocalSearchParams, Stack, useRouter } from "expo-router";
import { useState, useEffect, useRef, useCallback } from "react";
import { useGetJob } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { Feather } from "@expo/vector-icons";
import * as Location from "expo-location";
import AsyncStorage from "@react-native-async-storage/async-storage";

const STATUS_ORDER = ["REQUESTED", "OFFERED", "ACCEPTED", "EN_ROUTE", "IN_PROGRESS", "COMPLETED", "PAID"];

const STATUS_META: Record<string, { label: string; icon: string; color: string }> = {
  REQUESTED: { label: "Job Requested", icon: "file-text", color: "#6366F1" },
  OFFERED: { label: "Offer Sent", icon: "send", color: "#8B5CF6" },
  ACCEPTED: { label: "Mechanic Assigned", icon: "user-check", color: "#0EA5E9" },
  EN_ROUTE: { label: "Mechanic En Route", icon: "navigation", color: "#F97316" },
  IN_PROGRESS: { label: "In Progress", icon: "tool", color: "#F97316" },
  COMPLETED: { label: "Service Complete", icon: "check-circle", color: "#22C55E" },
  PAID: { label: "Payment Released", icon: "dollar-sign", color: "#22C55E" },
  CANCELLED: { label: "Cancelled", icon: "x-circle", color: "#EF4444" },
};

function StatusStep({
  status, active, done, isLast, primaryColor,
}: { status: string; active: boolean; done: boolean; isLast: boolean; primaryColor: string }) {
  const colors = useColors();
  const meta = STATUS_META[status] ?? { label: status, icon: "circle", color: colors.mutedForeground };
  const dotColor = done ? primaryColor : active ? meta.color : colors.border;

  return (
    <View style={styles.stepRow}>
      <View style={styles.stepLeft}>
        <View style={[styles.stepDot, { backgroundColor: active || done ? dotColor : colors.card, borderColor: dotColor, borderWidth: 2 }]}>
          {(active || done) && (
            <Feather name={meta.icon as any} size={10} color="white" />
          )}
        </View>
        {!isLast && <View style={[styles.stepLine, { backgroundColor: done ? primaryColor : colors.border }]} />}
      </View>
      <View style={styles.stepContent}>
        <Text style={[styles.stepLabel, { color: active ? meta.color : done ? colors.foreground : colors.mutedForeground, fontWeight: active ? "700" : "500" }]}>
          {meta.label}
        </Text>
        {active && (
          <View style={[styles.activePill, { backgroundColor: meta.color + "20" }]}>
            <Text style={[styles.activePillText, { color: meta.color }]}>CURRENT</Text>
          </View>
        )}
      </View>
    </View>
  );
}

export default function TrackerScreen() {
  const colors = useColors();
  const { user } = useAuth();
  const router = useRouter();
  const { jobId: rawId } = useLocalSearchParams<{ jobId: string }>();
  const jobId = parseInt(rawId, 10);

  const { data: job, refetch } = useGetJob(jobId);

  const [mechanicCoords, setMechanicCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locationPermission, setLocationPermission] = useState<"unknown" | "granted" | "denied">("unknown");
  const [isSharing, setIsSharing] = useState(false);
  const locationWatchRef = useRef<Location.LocationSubscription | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isMechanic = user?.role === "mechanic";
  const isCustomer = user?.role === "customer";
  const isActive = job?.status === "EN_ROUTE" || job?.status === "IN_PROGRESS";

  // Customer: auto-poll for mechanic location every 10s while active
  useEffect(() => {
    if (!isCustomer || !isActive) return;
    pollingRef.current = setInterval(() => {
      refetch().then((res) => {
        const j = res.data;
        if (j?.mechanicLat && j?.mechanicLng) {
          setMechanicCoords({ lat: j.mechanicLat, lng: j.mechanicLng });
        }
      });
    }, 10000);
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, [isCustomer, isActive]);

  // Set initial mechanic coords from job data
  useEffect(() => {
    if (job?.mechanicLat && job?.mechanicLng) {
      setMechanicCoords({ lat: job.mechanicLat, lng: job.mechanicLng });
    }
  }, [job?.mechanicLat, job?.mechanicLng]);

  // Mechanic: start sharing GPS location
  const startSharingLocation = useCallback(async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") { setLocationPermission("denied"); return; }
    setLocationPermission("granted");
    setIsSharing(true);

    locationWatchRef.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, timeInterval: 15000, distanceInterval: 20 },
      async (loc) => {
        const { latitude, longitude } = loc.coords;
        try {
          const token = await AsyncStorage.getItem("auth_token");
          const domain = process.env.EXPO_PUBLIC_DOMAIN;
          await fetch(`https://${domain}/api/jobs/${jobId}/mechanic-location`, {
            method: "PUT",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ lat: latitude, lng: longitude }),
          });
        } catch { /* non-fatal */ }
      },
    );
  }, [jobId]);

  const stopSharingLocation = useCallback(() => {
    locationWatchRef.current?.remove();
    locationWatchRef.current = null;
    setIsSharing(false);
  }, []);

  useEffect(() => {
    return () => {
      locationWatchRef.current?.remove();
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

  if (!job) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const currentIndex = STATUS_ORDER.indexOf(job.status);
  const visibleStatuses = job.status === "CANCELLED"
    ? ["REQUESTED", "CANCELLED"]
    : STATUS_ORDER.filter((s) => s !== "OFFERED");

  const activeMeta = STATUS_META[job.status];

  return (
    <>
      <Stack.Screen options={{
        title: `Job Tracker`,
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.foreground,
        headerShown: true,
      }} />
      <View style={[styles.container, { backgroundColor: colors.background }]}>

        {/* Live Status Hero */}
        <View style={[styles.hero, { backgroundColor: activeMeta?.color ?? colors.primary }]}>
          <Feather name={(activeMeta?.icon ?? "circle") as any} size={40} color="white" />
          <Text style={styles.heroStatus}>{activeMeta?.label ?? job.status}</Text>
          <Text style={styles.heroVehicle}>
            {job.vehicle?.year} {job.vehicle?.make} {job.vehicle?.model}
          </Text>
          {isActive && (
            <View style={styles.livePill}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>LIVE</Text>
            </View>
          )}
        </View>

        <View style={styles.content}>
          {/* Timeline */}
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Status Timeline</Text>
          <View style={[styles.timelineCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {visibleStatuses.map((s, i) => (
              <StatusStep
                key={s}
                status={s}
                active={s === job.status}
                done={STATUS_ORDER.indexOf(s) < currentIndex}
                isLast={i === visibleStatuses.length - 1}
                primaryColor={colors.primary}
              />
            ))}
          </View>

          {/* Mechanic Location Panel */}
          {isMechanic && isActive && (
            <View style={[styles.locationCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.locationHeader}>
                <Feather name="navigation" size={20} color={colors.primary} />
                <Text style={[styles.locationTitle, { color: colors.foreground }]}>Share My Location</Text>
              </View>
              <Text style={[styles.locationDesc, { color: colors.mutedForeground }]}>
                When active, your GPS is sent to the customer every 15 seconds.
              </Text>
              {locationPermission === "denied" && (
                <Text style={[styles.locationError, { color: colors.destructive }]}>
                  Location permission denied. Please enable in device settings.
                </Text>
              )}
              <Pressable
                style={[styles.locationBtn, { backgroundColor: isSharing ? colors.destructive : colors.primary }]}
                onPress={isSharing ? stopSharingLocation : startSharingLocation}
              >
                <Feather name={isSharing ? "x" : "navigation"} size={16} color="white" />
                <Text style={styles.locationBtnText}>
                  {isSharing ? "Stop Sharing" : "Start Sharing Location"}
                </Text>
              </Pressable>
              {isSharing && (
                <View style={styles.sharingBadge}>
                  <View style={styles.sharingDot} />
                  <Text style={[styles.sharingText, { color: "#22C55E" }]}>Broadcasting location to customer</Text>
                </View>
              )}
            </View>
          )}

          {/* Customer Map Placeholder / Location Info */}
          {isCustomer && isActive && (
            <View style={[styles.locationCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.locationHeader}>
                <Feather name="map-pin" size={20} color={colors.primary} />
                <Text style={[styles.locationTitle, { color: colors.foreground }]}>Mechanic Location</Text>
              </View>
              {mechanicCoords ? (
                <>
                  <View style={[styles.coordsBox, { backgroundColor: colors.background, borderColor: colors.border }]}>
                    <Feather name="navigation" size={16} color={colors.primary} />
                    <Text style={[styles.coordsText, { color: colors.foreground }]}>
                      {mechanicCoords.lat.toFixed(5)}, {mechanicCoords.lng.toFixed(5)}
                    </Text>
                  </View>
                  <Text style={[styles.locationDesc, { color: colors.mutedForeground }]}>
                    Your mechanic's location is updating every 15 seconds while en route.
                  </Text>
                  <View style={styles.sharingBadge}>
                    <ActivityIndicator size="small" color={colors.primary} />
                    <Text style={[styles.sharingText, { color: colors.mutedForeground }]}>Updating automatically</Text>
                  </View>
                </>
              ) : (
                <Text style={[styles.locationDesc, { color: colors.mutedForeground }]}>
                  Waiting for mechanic to share location…
                </Text>
              )}
            </View>
          )}

          {/* Job Info */}
          <View style={[styles.infoCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.infoRow}>
              <Feather name="hash" size={14} color={colors.mutedForeground} />
              <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>Job ID</Text>
              <Text style={[styles.infoValue, { color: colors.foreground }]}>#{job.id}</Text>
            </View>
            <View style={styles.infoRow}>
              <Feather name="tool" size={14} color={colors.mutedForeground} />
              <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>Type</Text>
              <Text style={[styles.infoValue, { color: colors.foreground }]}>{job.jobType?.toUpperCase()}</Text>
            </View>
            {job.mechanicName && (
              <View style={styles.infoRow}>
                <Feather name="user" size={14} color={colors.mutedForeground} />
                <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>Mechanic</Text>
                <Text style={[styles.infoValue, { color: colors.foreground }]}>{job.mechanicName}</Text>
              </View>
            )}
            {job.locationAddress && (
              <View style={styles.infoRow}>
                <Feather name="map-pin" size={14} color={colors.mutedForeground} />
                <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>Location</Text>
                <Text style={[styles.infoValue, { color: colors.foreground }]} numberOfLines={2}>{job.locationAddress}</Text>
              </View>
            )}
          </View>

          <Pressable
            style={[styles.backBtn, { borderColor: colors.border }]}
            onPress={() => router.push(`/job/${jobId}`)}
          >
            <Feather name="arrow-left" size={16} color={colors.foreground} />
            <Text style={[styles.backBtnText, { color: colors.foreground }]}>Job Details</Text>
          </Pressable>
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  hero: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 32,
    paddingHorizontal: 20,
    gap: 8,
  },
  heroStatus: { fontSize: 22, fontWeight: "800", color: "white" },
  heroVehicle: { fontSize: 14, color: "rgba(255,255,255,0.85)", fontWeight: "500" },
  livePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(255,255,255,0.25)",
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 20,
    marginTop: 4,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "white" },
  liveText: { color: "white", fontWeight: "800", fontSize: 11, letterSpacing: 1 },
  content: { flex: 1, padding: 16, gap: 12, paddingBottom: 40 },
  sectionTitle: { fontSize: 13, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: -4 },
  timelineCard: { borderWidth: 1, borderRadius: 16, padding: 20, gap: 0 },
  stepRow: { flexDirection: "row", gap: 14 },
  stepLeft: { width: 24, alignItems: "center" },
  stepDot: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  stepLine: { width: 2, flex: 1, marginTop: 4, marginBottom: 4, minHeight: 20 },
  stepContent: { flex: 1, paddingBottom: 16, flexDirection: "row", alignItems: "center", gap: 10 },
  stepLabel: { fontSize: 14 },
  activePill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  activePillText: { fontSize: 9, fontWeight: "800", letterSpacing: 1 },
  locationCard: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 10 },
  locationHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  locationTitle: { fontSize: 16, fontWeight: "700" },
  locationDesc: { fontSize: 13, lineHeight: 20 },
  locationError: { fontSize: 13 },
  locationBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 48,
    borderRadius: 12,
  },
  locationBtnText: { color: "white", fontWeight: "700", fontSize: 15 },
  sharingBadge: { flexDirection: "row", alignItems: "center", gap: 8 },
  sharingDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#22C55E" },
  sharingText: { fontSize: 13 },
  coordsBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  coordsText: { fontSize: 13, fontFamily: "monospace" },
  infoCard: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 12 },
  infoRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  infoLabel: { fontSize: 13, width: 72 },
  infoValue: { fontSize: 13, fontWeight: "600", flex: 1 },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
  },
  backBtnText: { fontSize: 15, fontWeight: "600" },
});
