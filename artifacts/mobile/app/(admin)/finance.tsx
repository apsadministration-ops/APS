import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useColors } from "@/hooks/useColors";
import { Feather } from "@expo/vector-icons";
import { getApiUrl } from "@/lib/apiConfig";

interface Global {
  windowDays: number;
  jobs: number;
  grossCents: number;
  taxCents: number;
  partsCents: number;
  laborCents: number;
  apsCommissionCents: number;
  mechanicPayoutCents: number;
  stripeFeeCents: number;
  avgProfitPerJobCents: number;
  avgApsMarginPct: number;
}

interface MechRow {
  mechanicId: number | null;
  mechanic: { id: number; name: string; tier: string } | null;
  jobs: number;
  grossCents: number;
  payoutCents: number;
  partsReimbursementCents: number;
  flaggedJobs: number;
}

interface FlaggedRow {
  worklogId: number;
  jobId: number;
  mechanicId: number;
  partsCost: number;
  laborCost: number;
  flagReason: string | null;
  createdAt: string;
}

const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;
async function authedGet<T>(path: string): Promise<T> {
  const token = await AsyncStorage.getItem("auth_token");
  const res = await fetch(getApiUrl(path), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<T>;
}

export default function AdminFinanceScreen() {
  const colors = useColors();
  const router = useRouter();
  const [tab, setTab] = useState<"global" | "mechanics" | "flagged">("global");
  const [global, setGlobal] = useState<Global | null>(null);
  const [mechs, setMechs] = useState<MechRow[]>([]);
  const [flagged, setFlagged] = useState<FlaggedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true); setError("");
      try {
        const [g, m, f] = await Promise.all([
          authedGet<Global>("/admin/finance/global?days=30"),
          authedGet<MechRow[]>("/admin/finance/mechanics"),
          authedGet<FlaggedRow[]>("/admin/finance/flagged"),
        ]);
        setGlobal(g); setMechs(m); setFlagged(f);
      } catch (e) {
        setError((e as Error).message || "Failed to load finance data");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <>
      <Stack.Screen options={{ title: "Finance", headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.foreground }} />
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.tabs, { borderBottomColor: colors.border }]}>
          {(["global", "mechanics", "flagged"] as const).map((t) => (
            <Pressable key={t} onPress={() => setTab(t)} style={[styles.tab, tab === t && { borderBottomColor: colors.primary }]}>
              <Text style={{ color: tab === t ? colors.primary : colors.mutedForeground, fontWeight: "600", textTransform: "capitalize" }}>
                {t === "flagged" ? `Flagged (${flagged.length})` : t}
              </Text>
            </Pressable>
          ))}
        </View>

        {loading && <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />}
        {!!error && <Text style={{ color: "#ef4444", padding: 16 }}>{error}</Text>}

        {!loading && tab === "global" && global && (
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120 }}>
            <Text style={[styles.muted, { color: colors.mutedForeground }]}>LAST {global.windowDays} DAYS · {global.jobs} CAPTURED JOBS</Text>
            <Stat colors={colors} label="Gross revenue" value={fmt(global.grossCents)} accent />
            <View style={styles.grid}>
              <Stat colors={colors} label="Labor revenue" value={fmt(global.laborCents)} half />
              <Stat colors={colors} label="Parts (passthrough)" value={fmt(global.partsCents)} half />
              <Stat colors={colors} label="Sales tax (passthrough)" value={fmt(global.taxCents)} half />
              <Stat colors={colors} label="Stripe fees" value={fmt(global.stripeFeeCents)} half />
            </View>
            <Stat colors={colors} label="APS commission (net profit basis)" value={fmt(global.apsCommissionCents)} accent />
            <Stat colors={colors} label="Mechanic payouts" value={fmt(global.mechanicPayoutCents)} />
            <View style={styles.grid}>
              <Stat colors={colors} label="Avg profit / job" value={fmt(global.avgProfitPerJobCents)} half />
              <Stat colors={colors} label="Avg APS margin" value={`${(global.avgApsMarginPct * 100).toFixed(1)}%`} half />
            </View>
          </ScrollView>
        )}

        {!loading && tab === "mechanics" && (
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120 }}>
            {mechs.length === 0 && <Text style={{ color: colors.mutedForeground }}>No captured payouts yet.</Text>}
            {mechs.map((m) => (
              <View key={String(m.mechanicId)} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Text style={{ color: colors.foreground, fontWeight: "700", fontSize: 16 }}>
                    {m.mechanic?.name ?? `Mechanic #${m.mechanicId ?? "?"}`}
                  </Text>
                  {m.mechanic?.tier && (
                    <Text style={{ color: colors.mutedForeground, fontSize: 11, textTransform: "capitalize" }}>{m.mechanic.tier}</Text>
                  )}
                </View>
                <View style={{ flexDirection: "row", marginTop: 8, gap: 12, flexWrap: "wrap" }}>
                  <Text style={{ color: colors.mutedForeground }}>Jobs: <Text style={{ color: colors.foreground, fontWeight: "600" }}>{m.jobs}</Text></Text>
                  <Text style={{ color: colors.mutedForeground }}>Gross: <Text style={{ color: colors.foreground, fontWeight: "600" }}>{fmt(m.grossCents)}</Text></Text>
                  <Text style={{ color: colors.mutedForeground }}>Payout: <Text style={{ color: colors.foreground, fontWeight: "600" }}>{fmt(m.payoutCents)}</Text></Text>
                  <Text style={{ color: colors.mutedForeground }}>Parts: <Text style={{ color: colors.foreground, fontWeight: "600" }}>{fmt(m.partsReimbursementCents)}</Text></Text>
                  {m.flaggedJobs > 0 && (
                    <Text style={{ color: "#f59e0b", fontWeight: "700" }}>⚠ {m.flaggedJobs} flagged</Text>
                  )}
                </View>
              </View>
            ))}
          </ScrollView>
        )}

        {!loading && tab === "flagged" && (
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120 }}>
            {flagged.length === 0 && <Text style={{ color: colors.mutedForeground }}>No flagged worklogs. 🎉</Text>}
            {flagged.map((f) => (
              <Pressable
                key={f.worklogId}
                onPress={() => router.push(`/job/${f.jobId}`)}
                style={[styles.card, { backgroundColor: colors.card, borderColor: "#f59e0b" }]}
              >
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <Feather name="alert-triangle" size={16} color="#f59e0b" />
                  <Text style={{ color: colors.foreground, fontWeight: "700", marginLeft: 8 }}>Job #{f.jobId} · Mechanic #{f.mechanicId}</Text>
                </View>
                <Text style={{ color: "#f59e0b", marginTop: 6, fontSize: 13 }}>{f.flagReason ?? "Flagged for review"}</Text>
                <Text style={{ color: colors.mutedForeground, marginTop: 4, fontSize: 12 }}>
                  Labor ${f.laborCost.toFixed(2)} · Parts ${f.partsCost.toFixed(2)} · {new Date(f.createdAt).toLocaleDateString()}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        )}
      </View>
    </>
  );
}

function Stat({ colors, label, value, accent, half }: { colors: ReturnType<typeof useColors>; label: string; value: string; accent?: boolean; half?: boolean }) {
  return (
    <View style={[
      styles.stat,
      { backgroundColor: colors.card, borderColor: accent ? colors.primary : colors.border },
      half && { width: "48%" },
    ]}>
      <Text style={{ color: colors.mutedForeground, fontSize: 11, fontWeight: "600", letterSpacing: 0.5 }}>{label.toUpperCase()}</Text>
      <Text style={{ color: accent ? colors.primary : colors.foreground, fontSize: 22, fontWeight: "800", marginTop: 4 }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  tabs: { flexDirection: "row", borderBottomWidth: 1 },
  tab: { flex: 1, paddingVertical: 12, alignItems: "center", borderBottomWidth: 2, borderBottomColor: "transparent" },
  muted: { fontSize: 11, fontWeight: "600", letterSpacing: 1, marginBottom: 8 },
  stat: { borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 10 },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" },
  card: { borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 10 },
});
