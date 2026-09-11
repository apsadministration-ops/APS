/**
 * Mechanic payout dashboard — earnings windows, status buckets, recent
 * payouts list, payout-event timeline, and a deep-link to Stripe Express
 * for tax documents (1099).
 */

import { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl, Linking } from "react-native";
import { Stack, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useColors } from "@/hooks/useColors";
import { getApiUrl } from "@/lib/apiConfig";

type Window = "today" | "week" | "month" | "year";

interface Summary { window: string; captured: number; pending: number; tips: number; fees: number; refunded: number; jobCount: number }
interface Buckets { [k: string]: { count: number; total: number } }
interface JobRow {
  id: number; jobId: number; status: string;
  amount: number; mechanicPayout: number;
  createdAt: string;
  job: { jobType: string; status: string } | null;
}
interface EventRow {
  id: number; kind: string; amountCents: number | null; failureMessage: string | null; createdAt: string;
}

export default function PayoutsHome() {
  const colors = useColors();
  const router = useRouter();
  const [window, setWindow] = useState<Window>("month");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [buckets, setBuckets] = useState<Buckets>({});
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const token = await AsyncStorage.getItem("auth_token");
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
      const [s, b, j, e] = await Promise.all([
        fetch(getApiUrl(`/payouts/summary?window=${window}`), { headers }).then((r) => r.json()),
        fetch(getApiUrl("/payouts/buckets"), { headers }).then((r) => r.json()),
        fetch(getApiUrl("/payouts/jobs?limit=20"), { headers }).then((r) => r.json()),
        fetch(getApiUrl("/payouts/events?limit=20"), { headers }).then((r) => r.json()),
      ]);
      setSummary(s);
      setBuckets(b);
      setJobs(Array.isArray(j) ? j : []);
      setEvents(Array.isArray(e) ? e : []);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [window]);

  useEffect(() => { setLoading(true); void load(); }, [load]);

  async function openTaxDocs() {
    try {
      const token = await AsyncStorage.getItem("auth_token");
      const res = await fetch(getApiUrl("/payouts/tax-documents"), {
        headers: token ? { Authorization: `Bearer ${token}` } as Record<string, string> : {},
      });
      const json = await res.json();
      if (res.ok && json.url) await Linking.openURL(json.url);
    } catch { /* noop */ }
  }

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} />}
    >
      <Stack.Screen options={{ title: "Payouts" }} />

      {/* Window toggle */}
      <View style={styles.windowRow}>
        {(["today", "week", "month", "year"] as Window[]).map((w) => {
          const active = window === w;
          return (
            <Pressable key={w} onPress={() => setWindow(w)}
              style={[styles.winBtn, { backgroundColor: active ? colors.primary : colors.secondary }]}>
              <Text style={{ color: active ? "white" : colors.foreground, fontWeight: "600", textTransform: "capitalize" }}>{w}</Text>
            </Pressable>
          );
        })}
      </View>

      {summary && (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>Captured this {summary.window}</Text>
          <Text style={{ color: colors.foreground, fontSize: 32, fontWeight: "800" }}>${summary.captured.toFixed(2)}</Text>
          <View style={styles.row}>
            <Stat label="Pending" value={`$${summary.pending.toFixed(2)}`} colors={colors} />
            <Stat label="Tips" value={`$${summary.tips.toFixed(2)}`} colors={colors} />
            <Stat label="Fees" value={`$${summary.fees.toFixed(2)}`} colors={colors} />
            <Stat label="Jobs" value={String(summary.jobCount)} colors={colors} />
          </View>
        </View>
      )}

      {/* Status buckets */}
      <Text style={[styles.h2, { color: colors.foreground }]}>Status</Text>
      <View style={styles.bucketGrid}>
        {Object.entries(buckets).map(([k, v]) => (
          <View key={k} style={[styles.bucket, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={{ color: colors.mutedForeground, fontSize: 12, textTransform: "capitalize" }}>{k.replace(/_/g, " ")}</Text>
            <Text style={{ color: colors.foreground, fontWeight: "700" }}>{v.count}</Text>
            <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>${v.total.toFixed(2)}</Text>
          </View>
        ))}
      </View>

      {/* Tax documents link */}
      <Pressable onPress={() => void openTaxDocs()}
        style={[styles.linkBtn, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Feather name="file-text" size={18} color={colors.primary} />
        <Text style={{ color: colors.foreground, fontWeight: "600", flex: 1 }}>Tax documents (1099)</Text>
        <Feather name="external-link" size={16} color={colors.mutedForeground} />
      </Pressable>

      {/* Recent jobs */}
      <Text style={[styles.h2, { color: colors.foreground }]}>Recent payouts</Text>
      {jobs.length === 0 ? (
        <Text style={{ color: colors.mutedForeground, marginTop: 8 }}>No jobs yet.</Text>
      ) : jobs.map((j) => (
        <Pressable key={j.id} onPress={() => router.push(`/mechanic/payouts/${j.jobId}`)}
          style={[styles.jobRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.foreground, fontWeight: "600" }}>Job #{j.jobId} — {j.job?.jobType ?? ""}</Text>
            <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
              {new Date(j.createdAt).toLocaleDateString()} · status: {j.status}
            </Text>
          </View>
          <Text style={{ color: colors.foreground, fontWeight: "700" }}>${j.mechanicPayout.toFixed(2)}</Text>
        </Pressable>
      ))}

      {/* Event timeline */}
      <Text style={[styles.h2, { color: colors.foreground }]}>Recent activity</Text>
      {events.length === 0 ? (
        <Text style={{ color: colors.mutedForeground, marginTop: 8 }}>No payout events yet.</Text>
      ) : events.map((e) => (
        <View key={e.id} style={[styles.eventRow, { borderColor: colors.border }]}>
          <Feather
            name={e.kind === "payout_paid" ? "check-circle" : e.kind.includes("failed") ? "alert-circle" : "activity"}
            size={16}
            color={e.kind === "payout_paid" ? "#16a34a" : e.kind.includes("failed") ? "#dc2626" : colors.mutedForeground}
          />
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.foreground, fontSize: 13 }}>{e.kind.replace(/_/g, " ")}</Text>
            {e.failureMessage && <Text style={{ color: "#dc2626", fontSize: 12 }}>{e.failureMessage}</Text>}
            <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>{new Date(e.createdAt).toLocaleString()}</Text>
          </View>
          {e.amountCents != null && (
            <Text style={{ color: colors.foreground, fontWeight: "600" }}>${(e.amountCents / 100).toFixed(2)}</Text>
          )}
        </View>
      ))}
    </ScrollView>
  );
}

function Stat({ label, value, colors }: { label: string; value: string; colors: ReturnType<typeof useColors> }) {
  return (
    <View style={{ flex: 1, minWidth: "22%", marginTop: 12 }}>
      <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{label}</Text>
      <Text style={{ color: colors.foreground, fontWeight: "600" }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  windowRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  winBtn: { flex: 1, padding: 10, borderRadius: 8, alignItems: "center" },
  card: { borderRadius: 12, borderWidth: 1, padding: 16 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  h2: { fontSize: 16, fontWeight: "700", marginTop: 24, marginBottom: 8 },
  bucketGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  bucket: { width: "31%", padding: 12, borderRadius: 10, borderWidth: 1, gap: 2 },
  linkBtn: { marginTop: 16, padding: 14, borderRadius: 10, borderWidth: 1, flexDirection: "row", alignItems: "center", gap: 10 },
  jobRow: { padding: 14, borderRadius: 10, borderWidth: 1, marginBottom: 8, flexDirection: "row", alignItems: "center", gap: 12 },
  eventRow: { padding: 12, borderBottomWidth: 1, flexDirection: "row", alignItems: "center", gap: 12 },
});
