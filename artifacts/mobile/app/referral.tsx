import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator,
  Share, RefreshControl, Alert,
} from "react-native";
import { Stack } from "expo-router";
import { useState, useEffect, useCallback } from "react";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Clipboard from "expo-clipboard";

interface ReferralData {
  referralCode: string;
  totalReferrals: number;
  rewardedReferrals: number;
  loyaltyPoints: number;
  referredUsers: { id: number; name: string; createdAt: string }[];
}

const TIER_INFO = [
  { pts: 0, label: "Newcomer", color: "#94A3B8", icon: "user" },
  { pts: 200, label: "Regular", color: "#60A5FA", icon: "star" },
  { pts: 500, label: "Loyal", color: "#34D399", icon: "award" },
  { pts: 1000, label: "VIP", color: "#FBBF24", icon: "zap" },
  { pts: 2500, label: "Elite", color: "#F472B6", icon: "shield" },
];

function getCurrentTier(pts: number) {
  return [...TIER_INFO].reverse().find((t) => pts >= t.pts) ?? TIER_INFO[0];
}
function getNextTier(pts: number) {
  return TIER_INFO.find((t) => pts < t.pts) ?? null;
}

export default function ReferralScreen() {
  const colors = useColors();
  const { user } = useAuth();
  const [data, setData] = useState<ReferralData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [copied, setCopied] = useState(false);
  const domain = process.env.EXPO_PUBLIC_DOMAIN;

  const fetchData = useCallback(async () => {
    try {
      const token = await AsyncStorage.getItem("auth_token");
      const [refRes, loyaltyRes] = await Promise.all([
        fetch(`https://${domain}/api/referral`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`https://${domain}/api/loyalty`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      const refData = refRes.ok ? await refRes.json() : null;
      const loyaltyData = loyaltyRes.ok ? await loyaltyRes.json() : null;
      if (refData) setData({ ...refData, loyaltyPoints: loyaltyData?.balance ?? 0 });
    } catch { /* non-fatal */ }
    finally { setLoading(false); setRefreshing(false); }
  }, [domain]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleCopy = async () => {
    if (!data?.referralCode) return;
    await Clipboard.setStringAsync(data.referralCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShare = async () => {
    if (!data?.referralCode) return;
    await Share.share({
      message: `Join me on APS — Automotive Platform System! Use my referral code ${data.referralCode} when you sign up and get 200 bonus loyalty points. Download the app today.`,
      title: "Join APS with my referral code",
    });
  };

  const pts = data?.loyaltyPoints ?? 0;
  const tier = getCurrentTier(pts);
  const nextTier = getNextTier(pts);
  const progress = nextTier ? Math.min((pts - (getCurrentTier(pts - 1)?.pts ?? 0)) / (nextTier.pts - (TIER_INFO[TIER_INFO.indexOf(tier) - 1]?.pts ?? 0)), 1) : 1;

  return (
    <>
      <Stack.Screen options={{
        title: "Referrals & Rewards",
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.foreground,
        headerShown: true,
      }} />
      <ScrollView
        style={[styles.container, { backgroundColor: colors.background }]}
        contentContainerStyle={{ padding: 16, paddingBottom: 60, gap: 16 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchData(); }} tintColor={colors.primary} />}
      >
        {loading ? (
          <View style={styles.center}><ActivityIndicator color={colors.primary} size="large" /></View>
        ) : (
          <>
            {/* Loyalty Tier Card */}
            <View style={[styles.tierCard, { backgroundColor: tier.color + "18", borderColor: tier.color + "44" }]}>
              <View style={styles.tierHeader}>
                <View style={[styles.tierIcon, { backgroundColor: tier.color }]}>
                  <Feather name={tier.icon as any} size={22} color="white" />
                </View>
                <View>
                  <Text style={[styles.tierName, { color: tier.color }]}>{tier.label}</Text>
                  <Text style={[styles.tierSub, { color: colors.foreground }]}>{pts.toLocaleString()} points</Text>
                </View>
                {nextTier && (
                  <View style={styles.tierNext}>
                    <Text style={[styles.tierNextLabel, { color: colors.mutedForeground }]}>
                      {(nextTier.pts - pts).toLocaleString()} pts to {nextTier.label}
                    </Text>
                  </View>
                )}
              </View>
              <View style={[styles.progressBg, { backgroundColor: colors.secondary }]}>
                <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` as any, backgroundColor: tier.color }]} />
              </View>
            </View>

            {/* How you earn */}
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>How to earn points</Text>
              {[
                { icon: "check-circle", label: "Complete a service job", pts: "+100 pts", color: "#22C55E" },
                { icon: "user-plus", label: "Refer a new customer", pts: "+500 pts", color: "#6366F1" },
                { icon: "gift", label: "Join via referral link", pts: "+200 pts", color: "#F97316" },
              ].map((item) => (
                <View key={item.label} style={styles.earnRow}>
                  <View style={[styles.earnIcon, { backgroundColor: item.color + "18" }]}>
                    <Feather name={item.icon as any} size={16} color={item.color} />
                  </View>
                  <Text style={[styles.earnLabel, { color: colors.foreground }]}>{item.label}</Text>
                  <Text style={[styles.earnPts, { color: item.color }]}>{item.pts}</Text>
                </View>
              ))}
            </View>

            {/* Referral Code */}
            {data?.referralCode && (
              <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.cardTitle, { color: colors.foreground }]}>Your Referral Code</Text>
                <Text style={[styles.cardDesc, { color: colors.mutedForeground }]}>
                  Share this code with friends. You both get bonus points when they complete their first service.
                </Text>
                <View style={[styles.codeBox, { backgroundColor: colors.background, borderColor: colors.primary }]}>
                  <Text style={[styles.codeText, { color: colors.primary }]}>{data.referralCode}</Text>
                </View>
                <View style={styles.codeActions}>
                  <Pressable
                    style={[styles.codeBtn, { backgroundColor: copied ? "#22C55E18" : colors.secondary, borderColor: copied ? "#22C55E" : colors.border }]}
                    onPress={handleCopy}
                  >
                    <Feather name={copied ? "check" : "copy"} size={16} color={copied ? "#22C55E" : colors.foreground} />
                    <Text style={[styles.codeBtnText, { color: copied ? "#22C55E" : colors.foreground }]}>
                      {copied ? "Copied!" : "Copy"}
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[styles.codeBtn, { backgroundColor: colors.primary, flex: 1 }]}
                    onPress={handleShare}
                  >
                    <Feather name="share-2" size={16} color="white" />
                    <Text style={[styles.codeBtnText, { color: "white" }]}>Share</Text>
                  </Pressable>
                </View>
              </View>
            )}

            {/* Stats */}
            <View style={[styles.statsRow, { gap: 10 }]}>
              <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.statVal, { color: colors.primary }]}>{data?.totalReferrals ?? 0}</Text>
                <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Friends Referred</Text>
              </View>
              <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.statVal, { color: "#22C55E" }]}>{data?.rewardedReferrals ?? 0}</Text>
                <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Rewards Earned</Text>
              </View>
              <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.statVal, { color: "#F97316" }]}>{pts.toLocaleString()}</Text>
                <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Total Points</Text>
              </View>
            </View>

            {/* Referred friends list */}
            {(data?.referredUsers?.length ?? 0) > 0 && (
              <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.cardTitle, { color: colors.foreground }]}>Friends You've Referred</Text>
                {data!.referredUsers.map((u) => (
                  <View key={u.id} style={styles.friendRow}>
                    <View style={[styles.friendAvatar, { backgroundColor: colors.secondary }]}>
                      <Text style={[styles.friendAvatarText, { color: colors.secondaryForeground }]}>
                        {u.name.charAt(0).toUpperCase()}
                      </Text>
                    </View>
                    <View style={styles.friendInfo}>
                      <Text style={[styles.friendName, { color: colors.foreground }]}>{u.name}</Text>
                      <Text style={[styles.friendDate, { color: colors.mutedForeground }]}>
                        Joined {new Date(u.createdAt).toLocaleDateString()}
                      </Text>
                    </View>
                    <Feather name="check-circle" size={18} color="#22C55E" />
                  </View>
                ))}
              </View>
            )}

            {/* Tier roadmap */}
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>Loyalty Tiers</Text>
              {TIER_INFO.map((t, i) => {
                const isActive = getCurrentTier(pts) === t;
                return (
                  <View key={t.label} style={[styles.roadmapRow, isActive && { backgroundColor: t.color + "12", borderRadius: 10, padding: 8, margin: -4 }]}>
                    <View style={[styles.roadmapDot, { backgroundColor: pts >= t.pts ? t.color : colors.border }]} />
                    <View style={styles.roadmapInfo}>
                      <Text style={[styles.roadmapLabel, { color: pts >= t.pts ? colors.foreground : colors.mutedForeground, fontWeight: isActive ? "800" : "500" }]}>
                        {t.label} {isActive ? "← You are here" : ""}
                      </Text>
                      <Text style={[styles.roadmapPts, { color: t.color }]}>{t.pts.toLocaleString()} points</Text>
                    </View>
                    {pts >= t.pts && <Feather name="check-circle" size={18} color={t.color} />}
                  </View>
                );
              })}
            </View>
          </>
        )}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { paddingVertical: 60, alignItems: "center" },
  tierCard: { borderRadius: 18, borderWidth: 1, padding: 18, gap: 14 },
  tierHeader: { flexDirection: "row", alignItems: "center", gap: 14 },
  tierIcon: { width: 52, height: 52, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  tierName: { fontSize: 20, fontWeight: "800" },
  tierSub: { fontSize: 14, fontWeight: "600", marginTop: 2 },
  tierNext: { flex: 1, alignItems: "flex-end" },
  tierNextLabel: { fontSize: 12, textAlign: "right" },
  progressBg: { height: 8, borderRadius: 4, overflow: "hidden" },
  progressFill: { height: 8, borderRadius: 4 },
  card: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 12 },
  cardTitle: { fontSize: 16, fontWeight: "700" },
  cardDesc: { fontSize: 13, lineHeight: 20 },
  earnRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  earnIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  earnLabel: { flex: 1, fontSize: 14 },
  earnPts: { fontSize: 13, fontWeight: "700" },
  codeBox: { borderWidth: 2, borderRadius: 14, padding: 20, alignItems: "center", borderStyle: "dashed" },
  codeText: { fontSize: 28, fontWeight: "800", letterSpacing: 4, fontFamily: "monospace" },
  codeActions: { flexDirection: "row", gap: 10 },
  codeBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, height: 46, borderRadius: 12, paddingHorizontal: 20, borderWidth: 1,
  },
  codeBtnText: { fontSize: 14, fontWeight: "700" },
  statsRow: { flexDirection: "row" },
  statCard: { flex: 1, borderWidth: 1, borderRadius: 14, padding: 14, alignItems: "center", gap: 4 },
  statVal: { fontSize: 22, fontWeight: "800" },
  statLabel: { fontSize: 11, textAlign: "center" },
  friendRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  friendAvatar: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  friendAvatarText: { fontSize: 16, fontWeight: "700" },
  friendInfo: { flex: 1 },
  friendName: { fontSize: 15, fontWeight: "600" },
  friendDate: { fontSize: 12 },
  roadmapRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 8 },
  roadmapDot: { width: 12, height: 12, borderRadius: 6 },
  roadmapInfo: { flex: 1 },
  roadmapLabel: { fontSize: 14 },
  roadmapPts: { fontSize: 12, fontWeight: "600" },
});
