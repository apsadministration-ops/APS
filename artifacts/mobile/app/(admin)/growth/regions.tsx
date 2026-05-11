import { View, Text, StyleSheet, ScrollView, ActivityIndicator, RefreshControl } from "react-native";
import { useColors } from "@/hooks/useColors";
import { Feather } from "@expo/vector-icons";
import { useState, useEffect, useCallback } from "react";
import { growthGet } from "@/lib/growthApi";

interface Region {
  region: string; customerCount: number; mechanicCount: number;
  jobsLast30: number; completedLast30: number;
  completionPct: number | null; averageWaitMinutes: number | null;
  demandScore: number; supplyScore: number; ratio: number | null;
}
interface Balance {
  recommendations: {
    region: string;
    balance: "mechanic_shortage" | "customer_shortage" | "balanced";
    contentFocus: string; topicKinds: string[]; rationale: string;
  }[];
  summary: { mechanicShortageRegions: string[]; customerShortageRegions: string[]; balancedRegions: string[] };
}

const BALANCE_META: Record<Balance["recommendations"][number]["balance"], { color: string; icon: string; label: string }> = {
  mechanic_shortage: { color: "#F97316", icon: "tool", label: "Recruit mechanics" },
  customer_shortage: { color: "#0EA5E9", icon: "user-plus", label: "Acquire customers" },
  balanced: { color: "#22C55E", icon: "check", label: "Balanced — engage both" },
};

export default function RegionsScreen() {
  const colors = useColors();
  const [regions, setRegions] = useState<Region[] | null>(null);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [r, b] = await Promise.all([
        growthGet<Region[]>("/admin/growth/regions"),
        growthGet<Balance>("/admin/growth/balance"),
      ]);
      setRegions(r); setBalance(b);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally { setLoading(false); setRefreshing(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const intensity = (score: number, max: number): string => {
    const pct = max === 0 ? 0 : Math.min(1, score / max);
    const alpha = Math.max(0.06, pct).toFixed(2);
    return `rgba(34, 197, 94, ${alpha})`;
  };

  const maxDemand = regions ? Math.max(1, ...regions.map((r) => r.demandScore)) : 1;
  const maxSupply = regions ? Math.max(1, ...regions.map((r) => r.supplyScore)) : 1;

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={{ padding: 16, paddingBottom: 140 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
    >
      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : error ? (
        <Text style={{ color: colors.destructive }}>{error}</Text>
      ) : (
        <>
          <Text style={[styles.section, { color: colors.foreground }]}>Marketplace balance recommendations</Text>
          {balance?.recommendations.length === 0 ? (
            <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={{ color: colors.mutedForeground }}>No regional activity yet.</Text>
            </View>
          ) : balance?.recommendations.map((r) => {
            const meta = BALANCE_META[r.balance];
            return (
              <View key={r.region} style={[styles.balanceCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.balanceHead}>
                  <View style={[styles.balanceIcon, { backgroundColor: meta.color + "18" }]}>
                    <Feather name={meta.icon as keyof typeof Feather.glyphMap} size={18} color={meta.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.balanceRegion, { color: colors.foreground }]}>{r.region}</Text>
                    <Text style={[styles.balanceLabel, { color: meta.color }]}>{meta.label}</Text>
                  </View>
                </View>
                <Text style={{ color: colors.foreground, fontSize: 12, lineHeight: 17, marginTop: 6 }}>{r.rationale}</Text>
                <View style={styles.kindsRow}>
                  {r.topicKinds.map((k) => (
                    <View key={k} style={[styles.kindPill, { backgroundColor: colors.border + "55" }]}>
                      <Text style={{ fontSize: 10, color: colors.foreground, fontWeight: "600" }}>{k.replace(/_/g, " ")}</Text>
                    </View>
                  ))}
                </View>
              </View>
            );
          })}

          <Text style={[styles.section, { color: colors.foreground }]}>Regional density</Text>
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.headerRow, { borderBottomColor: colors.border }]}>
              <Text style={[styles.colName, { color: colors.mutedForeground }]}>Region</Text>
              <Text style={[styles.colNum, { color: colors.mutedForeground }]}>Cust</Text>
              <Text style={[styles.colNum, { color: colors.mutedForeground }]}>Mech</Text>
              <Text style={[styles.colNum, { color: colors.mutedForeground }]}>Jobs/30</Text>
              <Text style={[styles.colNum, { color: colors.mutedForeground }]}>Wait</Text>
            </View>
            {regions?.map((r) => (
              <View key={r.region} style={[styles.dataRow, { borderBottomColor: colors.border, backgroundColor: intensity(r.demandScore, maxDemand) }]}>
                <Text style={[styles.colName, { color: colors.foreground }]} numberOfLines={1}>{r.region}</Text>
                <Text style={[styles.colNum, { color: colors.foreground }]}>{r.customerCount}</Text>
                <Text style={[styles.colNum, { color: colors.foreground }]}>{r.mechanicCount}</Text>
                <Text style={[styles.colNum, { color: colors.foreground }]}>{r.jobsLast30}</Text>
                <Text style={[styles.colNum, { color: colors.foreground }]}>
                  {r.averageWaitMinutes == null ? "—" : `${Math.round(r.averageWaitMinutes)}m`}
                </Text>
              </View>
            ))}
            <Text style={[styles.legend, { color: colors.mutedForeground }]}>
              Cell intensity = relative demand score (max {maxDemand.toFixed(0)}, supply max {maxSupply.toFixed(0)}).
            </Text>
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { paddingVertical: 60, alignItems: "center" },
  section: { fontSize: 14, fontWeight: "700", marginBottom: 10, marginTop: 6 },
  emptyCard: { padding: 16, borderRadius: 14, borderWidth: 1, marginBottom: 16 },
  balanceCard: { padding: 14, borderRadius: 14, borderWidth: 1, marginBottom: 10 },
  balanceHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  balanceIcon: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  balanceRegion: { fontWeight: "700", fontSize: 14 },
  balanceLabel: { fontSize: 11, fontWeight: "700", marginTop: 2 },
  kindsRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 },
  kindPill: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  card: { padding: 6, borderRadius: 14, borderWidth: 1, marginBottom: 16 },
  headerRow: { flexDirection: "row", paddingVertical: 8, paddingHorizontal: 8, borderBottomWidth: 1 },
  dataRow: { flexDirection: "row", paddingVertical: 9, paddingHorizontal: 8, borderBottomWidth: StyleSheet.hairlineWidth, alignItems: "center" },
  colName: { flex: 2, fontSize: 12, fontWeight: "600" },
  colNum: { flex: 1, fontSize: 12, textAlign: "right", fontWeight: "600" },
  legend: { fontSize: 10, padding: 10 },
});
