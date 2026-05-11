import { View, Text, StyleSheet, ScrollView, ActivityIndicator, RefreshControl } from "react-native";
import { useColors } from "@/hooks/useColors";
import { Feather } from "@expo/vector-icons";
import { useState, useEffect, useCallback } from "react";
import { growthGet } from "@/lib/growthApi";

interface Leader {
  userId: number; name: string; email: string; role: string;
  region: string | null; city: string | null; referralCode: string | null;
  totalReferred: number; converted: number; pointsAwarded: number; conversionPct: number;
}
interface Data {
  totalReferrals: number; convertedReferrals: number; conversionPct: number | null;
  byRole: { customers: number; mechanics: number };
  byRegion: { region: string; count: number; converted: number }[];
  topMechanicReferrers: Leader[]; topCustomerReferrers: Leader[];
  totalPointsAwarded: number;
}

function LeaderTable({ rows, accent }: { rows: Leader[]; accent: string }) {
  const colors = useColors();
  if (rows.length === 0) {
    return <Text style={{ color: colors.mutedForeground, fontSize: 13, paddingVertical: 6 }}>No data yet.</Text>;
  }
  return (
    <View>
      {rows.map((r, i) => (
        <View key={r.userId} style={[styles.leaderRow, { borderBottomColor: colors.border }]}>
          <Text style={[styles.leaderRank, { color: accent }]}>{i + 1}</Text>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.foreground, fontWeight: "700", fontSize: 13 }} numberOfLines={1}>{r.name}</Text>
            <Text style={{ color: colors.mutedForeground, fontSize: 11 }} numberOfLines={1}>
              {r.referralCode ?? "no code"} · {r.city ?? r.region ?? "—"}
            </Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={{ color: colors.foreground, fontWeight: "700" }}>{r.totalReferred}</Text>
            <Text style={{ color: accent, fontSize: 11, fontWeight: "600" }}>{r.converted} converted</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

export default function ReferralIntelligence() {
  const colors = useColors();
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setData(await growthGet<Data>("/admin/growth/referrals"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally { setLoading(false); setRefreshing(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

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
      ) : data ? (
        <>
          <View style={styles.statsRow}>
            <View style={[styles.statBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Feather name="share-2" size={18} color="#EC4899" />
              <Text style={[styles.statBigVal, { color: colors.foreground }]}>{data.totalReferrals}</Text>
              <Text style={[styles.statSmall, { color: colors.mutedForeground }]}>Total referrals</Text>
            </View>
            <View style={[styles.statBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Feather name="check-circle" size={18} color="#22C55E" />
              <Text style={[styles.statBigVal, { color: colors.foreground }]}>{data.convertedReferrals}</Text>
              <Text style={[styles.statSmall, { color: colors.mutedForeground }]}>Converted</Text>
            </View>
            <View style={[styles.statBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Feather name="percent" size={18} color="#6366F1" />
              <Text style={[styles.statBigVal, { color: colors.foreground }]}>
                {data.conversionPct == null ? "—" : `${data.conversionPct.toFixed(1)}%`}
              </Text>
              <Text style={[styles.statSmall, { color: colors.mutedForeground }]}>Conversion</Text>
            </View>
            <View style={[styles.statBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Feather name="gift" size={18} color="#F59E0B" />
              <Text style={[styles.statBigVal, { color: colors.foreground }]}>{data.totalPointsAwarded.toLocaleString()}</Text>
              <Text style={[styles.statSmall, { color: colors.mutedForeground }]}>Points awarded</Text>
            </View>
          </View>

          <Text style={[styles.section, { color: colors.foreground }]}>By role</Text>
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, flexDirection: "row" }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.statBigVal, { color: "#0EA5E9" }]}>{data.byRole.customers}</Text>
              <Text style={[styles.statSmall, { color: colors.mutedForeground }]}>Customers referring</Text>
            </View>
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.statBigVal, { color: "#F97316" }]}>{data.byRole.mechanics}</Text>
              <Text style={[styles.statSmall, { color: colors.mutedForeground }]}>Mechanics referring</Text>
            </View>
          </View>

          <Text style={[styles.section, { color: colors.foreground }]}>Top mechanic referrers</Text>
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <LeaderTable rows={data.topMechanicReferrers} accent="#F97316" />
          </View>

          <Text style={[styles.section, { color: colors.foreground }]}>Top customer referrers</Text>
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <LeaderTable rows={data.topCustomerReferrers} accent="#0EA5E9" />
          </View>

          <Text style={[styles.section, { color: colors.foreground }]}>By region</Text>
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {data.byRegion.length === 0 ? (
              <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>No regional data.</Text>
            ) : data.byRegion.map((r) => (
              <View key={r.region} style={[styles.regionRow, { borderBottomColor: colors.border }]}>
                <Text style={{ color: colors.foreground, flex: 1, fontWeight: "600" }}>{r.region}</Text>
                <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{r.count} signups · {r.converted} converted</Text>
              </View>
            ))}
          </View>
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { paddingVertical: 60, alignItems: "center" },
  statsRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 18 },
  statBox: { flex: 1, minWidth: "47%", padding: 14, borderRadius: 14, borderWidth: 1, gap: 4 },
  statBigVal: { fontSize: 24, fontWeight: "800" },
  statSmall: { fontSize: 11 },
  section: { fontSize: 14, fontWeight: "700", marginBottom: 10, marginTop: 6 },
  card: { padding: 14, borderRadius: 14, borderWidth: 1, marginBottom: 16 },
  divider: { width: StyleSheet.hairlineWidth, marginHorizontal: 12 },
  leaderRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  leaderRank: { fontWeight: "800", fontSize: 14, width: 22 },
  regionRow: { flexDirection: "row", paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
});
