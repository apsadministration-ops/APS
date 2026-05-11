import { View, Text, StyleSheet, ScrollView, ActivityIndicator, RefreshControl } from "react-native";
import { useColors } from "@/hooks/useColors";
import { Feather } from "@expo/vector-icons";
import { useState, useEffect, useCallback } from "react";
import { growthGet } from "./_api";

interface Cpa {
  organicSignupsLast30: number; referralSignupsLast30: number; publishedPostsLast30: number;
  estimatedOrganicCpaUsd: number; estimatedReferralCpaPoints: number;
  customerLifetimeValueUsd: number | null; mechanicLifetimeValueUsd: number | null;
  signupToBookingPct: number | null; bookingToRepeatPct: number | null;
}
interface Engagement {
  totalPostsPublished: number;
  totalEngagement: { likes: number; shares: number; comments: number; saves: number; clicks: number };
  bestByPlatform: { platform: string; postId: number; topicTitle: string; engagementScore: number }[];
  bestHashtags: { hashtag: string; uses: number; avgEngagement: number }[];
  bestPostingHour: { platform: string; hour: number; avgEngagement: number }[];
}

function StatCard({ icon, label, value, color }: { icon: string; label: string; value: string; color: string }) {
  const colors = useColors();
  return (
    <View style={[s.statBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Feather name={icon as keyof typeof Feather.glyphMap} size={18} color={color} />
      <Text style={[s.statBigVal, { color: colors.foreground }]}>{value}</Text>
      <Text style={[s.statSmall, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  );
}

export default function CpaScreen() {
  const colors = useColors();
  const [cpa, setCpa] = useState<Cpa | null>(null);
  const [eng, setEng] = useState<Engagement | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [c, e] = await Promise.all([
        growthGet<Cpa>("/admin/growth/cpa"),
        growthGet<Engagement>("/admin/growth/engagement"),
      ]);
      setCpa(c); setEng(e);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally { setLoading(false); setRefreshing(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <ScrollView
      style={[s.container, { backgroundColor: colors.background }]}
      contentContainerStyle={{ padding: 16, paddingBottom: 140 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
    >
      {loading ? (
        <View style={s.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : error ? (
        <Text style={{ color: colors.destructive }}>{error}</Text>
      ) : cpa && eng ? (
        <>
          <Text style={[s.section, { color: colors.foreground }]}>Cost-per-acquisition (organic)</Text>
          <Text style={[s.note, { color: colors.mutedForeground }]}>
            Estimated using {cpa.publishedPostsLast30} published posts in the last 30 days at ~12 minutes/post @ $75/hr editorial labor.
          </Text>
          <View style={s.row}>
            <StatCard icon="dollar-sign" label="Organic CPA" value={`$${cpa.estimatedOrganicCpaUsd.toFixed(2)}`} color="#22C55E" />
            <StatCard icon="gift" label="Referral CPA (pts)" value={cpa.estimatedReferralCpaPoints.toLocaleString()} color="#EC4899" />
          </View>

          <Text style={[s.section, { color: colors.foreground }]}>Customer & mechanic LTV</Text>
          <View style={s.row}>
            <StatCard icon="user" label="Customer LTV"
              value={cpa.customerLifetimeValueUsd == null ? "—" : `$${cpa.customerLifetimeValueUsd.toFixed(0)}`} color="#0EA5E9" />
            <StatCard icon="tool" label="Mechanic LTV (net)"
              value={cpa.mechanicLifetimeValueUsd == null ? "—" : `$${cpa.mechanicLifetimeValueUsd.toFixed(0)}`} color="#F97316" />
          </View>

          <Text style={[s.section, { color: colors.foreground }]}>Funnel conversion</Text>
          <View style={s.row}>
            <StatCard icon="user-plus" label="Signup → booking"
              value={cpa.signupToBookingPct == null ? "—" : `${cpa.signupToBookingPct.toFixed(1)}%`} color="#6366F1" />
            <StatCard icon="repeat" label="Booking → repeat"
              value={cpa.bookingToRepeatPct == null ? "—" : `${cpa.bookingToRepeatPct.toFixed(1)}%`} color="#8B5CF6" />
          </View>

          <Text style={[s.section, { color: colors.foreground }]}>Content engagement totals</Text>
          <View style={[s.engCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={s.engRow}><Feather name="heart" size={14} color="#EF4444" /><Text style={[s.engLabel, { color: colors.mutedForeground }]}>Likes</Text><Text style={[s.engVal, { color: colors.foreground }]}>{eng.totalEngagement.likes.toLocaleString()}</Text></View>
            <View style={s.engRow}><Feather name="share-2" size={14} color="#22C55E" /><Text style={[s.engLabel, { color: colors.mutedForeground }]}>Shares</Text><Text style={[s.engVal, { color: colors.foreground }]}>{eng.totalEngagement.shares.toLocaleString()}</Text></View>
            <View style={s.engRow}><Feather name="message-circle" size={14} color="#0EA5E9" /><Text style={[s.engLabel, { color: colors.mutedForeground }]}>Comments</Text><Text style={[s.engVal, { color: colors.foreground }]}>{eng.totalEngagement.comments.toLocaleString()}</Text></View>
            <View style={s.engRow}><Feather name="bookmark" size={14} color="#F59E0B" /><Text style={[s.engLabel, { color: colors.mutedForeground }]}>Saves</Text><Text style={[s.engVal, { color: colors.foreground }]}>{eng.totalEngagement.saves.toLocaleString()}</Text></View>
            <View style={s.engRow}><Feather name="mouse-pointer" size={14} color="#8B5CF6" /><Text style={[s.engLabel, { color: colors.mutedForeground }]}>Clicks</Text><Text style={[s.engVal, { color: colors.foreground }]}>{eng.totalEngagement.clicks.toLocaleString()}</Text></View>
            <Text style={[s.engFoot, { color: colors.mutedForeground }]}>Across {eng.totalPostsPublished} published posts.</Text>
          </View>

          <Text style={[s.section, { color: colors.foreground }]}>Best performing per platform</Text>
          <View style={[s.engCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {eng.bestByPlatform.length === 0 ? (
              <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>Not enough data yet.</Text>
            ) : eng.bestByPlatform.map((b) => (
              <View key={b.platform} style={[s.bestRow, { borderBottomColor: colors.border }]}>
                <Text style={{ color: colors.foreground, fontWeight: "700", flex: 1, textTransform: "capitalize" }}>{b.platform}</Text>
                <Text style={{ color: colors.foreground, flex: 2, fontSize: 12 }} numberOfLines={1}>{b.topicTitle}</Text>
                <Text style={{ color: colors.primary, fontWeight: "700" }}>{Math.round(b.engagementScore)}</Text>
              </View>
            ))}
          </View>

          <Text style={[s.section, { color: colors.foreground }]}>Top hashtags</Text>
          <View style={[s.engCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {eng.bestHashtags.length === 0 ? (
                <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>None yet.</Text>
              ) : eng.bestHashtags.map((h) => (
                <View key={h.hashtag} style={[s.hashtagPill, { backgroundColor: colors.primary + "18" }]}>
                  <Text style={{ color: colors.primary, fontSize: 11, fontWeight: "700" }}>{h.hashtag}</Text>
                  <Text style={{ color: colors.mutedForeground, fontSize: 10 }}> · {h.uses} uses</Text>
                </View>
              ))}
            </View>
          </View>

          <Text style={[s.section, { color: colors.foreground }]}>Best posting hours (UTC)</Text>
          <View style={[s.engCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {eng.bestPostingHour.length === 0 ? (
              <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>Not enough data yet.</Text>
            ) : eng.bestPostingHour.map((h, i) => (
              <View key={i} style={[s.bestRow, { borderBottomColor: colors.border }]}>
                <Text style={{ color: colors.foreground, flex: 1, textTransform: "capitalize", fontWeight: "600" }}>{h.platform}</Text>
                <Text style={{ color: colors.foreground }}>{h.hour}:00</Text>
                <Text style={{ color: colors.primary, fontWeight: "700" }}>{Math.round(h.avgEngagement)}</Text>
              </View>
            ))}
          </View>
        </>
      ) : null}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  center: { paddingVertical: 60, alignItems: "center" },
  section: { fontSize: 14, fontWeight: "700", marginBottom: 10, marginTop: 8 },
  note: { fontSize: 11, marginBottom: 10 },
  row: { flexDirection: "row", gap: 10, marginBottom: 16 },
  statBox: { flex: 1, padding: 14, borderRadius: 14, borderWidth: 1, gap: 4 },
  statBigVal: { fontSize: 22, fontWeight: "800" },
  statSmall: { fontSize: 11 },
  engCard: { padding: 14, borderRadius: 14, borderWidth: 1, marginBottom: 16 },
  engRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 },
  engLabel: { flex: 1, fontSize: 13 },
  engVal: { fontWeight: "700", fontSize: 14 },
  engFoot: { fontSize: 11, marginTop: 8 },
  bestRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  hashtagPill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, flexDirection: "row", alignItems: "center" },
});
