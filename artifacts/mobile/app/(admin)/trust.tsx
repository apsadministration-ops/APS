/**
 * Admin trust dashboard.
 *
 * Combines:
 *   - leaderboard: top + low trust-score mechanics
 *   - moderation queue: recent reviews with one-tap remove
 *
 * Uses /api/admin/trust/overview + /api/admin/reviews/recent. The remove
 * action calls /api/reviews/:id/moderate-remove which records the actor and
 * triggers reputation+badge recompute server-side.
 */

import { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable,
  RefreshControl, TextInput,
} from "react-native";
import { Stack, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useColors } from "@/hooks/useColors";
import { getApiUrl } from "@/lib/apiConfig";
import { confirm, alertMessage } from "@/utils/confirm";

interface OverviewMechanic {
  userId: number; name: string; mechanicTier: string | null;
  trustScore: number; overallAvg: number; reviewCount: number;
  cancellationRate: number; noShowRate: number;
}
interface OverviewDto {
  totals: { reviews: number; removed: number };
  topMechanics: OverviewMechanic[];
  lowMechanics: OverviewMechanic[];
}
interface ReviewRow {
  id: number; jobId: number; jobType: string | null;
  authorName: string; authorRole: string;
  subjectName: string; subjectRole: string;
  overallRating: number; text: string | null;
  visibility: string; submittedAt: string;
  removedAt: string | null; removedReason: string | null;
}

function trustColor(score: number): string {
  if (score >= 80) return "#10B981";
  if (score >= 65) return "#22C55E";
  if (score >= 50) return "#F59E0B";
  return "#EF4444";
}

export default function AdminTrustScreen() {
  const colors = useColors();
  const router = useRouter();

  const [overview, setOverview] = useState<OverviewDto | null>(null);
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [removingId, setRemovingId] = useState<number | null>(null);
  const [reasonDraft, setReasonDraft] = useState<Record<number, string>>({});

  const load = useCallback(async () => {
    const token = await AsyncStorage.getItem("auth_token");
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    const [oRes, rRes] = await Promise.all([
      fetch(getApiUrl("/admin/trust/overview"), { headers }),
      fetch(getApiUrl("/admin/reviews/recent?limit=50"), { headers }),
    ]);
    if (oRes.ok) setOverview(await oRes.json());
    if (rRes.ok) setReviews(await rRes.json());
  }, []);

  useEffect(() => { load().finally(() => setLoading(false)); }, [load]);
  const onRefresh = useCallback(async () => {
    setRefreshing(true); await load(); setRefreshing(false);
  }, [load]);

  const removeReview = async (r: ReviewRow) => {
    const reason = (reasonDraft[r.id] ?? "").trim();
    if (!reason) {
      await alertMessage("Reason required", "Tell the audit log why this review is being removed.");
      return;
    }
    const ok = await confirm({
      title: "Remove this review?",
      message: `This is logged. ${r.subjectName}'s reputation and badges will be recomputed.`,
      confirmText: "Remove",
      destructive: true,
    });
    if (!ok) return;
    setRemovingId(r.id);
    try {
      const token = await AsyncStorage.getItem("auth_token");
      const res = await fetch(getApiUrl(`/reviews/${r.id}/moderate-remove`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        await alertMessage("Couldn't remove", err.error ?? "Unknown error");
        return;
      }
      await load();
    } finally {
      setRemovingId(null);
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
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <Stack.Screen options={{ title: "Trust & Reviews" }} />

      <View style={styles.totalsRow}>
        <View style={[styles.totalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.totalNum, { color: colors.foreground }]}>{overview?.totals.reviews ?? 0}</Text>
          <Text style={[styles.totalLabel, { color: colors.mutedForeground }]}>Total reviews</Text>
        </View>
        <View style={[styles.totalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.totalNum, { color: "#EF4444" }]}>{overview?.totals.removed ?? 0}</Text>
          <Text style={[styles.totalLabel, { color: colors.mutedForeground }]}>Removed</Text>
        </View>
      </View>

      <Section title="Top mechanics" colors={colors}>
        {(overview?.topMechanics ?? []).length === 0 ? (
          <Text style={[styles.empty, { color: colors.mutedForeground }]}>No reputation data yet.</Text>
        ) : (
          (overview?.topMechanics ?? []).map((m) => (
            <Pressable key={m.userId} onPress={() => router.push(`/profile/${m.userId}` as never)}>
              <LeaderRow m={m} colors={colors} />
            </Pressable>
          ))
        )}
      </Section>

      <Section title="Needs attention" colors={colors}>
        {(overview?.lowMechanics ?? []).length === 0 ? (
          <Text style={[styles.empty, { color: colors.mutedForeground }]}>None.</Text>
        ) : (
          (overview?.lowMechanics ?? []).map((m) => (
            <Pressable key={m.userId} onPress={() => router.push(`/profile/${m.userId}` as never)}>
              <LeaderRow m={m} colors={colors} />
            </Pressable>
          ))
        )}
      </Section>

      <Section title={`Recent reviews (${reviews.length})`} colors={colors}>
        {reviews.length === 0 ? (
          <Text style={[styles.empty, { color: colors.mutedForeground }]}>No reviews yet.</Text>
        ) : (
          reviews.map((r) => (
            <View key={r.id} style={[styles.reviewCard, { borderTopColor: colors.border }]}>
              <View style={styles.reviewHead}>
                <View style={styles.starRow}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Feather key={n} name="star" size={12}
                      color={n <= r.overallRating ? "#F59E0B" : colors.border} />
                  ))}
                </View>
                <View style={[styles.visBadge, {
                  backgroundColor: r.visibility === "removed" ? "#EF444422"
                    : r.visibility === "visible" ? "#10B98122" : "#F59E0B22",
                  borderColor: r.visibility === "removed" ? "#EF4444"
                    : r.visibility === "visible" ? "#10B981" : "#F59E0B",
                }]}>
                  <Text style={[styles.visText, {
                    color: r.visibility === "removed" ? "#EF4444"
                      : r.visibility === "visible" ? "#10B981" : "#F59E0B",
                  }]}>{r.visibility.toUpperCase()}</Text>
                </View>
              </View>
              <Text style={[styles.reviewMeta, { color: colors.mutedForeground }]}>
                <Text style={{ fontWeight: "700", color: colors.foreground }}>{r.authorName}</Text>
                {" → "}
                <Text style={{ fontWeight: "700", color: colors.foreground }}>{r.subjectName}</Text>
                {r.jobType ? `  ·  ${r.jobType}` : ""}
                {`  ·  job #${r.jobId}`}
              </Text>
              {r.text ? (
                <Text style={[styles.reviewText, { color: colors.foreground }]}>"{r.text}"</Text>
              ) : (
                <Text style={[styles.reviewText, { color: colors.mutedForeground, fontStyle: "italic" }]}>No text</Text>
              )}
              {r.removedAt ? (
                <Text style={[styles.removedNote, { color: "#EF4444" }]}>
                  Removed: {r.removedReason ?? "no reason"}
                </Text>
              ) : (
                <View style={styles.removeBlock}>
                  <TextInput
                    placeholder="Reason for removal"
                    placeholderTextColor={colors.mutedForeground}
                    value={reasonDraft[r.id] ?? ""}
                    onChangeText={(t) => setReasonDraft((d) => ({ ...d, [r.id]: t }))}
                    style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
                  />
                  <Pressable
                    onPress={() => removeReview(r)}
                    disabled={removingId === r.id}
                    style={[styles.removeBtn, { backgroundColor: "#EF4444", opacity: removingId === r.id ? 0.5 : 1 }]}
                  >
                    <Text style={styles.removeBtnText}>
                      {removingId === r.id ? "…" : "Remove"}
                    </Text>
                  </Pressable>
                </View>
              )}
            </View>
          ))
        )}
      </Section>
    </ScrollView>
  );
}

function Section({ title, colors, children }: { title: string; colors: ReturnType<typeof useColors>; children: React.ReactNode }) {
  return (
    <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{title}</Text>
      {children}
    </View>
  );
}

function LeaderRow({ m, colors }: { m: OverviewMechanic; colors: ReturnType<typeof useColors> }) {
  const tColor = trustColor(m.trustScore);
  return (
    <View style={[styles.leaderRow, { borderTopColor: colors.border }]}>
      <View style={[styles.leaderScore, { backgroundColor: tColor + "22", borderColor: tColor }]}>
        <Text style={[styles.leaderScoreText, { color: tColor }]}>{m.trustScore}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.leaderName, { color: colors.foreground }]}>{m.name}</Text>
        <Text style={[styles.leaderMeta, { color: colors.mutedForeground }]}>
          {(m.mechanicTier ?? "mechanic")} · {m.overallAvg.toFixed(1)}★ · {m.reviewCount} reviews
        </Text>
      </View>
      <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  totalsRow: { flexDirection: "row", gap: 12, marginBottom: 12 },
  totalCard: { flex: 1, borderWidth: 1, borderRadius: 12, padding: 12, alignItems: "center" },
  totalNum: { fontSize: 22, fontWeight: "800" },
  totalLabel: { fontSize: 11, marginTop: 2 },
  section: { borderWidth: 1, borderRadius: 16, padding: 16, marginBottom: 12 },
  sectionTitle: { fontSize: 13, fontWeight: "700", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 },
  leaderRow: { flexDirection: "row", alignItems: "center", paddingVertical: 10, borderTopWidth: 1, gap: 12 },
  leaderScore: { width: 40, height: 40, borderRadius: 20, borderWidth: 1.5, justifyContent: "center", alignItems: "center" },
  leaderScoreText: { fontSize: 14, fontWeight: "800" },
  leaderName: { fontSize: 14, fontWeight: "600" },
  leaderMeta: { fontSize: 11, marginTop: 2 },
  reviewCard: { borderTopWidth: 1, paddingTop: 12, marginTop: 12 },
  reviewHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  starRow: { flexDirection: "row", gap: 2 },
  visBadge: { borderWidth: 1, borderRadius: 999, paddingVertical: 2, paddingHorizontal: 8 },
  visText: { fontSize: 9, fontWeight: "700", letterSpacing: 0.5 },
  reviewMeta: { fontSize: 11, marginVertical: 4 },
  reviewText: { fontSize: 13, marginTop: 4, lineHeight: 18 },
  removedNote: { fontSize: 12, marginTop: 6, fontWeight: "600" },
  removeBlock: { flexDirection: "row", marginTop: 8, gap: 6 },
  input: { flex: 1, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, fontSize: 12 },
  removeBtn: { paddingHorizontal: 14, justifyContent: "center", borderRadius: 8 },
  removeBtnText: { color: "#fff", fontWeight: "700", fontSize: 12 },
  empty: { fontSize: 13, textAlign: "center", paddingVertical: 12 },
});
