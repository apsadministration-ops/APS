/**
 * Public trust profile.
 *
 * Renders any user's reputation snapshot — trust score, category averages,
 * badges, behavioural metrics, and visible reviews. Works for both mechanics
 * (full public profile) and customers (mechanic-only view of trustworthiness
 * before accepting a job — though the route doesn't enforce that here; the
 * `/api/reputation/:id` endpoint is auth-gated and will 401 unauth requests).
 */

import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, RefreshControl } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useColors } from "@/hooks/useColors";

interface BadgeDto { key: string; label: string; description: string; awardedAt: string }
interface ReputationDto {
  userId: number;
  role: string;
  name: string;
  avatarUrl: string | null;
  mechanicTier: string | null;
  reviewCount: number;
  overallAvg: number;
  categoriesAvg: Record<string, number>;
  completionRate: number;
  cancellationRate: number;
  noShowRate: number;
  repeatCustomerRate: number;
  trustScore: number;
  badges: BadgeDto[];
}
interface ReviewDto {
  id: number; overallRating: number; text: string | null;
  authorRole: string; submittedAt: string; visibility: string;
  categories: Record<string, number> | null;
}

const CATEGORY_LABELS: Record<string, string> = {
  professionalism: "Professionalism", communication: "Communication",
  punctuality: "Punctuality", cleanliness: "Cleanliness",
  workmanship: "Workmanship", efficiency: "Efficiency",
  honesty: "Honesty", vehicleCare: "Vehicle Care",
  paymentReliability: "Payment Reliability", respectfulness: "Respectfulness",
  preparedness: "Preparedness", cooperation: "Cooperation",
  accuracyOfRequest: "Accuracy of Request", availability: "Availability",
  safety: "Safety", followThrough: "Follow-through",
};

function trustColor(score: number): string {
  if (score >= 80) return "#10B981";
  if (score >= 65) return "#22C55E";
  if (score >= 50) return "#F59E0B";
  return "#EF4444";
}

export default function ProfileScreen() {
  const colors = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const userId = parseInt(String(id), 10);
  const domain = process.env.EXPO_PUBLIC_DOMAIN;

  const [rep, setRep] = useState<ReputationDto | null>(null);
  const [reviews, setReviews] = useState<ReviewDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const token = await AsyncStorage.getItem("auth_token");
    const headers = { Authorization: `Bearer ${token}` };
    const [repRes, reviewsRes] = await Promise.all([
      fetch(`https://${domain}/api/reputation/${userId}`, { headers }),
      fetch(`https://${domain}/api/reviews/user/${userId}`, { headers }),
    ]);
    if (repRes.ok) setRep(await repRes.json());
    if (reviewsRes.ok) setReviews(await reviewsRes.json());
  }, [domain, userId]);

  useEffect(() => { load().finally(() => setLoading(false)); }, [load]);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (!rep) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.foreground }}>Profile unavailable.</Text>
      </View>
    );
  }

  const tColor = trustColor(rep.trustScore);
  const sortedCategories = Object.entries(rep.categoriesAvg).sort((a, b) => b[1] - a[1]);

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <Stack.Screen options={{ title: rep.name }} />

      {/* Trust score header */}
      <View style={[styles.heroCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.heroRow}>
          <View>
            <Text style={[styles.name, { color: colors.foreground }]}>{rep.name}</Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              {rep.role === "mechanic"
                ? `${rep.mechanicTier ?? "mechanic"} · ${rep.reviewCount} review${rep.reviewCount === 1 ? "" : "s"}`
                : `Customer · ${rep.reviewCount} review${rep.reviewCount === 1 ? "" : "s"}`}
            </Text>
          </View>
          <View style={[styles.trustBadge, { backgroundColor: tColor + "22", borderColor: tColor }]}>
            <Text style={[styles.trustNum, { color: tColor }]}>{rep.trustScore}</Text>
            <Text style={[styles.trustLabel, { color: tColor }]}>TRUST</Text>
          </View>
        </View>
        <View style={styles.statsRow}>
          <Stat label="Overall" value={rep.overallAvg.toFixed(1)} icon="star" colors={colors} />
          <Stat label="Completion" value={`${Math.round(rep.completionRate * 100)}%`} icon="check-circle" colors={colors} />
          {rep.role === "mechanic" ? (
            <Stat label="Repeat customers" value={`${Math.round(rep.repeatCustomerRate * 100)}%`} icon="users" colors={colors} />
          ) : (
            <Stat label="No-show rate" value={`${Math.round(rep.noShowRate * 100)}%`} icon="alert-circle" colors={colors} />
          )}
        </View>
      </View>

      {/* Badges */}
      {rep.badges.length > 0 && (
        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Badges</Text>
          <View style={styles.badgeWrap}>
            {rep.badges.map((b) => (
              <View key={b.key} style={[styles.badge, { backgroundColor: colors.primary + "18", borderColor: colors.primary }]}>
                <Feather name="award" size={12} color={colors.primary} />
                <Text style={[styles.badgeText, { color: colors.primary }]}>{b.label}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Categories */}
      {sortedCategories.length > 0 && (
        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>By category</Text>
          {sortedCategories.map(([key, avg]) => {
            const pct = (avg / 5) * 100;
            return (
              <View key={key} style={styles.catRow}>
                <Text style={[styles.catLabel, { color: colors.foreground }]}>
                  {CATEGORY_LABELS[key] ?? key}
                </Text>
                <View style={[styles.catBar, { backgroundColor: colors.border }]}>
                  <View style={[styles.catFill, { width: `${pct}%`, backgroundColor: trustColor(pct) }]} />
                </View>
                <Text style={[styles.catVal, { color: colors.mutedForeground }]}>{avg.toFixed(1)}</Text>
              </View>
            );
          })}
        </View>
      )}

      {/* Reviews */}
      <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
          Reviews ({reviews.filter((r) => r.visibility === "visible").length})
        </Text>
        {reviews.filter((r) => r.visibility === "visible").length === 0 ? (
          <Text style={[styles.empty, { color: colors.mutedForeground }]}>
            No public reviews yet.
          </Text>
        ) : (
          reviews
            .filter((r) => r.visibility === "visible")
            .map((r) => (
              <View key={r.id} style={[styles.reviewRow, { borderTopColor: colors.border }]}>
                <View style={styles.reviewHead}>
                  <View style={styles.starRow}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <Feather
                        key={n}
                        name="star"
                        size={14}
                        color={n <= r.overallRating ? "#F59E0B" : colors.border}
                      />
                    ))}
                  </View>
                  <Text style={[styles.reviewMeta, { color: colors.mutedForeground }]}>
                    {new Date(r.submittedAt).toLocaleDateString()} · {r.authorRole}
                  </Text>
                </View>
                {r.text ? (
                  <Text style={[styles.reviewText, { color: colors.foreground }]}>{r.text}</Text>
                ) : null}
              </View>
            ))
        )}
      </View>
    </ScrollView>
  );
}

function Stat({ label, value, icon, colors }: { label: string; value: string; icon: string; colors: ReturnType<typeof useColors> }) {
  return (
    <View style={styles.statBlock}>
      <Feather name={icon as keyof typeof Feather.glyphMap} size={14} color={colors.mutedForeground} />
      <Text style={[styles.statValue, { color: colors.foreground }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  heroCard: { borderWidth: 1, borderRadius: 16, padding: 16, marginBottom: 12 },
  heroRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  name: { fontSize: 20, fontWeight: "700" },
  subtitle: { fontSize: 13, marginTop: 2 },
  trustBadge: { borderWidth: 2, borderRadius: 12, paddingVertical: 6, paddingHorizontal: 12, alignItems: "center", minWidth: 70 },
  trustNum: { fontSize: 22, fontWeight: "800" },
  trustLabel: { fontSize: 9, fontWeight: "700", letterSpacing: 1 },
  statsRow: { flexDirection: "row", marginTop: 16, gap: 12 },
  statBlock: { flex: 1, alignItems: "flex-start", gap: 2 },
  statValue: { fontSize: 16, fontWeight: "700" },
  statLabel: { fontSize: 11 },
  section: { borderWidth: 1, borderRadius: 16, padding: 16, marginBottom: 12 },
  sectionTitle: { fontSize: 14, fontWeight: "700", marginBottom: 12, textTransform: "uppercase", letterSpacing: 0.5 },
  badgeWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  badge: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 },
  badgeText: { fontSize: 11, fontWeight: "700" },
  catRow: { flexDirection: "row", alignItems: "center", marginVertical: 4, gap: 8 },
  catLabel: { fontSize: 12, width: 110 },
  catBar: { flex: 1, height: 6, borderRadius: 3, overflow: "hidden" },
  catFill: { height: "100%", borderRadius: 3 },
  catVal: { fontSize: 12, width: 28, textAlign: "right" },
  reviewRow: { borderTopWidth: 1, paddingTop: 12, marginTop: 12 },
  reviewHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  starRow: { flexDirection: "row", gap: 2 },
  reviewMeta: { fontSize: 11 },
  reviewText: { fontSize: 13, marginTop: 6, lineHeight: 18 },
  empty: { fontSize: 13, textAlign: "center", paddingVertical: 12 },
});
