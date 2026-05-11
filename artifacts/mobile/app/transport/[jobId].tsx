import {
  View, Text, StyleSheet, ActivityIndicator, Pressable, ScrollView, TextInput, Platform,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useGetJob } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import { alertMessage, confirm } from "@/utils/confirm";
import { success as hapticSuccess, tap as hapticTap } from "@/utils/haptics";

type TransportLeg = {
  id: number;
  jobId: number;
  driverId: number;
  direction: "outbound" | "return";
  status: "in_progress" | "completed" | "cancelled";
  startMileage: number;
  endMileage: number | null;
  miles: number | null;
  startedAt: string;
  completedAt: string | null;
  startLat: number | null; startLng: number | null;
  endLat: number | null;   endLng: number | null;
  lastLat: number | null;  lastLng: number | null;
  lastLocationAt: string | null;
  notes: string | null;
};

const apiBase = () => {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  return domain ? `https://${domain}/api` : "/api";
};

async function authedJson<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await AsyncStorage.getItem("auth_token");
  const res = await fetch(`${apiBase()}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  const txt = await res.text();
  const body = txt ? JSON.parse(txt) : null;
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body as T;
}

function fmtTime(s?: string | null) {
  if (!s) return "—";
  return new Date(s).toLocaleString();
}

export default function TransportScreen() {
  const colors = useColors();
  const router = useRouter();
  const qc = useQueryClient();
  const { user } = useAuth();
  const { jobId: rawId } = useLocalSearchParams<{ jobId: string }>();
  const jobId = parseInt(rawId, 10);

  const { data: job } = useGetJob(jobId);
  const [legs, setLegs] = useState<TransportLeg[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const isCustomer = user?.role === "customer";
  const isMechanic = user?.role === "mechanic";

  const refresh = useCallback(async () => {
    try {
      const list = await authedJson<TransportLeg[]>(`/jobs/${jobId}/transport`);
      setLegs(list);
    } catch (e: any) {
      setError(e?.message ?? "Could not load transport history");
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => { refresh(); }, [refresh]);

  // Customer view auto-polls every 12s while there's an active leg.
  const activeLeg = useMemo(() => legs?.find((l) => l.status === "in_progress") ?? null, [legs]);
  useEffect(() => {
    if (!activeLeg || !isCustomer) return;
    const t = setInterval(refresh, 12000);
    return () => clearInterval(t);
  }, [activeLeg?.id, isCustomer, refresh]);

  // Mechanic GPS heartbeat for the active leg.
  const watchRef = useRef<Location.LocationSubscription | null>(null);
  useEffect(() => {
    if (!isMechanic || !activeLeg) return;
    let cancelled = false;
    (async () => {
      if (Platform.OS === "web") return;
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted" || cancelled) return;
      watchRef.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 15000, distanceInterval: 50 },
        (loc) => {
          authedJson(`/jobs/${jobId}/transport/legs/${activeLeg.id}/location`, {
            method: "PATCH",
            body: JSON.stringify({ lat: loc.coords.latitude, lng: loc.coords.longitude }),
          }).catch(() => {});
        },
      );
    })();
    return () => {
      cancelled = true;
      watchRef.current?.remove();
      watchRef.current = null;
    };
  }, [activeLeg?.id, isMechanic, jobId]);

  const completedOutbound = useMemo(
    () => legs?.find((l) => l.direction === "outbound" && l.status === "completed") ?? null,
    [legs],
  );
  const completedReturn = useMemo(
    () => legs?.find((l) => l.direction === "return" && l.status === "completed") ?? null,
    [legs],
  );
  const nextDirection: "outbound" | "return" | null = useMemo(() => {
    if (activeLeg) return null;
    if (!completedOutbound) return "outbound";
    if (!completedReturn) return "return";
    return null;
  }, [activeLeg, completedOutbound, completedReturn]);

  const startLeg = async (direction: "outbound" | "return") => {
    setError("");
    const mileageStr = await promptMileage(`Odometer reading BEFORE driving (${direction === "outbound" ? "to shop" : "back to customer"})`);
    if (mileageStr == null) return;
    const startMileage = parseInt(mileageStr, 10);
    if (!Number.isFinite(startMileage) || startMileage < 0) {
      void alertMessage("Invalid", "Enter the current odometer reading in whole miles.");
      return;
    }
    setSubmitting(true);
    try {
      let coords: { lat: number; lng: number } | null = null;
      if (Platform.OS !== "web") {
        try {
          const { status } = await Location.requestForegroundPermissionsAsync();
          if (status === "granted") {
            const loc = await Location.getCurrentPositionAsync({});
            coords = { lat: loc.coords.latitude, lng: loc.coords.longitude };
          }
        } catch { /* no-op */ }
      }
      await authedJson(`/jobs/${jobId}/transport/legs`, {
        method: "POST",
        body: JSON.stringify({
          direction, startMileage,
          startLat: coords?.lat, startLng: coords?.lng,
        }),
      });
      hapticSuccess();
      await refresh();
      qc.invalidateQueries({ queryKey: ["jobs"] });
    } catch (e: any) {
      setError(e?.message ?? "Could not start transport leg");
    } finally {
      setSubmitting(false);
    }
  };

  const finishLeg = async (leg: TransportLeg) => {
    setError("");
    const mileageStr = await promptMileage(`Odometer reading AFTER arriving (start was ${leg.startMileage})`);
    if (mileageStr == null) return;
    const endMileage = parseInt(mileageStr, 10);
    if (!Number.isFinite(endMileage) || endMileage < leg.startMileage) {
      void alertMessage("Invalid", `End mileage must be ≥ ${leg.startMileage}.`);
      return;
    }
    const ok = await confirm({
      title: "Finish transport?",
      message: `${endMileage - leg.startMileage} miles will be logged for this ${leg.direction === "outbound" ? "outbound" : "return"} trip.`,
      confirmText: "Finish leg",
    });
    if (!ok) return;
    setSubmitting(true);
    try {
      let coords: { lat: number; lng: number } | null = null;
      if (Platform.OS !== "web") {
        try {
          const loc = await Location.getCurrentPositionAsync({});
          coords = { lat: loc.coords.latitude, lng: loc.coords.longitude };
        } catch { /* no-op */ }
      }
      await authedJson(`/jobs/${jobId}/transport/legs/${leg.id}/finish`, {
        method: "PATCH",
        body: JSON.stringify({ endMileage, endLat: coords?.lat, endLng: coords?.lng }),
      });
      hapticSuccess();
      await refresh();
    } catch (e: any) {
      setError(e?.message ?? "Could not finish leg");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{
        title: "Vehicle Transport",
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.foreground,
      }} />
      <ScrollView style={[styles.container, { backgroundColor: colors.background }]} contentContainerStyle={{ padding: 16, paddingBottom: 120 }}>
        {/* Reassurance banner */}
        <View style={[styles.bannerCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="shield" size={18} color={colors.primary} />
          <Text style={[styles.bannerText, { color: colors.foreground }]}>
            Your mechanic is licensed, insured, and respects your vehicle. Mileage is logged before and after every trip — both legs.
          </Text>
        </View>

        {job?.requiresGhostGarage === false ? (
          <View style={[styles.infoBanner, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="info" size={14} color={colors.mutedForeground} />
            <Text style={[styles.infoText, { color: colors.mutedForeground }]}>
              This job is being performed at your location — no transport required.
            </Text>
          </View>
        ) : null}

        {/* Outbound leg */}
        <LegCard
          title="Outbound — to the shop"
          icon="truck"
          leg={legs?.find((l) => l.direction === "outbound") ?? null}
          colors={colors}
          isMechanic={isMechanic}
          submitting={submitting}
          onStart={() => startLeg("outbound")}
          onFinish={(l) => finishLeg(l)}
          canStart={nextDirection === "outbound" && (job?.customerTransportApproved ?? false)}
        />

        {/* Return leg */}
        <LegCard
          title="Return — back to you"
          icon="corner-up-left"
          leg={legs?.find((l) => l.direction === "return") ?? null}
          colors={colors}
          isMechanic={isMechanic}
          submitting={submitting}
          onStart={() => startLeg("return")}
          onFinish={(l) => finishLeg(l)}
          canStart={nextDirection === "return"}
        />

        {/* Live tracking summary for customer */}
        {isCustomer && activeLeg ? (
          <View style={[styles.liveCard, { backgroundColor: "#22C55E12", borderColor: "#22C55E" }]}>
            <View style={styles.liveDotRow}>
              <View style={styles.liveDot} />
              <Text style={[styles.liveTitle, { color: "#15803D" }]}>
                LIVE — {activeLeg.direction === "outbound" ? "headed to shop" : "headed to you"}
              </Text>
            </View>
            <Text style={[styles.liveSub, { color: colors.foreground }]}>
              Last position update: {fmtTime(activeLeg.lastLocationAt)}
            </Text>
            {activeLeg.lastLat != null && activeLeg.lastLng != null ? (
              <Text style={[styles.coords, { color: colors.mutedForeground }]}>
                {activeLeg.lastLat.toFixed(4)}, {activeLeg.lastLng.toFixed(4)}
              </Text>
            ) : (
              <Text style={[styles.coords, { color: colors.mutedForeground }]}>
                Waiting for first GPS ping…
              </Text>
            )}
          </View>
        ) : null}

        {error ? (
          <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text>
        ) : null}

        <Pressable
          onPress={() => { hapticTap(); router.push(`/job/${jobId}`); }}
          style={[styles.linkBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
        >
          <Feather name="external-link" size={14} color={colors.foreground} />
          <Text style={[styles.linkBtnText, { color: colors.foreground }]}>Back to job details</Text>
        </Pressable>
      </ScrollView>
    </>
  );
}

function LegCard({
  title, icon, leg, colors, isMechanic, submitting, onStart, onFinish, canStart,
}: {
  title: string;
  icon: keyof typeof Feather.glyphMap;
  leg: TransportLeg | null;
  colors: ReturnType<typeof useColors>;
  isMechanic: boolean;
  submitting: boolean;
  onStart: () => void;
  onFinish: (leg: TransportLeg) => void;
  canStart: boolean;
}) {
  const statusColor = !leg ? colors.mutedForeground
    : leg.status === "completed" ? "#22C55E"
    : leg.status === "in_progress" ? "#F97316"
    : colors.mutedForeground;

  return (
    <View style={[styles.legCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.legHeader}>
        <View style={[styles.legIcon, { backgroundColor: statusColor + "20" }]}>
          <Feather name={icon} size={16} color={statusColor} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.legTitle, { color: colors.foreground }]}>{title}</Text>
          <Text style={[styles.legStatus, { color: statusColor }]}>
            {!leg ? "Not started"
              : leg.status === "completed" ? "Completed"
              : leg.status === "in_progress" ? "In progress"
              : "Cancelled"}
          </Text>
        </View>
      </View>

      {leg ? (
        <View style={styles.legBody}>
          <Row label="Started" value={fmtTime(leg.startedAt)} colors={colors} />
          <Row label="Start mileage" value={`${leg.startMileage.toLocaleString()} mi`} colors={colors} />
          {leg.completedAt ? <Row label="Arrived" value={fmtTime(leg.completedAt)} colors={colors} /> : null}
          {leg.endMileage != null ? (
            <>
              <Row label="End mileage" value={`${leg.endMileage.toLocaleString()} mi`} colors={colors} />
              <Row label="Miles driven" value={`${(leg.miles ?? 0).toLocaleString()} mi`} highlight colors={colors} />
            </>
          ) : null}
        </View>
      ) : null}

      {isMechanic ? (
        <View style={styles.legActions}>
          {!leg && canStart ? (
            <Pressable
              style={[styles.actionBtn, { backgroundColor: colors.primary }, submitting && { opacity: 0.6 }]}
              onPress={onStart} disabled={submitting}
            >
              <Feather name="play" size={14} color="white" />
              <Text style={styles.actionBtnText}>Start leg + log mileage</Text>
            </Pressable>
          ) : null}
          {leg && leg.status === "in_progress" ? (
            <Pressable
              style={[styles.actionBtn, { backgroundColor: "#22C55E" }, submitting && { opacity: 0.6 }]}
              onPress={() => onFinish(leg)} disabled={submitting}
            >
              <Feather name="check" size={14} color="white" />
              <Text style={styles.actionBtnText}>Finish leg + log mileage</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function Row({ label, value, highlight, colors }: { label: string; value: string; highlight?: boolean; colors: ReturnType<typeof useColors> }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Text style={[styles.rowValue, { color: highlight ? colors.primary : colors.foreground, fontWeight: highlight ? "800" : "600" }]}>{value}</Text>
    </View>
  );
}

// Cross-platform mileage prompt. RN's `Alert.prompt` is iOS-only; on
// Android/web we render an inline TextInput inside an alert via confirm fallback.
async function promptMileage(title: string): Promise<string | null> {
  return new Promise((resolve) => {
    if (Platform.OS === "ios") {
      // Lazy require to avoid native dep on web
      const { Alert } = require("react-native");
      Alert.prompt(title, "Whole miles only", [
        { text: "Cancel", style: "cancel", onPress: () => resolve(null) },
        { text: "OK", onPress: (v?: string) => resolve(v ?? null) },
      ], "plain-text", "", "number-pad");
      return;
    }
    if (Platform.OS === "web") {
      // eslint-disable-next-line no-alert
      const v = typeof window !== "undefined" ? window.prompt(title) : null;
      resolve(v && v.trim() ? v.trim() : null);
      return;
    }
    // Android: simple modal inline.
    AndroidMileagePrompt.show(title, resolve);
  });
}

// Lightweight singleton modal shim for Android.
const AndroidMileagePrompt = (() => {
  let setter: ((p: { open: boolean; title: string; resolve: (v: string | null) => void }) => void) | null = null;
  return {
    register(s: typeof setter) { setter = s; },
    show(title: string, resolve: (v: string | null) => void) {
      if (setter) setter({ open: true, title, resolve });
      else resolve(null);
    },
  };
})();

export function MileagePromptHost() {
  const colors = useColors();
  const [state, setState] = useState<{ open: boolean; title: string; resolve: (v: string | null) => void }>({ open: false, title: "", resolve: () => {} });
  const [val, setVal] = useState("");
  useEffect(() => { AndroidMileagePrompt.register(setState); }, []);
  if (!state.open) return null;
  const close = (v: string | null) => { state.resolve(v); setState({ open: false, title: "", resolve: () => {} }); setVal(""); };
  return (
    <View style={hostStyles.overlay}>
      <View style={[hostStyles.box, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[hostStyles.title, { color: colors.foreground }]}>{state.title}</Text>
        <TextInput
          style={[hostStyles.input, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
          value={val} onChangeText={setVal} keyboardType="number-pad" autoFocus placeholder="Whole miles" placeholderTextColor={colors.mutedForeground}
        />
        <View style={hostStyles.btnRow}>
          <Pressable style={[hostStyles.btn, { backgroundColor: colors.background, borderColor: colors.border, borderWidth: 1 }]} onPress={() => close(null)}>
            <Text style={{ color: colors.foreground, fontWeight: "700" }}>Cancel</Text>
          </Pressable>
          <Pressable style={[hostStyles.btn, { backgroundColor: colors.primary }]} onPress={() => close(val)}>
            <Text style={{ color: "white", fontWeight: "700" }}>OK</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  bannerCard: {
    flexDirection: "row", alignItems: "flex-start", gap: 10,
    padding: 14, borderRadius: 14, borderWidth: 1, marginBottom: 16,
  },
  bannerText: { flex: 1, fontSize: 13, lineHeight: 18 },
  infoBanner: { flexDirection: "row", gap: 8, padding: 10, borderRadius: 10, borderWidth: 1, marginBottom: 12 },
  infoText: { fontSize: 12, flex: 1 },
  legCard: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 12, gap: 12 },
  legHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  legIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  legTitle: { fontSize: 15, fontWeight: "800" },
  legStatus: { fontSize: 12, fontWeight: "700", marginTop: 2 },
  legBody: { gap: 6 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  rowLabel: { fontSize: 12, fontWeight: "600" },
  rowValue: { fontSize: 13 },
  legActions: { flexDirection: "row", gap: 8 },
  actionBtn: {
    flex: 1, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center",
    height: 44, borderRadius: 10,
  },
  actionBtnText: { color: "white", fontWeight: "700", fontSize: 13 },
  liveCard: { padding: 14, borderRadius: 14, borderWidth: 1.5, marginTop: 4, marginBottom: 12 },
  liveDotRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  liveDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#22C55E" },
  liveTitle: { fontSize: 12, fontWeight: "800", letterSpacing: 0.5 },
  liveSub: { fontSize: 13, marginTop: 6 },
  coords: { fontSize: 12, marginTop: 2, fontFamily: "monospace" },
  error: { fontSize: 13, marginTop: 8 },
  linkBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    height: 44, borderRadius: 10, borderWidth: 1, marginTop: 16,
  },
  linkBtnText: { fontWeight: "700", fontSize: 13 },
});

const hostStyles = StyleSheet.create({
  overlay: {
    position: "absolute", inset: 0 as any, top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", zIndex: 999,
  },
  box: { width: "85%", maxWidth: 360, padding: 18, borderRadius: 14, borderWidth: 1, gap: 12 },
  title: { fontSize: 15, fontWeight: "700" },
  input: { height: 46, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, fontSize: 16 },
  btnRow: { flexDirection: "row", gap: 8 },
  btn: { flex: 1, height: 44, borderRadius: 10, alignItems: "center", justifyContent: "center" },
});
