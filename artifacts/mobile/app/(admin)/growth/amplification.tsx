import { View, Text, StyleSheet, ScrollView, ActivityIndicator, RefreshControl } from "react-native";
import { useColors } from "@/hooks/useColors";
import { Feather } from "@expo/vector-icons";
import { useState, useEffect, useCallback } from "react";
import { growthGet } from "@/lib/growthApi";

interface Row {
  mechanicId: number; name: string; region: string | null; tier: string;
  paidJobsLast30: number; utilizationScore: number;
  referralsCreated: number; referralsConverted: number; amplificationScore: number;
}

const TIER_COLORS: Record<string, string> = {
  detailer: "#94A3B8", technician: "#0EA5E9", senior: "#8B5CF6",
  advanced: "#F59E0B", master: "#F97316",
};

export default function AmplificationScreen() {
  const colors = useColors();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setRows(await growthGet<Row[]>("/admin/growth/amplification"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally { setLoading(false); setRefreshing(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const maxScore = rows && rows.length ? Math.max(1, ...rows.map((r) => r.amplificationScore)) : 1;

  return (
    <ScrollView
      style={[s.container, { backgroundColor: colors.background }]}
      contentContainerStyle={{ padding: 16, paddingBottom: 140 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
    >
      <Text style={[s.intro, { color: colors.mutedForeground }]}>
        Top mechanics by amplification score: paid jobs (last 30d) + converted referrals + raw referral count. Use to plan spotlights and recruitment-focused content.
      </Text>
      {loading ? (
        <View style={s.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : error ? (
        <Text style={{ color: colors.destructive }}>{error}</Text>
      ) : rows && rows.length === 0 ? (
        <View style={[s.empty, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={{ color: colors.mutedForeground }}>No active mechanics yet.</Text>
        </View>
      ) : rows?.map((r, i) => {
        const pct = (r.amplificationScore / maxScore) * 100;
        return (
          <View key={r.mechanicId} style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={s.head}>
              <Text style={[s.rank, { color: colors.primary }]}>#{i + 1}</Text>
              <View style={{ flex: 1 }}>
                <Text style={[s.name, { color: colors.foreground }]}>{r.name}</Text>
                <Text style={[s.sub, { color: colors.mutedForeground }]}>{r.region ?? "—"}</Text>
              </View>
              <View style={[s.tierPill, { backgroundColor: (TIER_COLORS[r.tier] ?? "#94A3B8") + "22" }]}>
                <Text style={{ color: TIER_COLORS[r.tier] ?? "#94A3B8", fontSize: 10, fontWeight: "700", textTransform: "capitalize" }}>{r.tier}</Text>
              </View>
            </View>
            <View style={[s.bar, { backgroundColor: colors.border + "55" }]}>
              <View style={[s.barFill, { backgroundColor: colors.primary, width: `${Math.max(2, pct)}%` }]} />
            </View>
            <View style={s.metricsRow}>
              <View style={s.metricCell}>
                <Text style={[s.metricVal, { color: colors.foreground }]}>{r.paidJobsLast30}</Text>
                <Text style={[s.metricLabel, { color: colors.mutedForeground }]}>Paid jobs / 30d</Text>
              </View>
              <View style={s.metricCell}>
                <Text style={[s.metricVal, { color: colors.foreground }]}>{r.referralsCreated}</Text>
                <Text style={[s.metricLabel, { color: colors.mutedForeground }]}>Referrals</Text>
              </View>
              <View style={s.metricCell}>
                <Text style={[s.metricVal, { color: "#22C55E" }]}>{r.referralsConverted}</Text>
                <Text style={[s.metricLabel, { color: colors.mutedForeground }]}>Converted</Text>
              </View>
              <View style={s.metricCell}>
                <Text style={[s.metricVal, { color: colors.primary }]}>{r.amplificationScore}</Text>
                <Text style={[s.metricLabel, { color: colors.mutedForeground }]}>Amp score</Text>
              </View>
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  intro: { fontSize: 12, marginBottom: 12, lineHeight: 17 },
  center: { paddingVertical: 60, alignItems: "center" },
  empty: { padding: 16, borderRadius: 14, borderWidth: 1 },
  card: { padding: 14, borderRadius: 14, borderWidth: 1, marginBottom: 10, gap: 10 },
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  rank: { fontWeight: "800", fontSize: 14 },
  name: { fontWeight: "700", fontSize: 14 },
  sub: { fontSize: 11, marginTop: 2 },
  tierPill: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  bar: { height: 6, borderRadius: 3, overflow: "hidden" },
  barFill: { height: 6, borderRadius: 3 },
  metricsRow: { flexDirection: "row" },
  metricCell: { flex: 1, alignItems: "center" },
  metricVal: { fontSize: 16, fontWeight: "800" },
  metricLabel: { fontSize: 10, marginTop: 2 },
});
