import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator,
  RefreshControl, Alert, Platform,
} from "react-native";
import { Stack, useRouter } from "expo-router";
import { useState, useEffect, useCallback, useMemo } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";

interface LedgerEntry {
  id: number;
  points: number;
  sourceType: string;
  reason: string;
  jobId: number | null;
  createdAt: string;
}
interface Reward {
  key: string;
  label: string;
  description: string;
  pointsCost: number;
  category: "discount" | "priority" | "swag" | "bonus" | "tools";
}
interface Redemption {
  id: number;
  rewardKey: string;
  rewardLabel: string;
  pointsUsed: number;
  status: "requested" | "fulfilled" | "cancelled";
  createdAt: string;
}

const SOURCE_LABEL: Record<string, { label: string; icon: keyof typeof Feather.glyphMap; color: string }> = {
  service:  { label: "Service spending",     icon: "credit-card",  color: "#3B82F6" },
  referral: { label: "Referral",             icon: "users",        color: "#10B981" },
  review:   { label: "Verified review",      icon: "edit-3",       color: "#F59E0B" },
  survey:   { label: "Post-service survey",  icon: "clipboard",    color: "#8B5CF6" },
  welcome:  { label: "Welcome bonus",        icon: "gift",         color: "#EC4899" },
  reversal: { label: "Adjustment",           icon: "refresh-cw",   color: "#6B7280" },
  job:      { label: "Job completed",        icon: "check-circle", color: "#3B82F6" },
  rating:   { label: "Customer rating",      icon: "star",         color: "#F59E0B" },
  tenure:   { label: "Tenure bonus",         icon: "award",        color: "#8B5CF6" },
  upsell:   { label: "Upsell",               icon: "trending-up",  color: "#10B981" },
};

const CATEGORY_TITLES: Record<Reward["category"], string> = {
  discount: "Service discounts",
  priority: "Priority booking",
  swag:     "APS merchandise",
  bonus:    "Cash bonuses",
  tools:    "Tools & equipment",
};

export default function LoyaltyScreen() {
  const colors = useColors();
  const router = useRouter();
  const { user, refreshUser } = useAuth() as any;
  const role: "customer" | "mechanic" = user?.role === "mechanic" ? "mechanic" : "customer";
  const isMechanic = role === "mechanic";
  const domain = process.env.EXPO_PUBLIC_DOMAIN;

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [redeeming, setRedeeming] = useState<string | null>(null);
  const [tab, setTab] = useState<"earn" | "rewards" | "history" | "redemptions">("earn");
  const [balance, setBalance] = useState(0);
  const [history, setHistory] = useState<LedgerEntry[]>([]);
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [redemptions, setRedemptions] = useState<Redemption[]>([]);

  const baseUrl = `https://${domain}/api/loyalty/${isMechanic ? "mechanic" : "customer"}`;
  const rewardsUrl = `https://${domain}/api/loyalty/rewards/${isMechanic ? "mechanic" : "customer"}`;
  const redemptionsUrl = `${baseUrl}/redemptions`;
  const redeemUrl = `${baseUrl}/redeem`;

  const fetchAll = useCallback(async () => {
    try {
      const token = await AsyncStorage.getItem("auth_token");
      const headers = { Authorization: `Bearer ${token}` };
      const [bRes, rRes, dRes] = await Promise.all([
        fetch(baseUrl, { headers }),
        fetch(rewardsUrl, { headers }),
        fetch(redemptionsUrl, { headers }),
      ]);
      if (bRes.ok) {
        const data = await bRes.json();
        setBalance(data.balance ?? 0);
        setHistory(data.history ?? []);
      }
      if (rRes.ok) setRewards(await rRes.json());
      if (dRes.ok) setRedemptions(await dRes.json());
    } catch { /* non-fatal */ }
    finally { setLoading(false); setRefreshing(false); }
  }, [baseUrl, rewardsUrl, redemptionsUrl]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const groupedRewards = useMemo(() => {
    const out: Record<string, Reward[]> = {};
    for (const r of rewards) (out[r.category] ||= []).push(r);
    return out;
  }, [rewards]);

  const onRedeem = async (reward: Reward) => {
    if (balance < reward.pointsCost) {
      const msg = `You need ${reward.pointsCost.toLocaleString()} points but only have ${balance.toLocaleString()}.`;
      if (Platform.OS === "web") window.alert(msg); else Alert.alert("Not enough points", msg);
      return;
    }
    const confirmMsg = `Redeem ${reward.pointsCost.toLocaleString()} points for "${reward.label}"?`;
    const ok = Platform.OS === "web"
      ? window.confirm(confirmMsg)
      : await new Promise<boolean>((resolve) => {
          Alert.alert("Confirm redemption", confirmMsg, [
            { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
            { text: "Redeem", onPress: () => resolve(true) },
          ]);
        });
    if (!ok) return;
    setRedeeming(reward.key);
    try {
      const token = await AsyncStorage.getItem("auth_token");
      const res = await fetch(redeemUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ rewardKey: reward.key }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Redemption failed");
      const successMsg = `${reward.label} requested. New balance: ${data.balance.toLocaleString()} pts.`;
      if (Platform.OS === "web") window.alert(successMsg); else Alert.alert("Redeemed", successMsg);
      await fetchAll();
      refreshUser?.();
    } catch (e) {
      const msg = (e as Error).message;
      if (Platform.OS === "web") window.alert(msg); else Alert.alert("Error", msg);
    } finally {
      setRedeeming(null);
    }
  };

  const headerTitle = isMechanic ? "Performance Rewards" : "APS Rewards";
  const heroIcon = isMechanic ? "tool" : "gift";
  const heroSubtitle = isMechanic
    ? "Earn points for great work, ratings, and approved upsells"
    : "Earn points on every service, review, and referral";

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
        title: headerTitle,
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.foreground,
        headerShown: true,
      }} />
      <ScrollView
        style={[styles.container, { backgroundColor: colors.background }]}
        contentContainerStyle={[styles.content, Platform.OS === "web" && { paddingBottom: 100 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchAll(); }} tintColor={colors.primary} />}
      >
        {/* Hero balance card */}
        <View style={[styles.hero, { backgroundColor: colors.primary }]}>
          <View style={styles.heroRow}>
            <Feather name={heroIcon as any} size={28} color={colors.primaryForeground} />
            <Text style={[styles.heroLabel, { color: colors.primaryForeground }]}>{isMechanic ? "Mechanic points" : "Loyalty points"}</Text>
          </View>
          <Text style={[styles.heroBalance, { color: colors.primaryForeground }]}>{balance.toLocaleString()}</Text>
          <Text style={[styles.heroSub, { color: colors.primaryForeground, opacity: 0.85 }]}>{heroSubtitle}</Text>
        </View>

        {/* Tab switcher */}
        <View style={[styles.tabs, { backgroundColor: colors.muted }]}>
          {(["earn", "rewards", "history", "redemptions"] as const).map((t) => (
            <Pressable
              key={t}
              onPress={() => setTab(t)}
              style={[styles.tab, tab === t && { backgroundColor: colors.card, ...Platform.select({ web: { boxShadow: "0 1px 2px rgba(0,0,0,0.08)" }, default: { shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 1 } }) }]}
            >
              <Text style={[styles.tabText, { color: tab === t ? colors.foreground : colors.mutedForeground }]}>
                {t === "earn" ? "Earn" : t === "rewards" ? "Rewards" : t === "history" ? "History" : "Mine"}
              </Text>
            </Pressable>
          ))}
        </View>

        {tab === "earn" && (
          <View style={styles.section}>
            <Text style={[styles.h2, { color: colors.foreground }]}>How to earn</Text>
            {(isMechanic ? MECHANIC_EARN : CUSTOMER_EARN).map((rule, i) => (
              <View key={i} style={[styles.earnRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={[styles.earnIcon, { backgroundColor: rule.color + "22" }]}>
                  <Feather name={rule.icon as any} size={20} color={rule.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.earnTitle, { color: colors.foreground }]}>{rule.title}</Text>
                  <Text style={[styles.earnDesc, { color: colors.mutedForeground }]}>{rule.desc}</Text>
                </View>
                <Text style={[styles.earnPts, { color: colors.primary }]}>{rule.pts}</Text>
              </View>
            ))}
          </View>
        )}

        {tab === "rewards" && (
          <View style={styles.section}>
            {Object.entries(groupedRewards).map(([cat, items]) => (
              <View key={cat} style={{ marginBottom: 24 }}>
                <Text style={[styles.h2, { color: colors.foreground }]}>{CATEGORY_TITLES[cat as Reward["category"]] ?? cat}</Text>
                {items.map((r) => {
                  const affordable = balance >= r.pointsCost;
                  return (
                    <View key={r.key} style={[styles.rewardCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                      <View style={{ flex: 1, paddingRight: 12 }}>
                        <Text style={[styles.rewardLabel, { color: colors.foreground }]}>{r.label}</Text>
                        <Text style={[styles.rewardDesc, { color: colors.mutedForeground }]}>{r.description}</Text>
                        <Text style={[styles.rewardCost, { color: colors.primary }]}>{r.pointsCost.toLocaleString()} pts</Text>
                      </View>
                      <Pressable
                        onPress={() => onRedeem(r)}
                        disabled={!affordable || redeeming === r.key}
                        style={[
                          styles.redeemBtn,
                          {
                            backgroundColor: affordable ? colors.primary : colors.muted,
                            opacity: redeeming === r.key ? 0.6 : 1,
                          },
                        ]}
                      >
                        {redeeming === r.key
                          ? <ActivityIndicator color={affordable ? colors.primaryForeground : colors.mutedForeground} size="small" />
                          : <Text style={[styles.redeemText, { color: affordable ? colors.primaryForeground : colors.mutedForeground }]}>
                              {affordable ? "Redeem" : "Locked"}
                            </Text>}
                      </Pressable>
                    </View>
                  );
                })}
              </View>
            ))}
          </View>
        )}

        {tab === "history" && (
          <View style={styles.section}>
            <Text style={[styles.h2, { color: colors.foreground }]}>Points history</Text>
            {history.length === 0 ? (
              <Text style={[styles.empty, { color: colors.mutedForeground }]}>No activity yet. Earn points by completing your first service.</Text>
            ) : history.map((h) => {
              const meta = SOURCE_LABEL[h.sourceType] ?? { label: h.sourceType, icon: "circle" as const, color: colors.mutedForeground };
              const positive = h.points >= 0;
              return (
                <View key={h.id} style={[styles.histRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View style={[styles.earnIcon, { backgroundColor: meta.color + "22" }]}>
                    <Feather name={meta.icon} size={16} color={meta.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.histTitle, { color: colors.foreground }]}>{meta.label}</Text>
                    <Text style={[styles.histDesc, { color: colors.mutedForeground }]} numberOfLines={1}>{h.reason}</Text>
                    <Text style={[styles.histDate, { color: colors.mutedForeground }]}>{new Date(h.createdAt).toLocaleDateString()}</Text>
                  </View>
                  <Text style={[styles.histPts, { color: positive ? "#10B981" : colors.destructive }]}>
                    {positive ? "+" : ""}{h.points.toLocaleString()}
                  </Text>
                </View>
              );
            })}
          </View>
        )}

        {tab === "redemptions" && (
          <View style={styles.section}>
            <Text style={[styles.h2, { color: colors.foreground }]}>My redemptions</Text>
            {redemptions.length === 0 ? (
              <Text style={[styles.empty, { color: colors.mutedForeground }]}>You haven&apos;t redeemed any rewards yet.</Text>
            ) : redemptions.map((r) => (
              <View key={r.id} style={[styles.histRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={[styles.earnIcon, { backgroundColor: colors.primary + "22" }]}>
                  <Feather name="gift" size={16} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.histTitle, { color: colors.foreground }]}>{r.rewardLabel}</Text>
                  <Text style={[styles.histDesc, { color: colors.mutedForeground }]}>
                    {r.pointsUsed.toLocaleString()} pts • {r.status}
                  </Text>
                  <Text style={[styles.histDate, { color: colors.mutedForeground }]}>{new Date(r.createdAt).toLocaleDateString()}</Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {!isMechanic && (
          <Pressable onPress={() => router.push("/referral")} style={[styles.linkRow, { borderColor: colors.border }]}>
            <Feather name="users" size={18} color={colors.primary} />
            <Text style={[styles.linkText, { color: colors.foreground }]}>Refer a friend — earn 1,000 pts on their first paid job</Text>
            <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
          </Pressable>
        )}
      </ScrollView>
    </>
  );
}

const CUSTOMER_EARN = [
  { icon: "credit-card",  color: "#3B82F6", title: "Service spending",     desc: "Earn 1 point per $1 spent on completed jobs", pts: "1 / $" },
  { icon: "edit-3",       color: "#F59E0B", title: "Verified reviews",     desc: "Leave a written review after a job (50–200 pts based on rating)", pts: "50–200" },
  { icon: "clipboard",    color: "#8B5CF6", title: "Post-service survey",  desc: "Rate your mechanic after every completed job", pts: "25" },
  { icon: "users",        color: "#10B981", title: "Referrals",            desc: "Refer a friend — earn 1,000 pts on their first paid job", pts: "1,000" },
];
const MECHANIC_EARN = [
  { icon: "check-circle", color: "#3B82F6", title: "Job completion",       desc: "Detailing 50 • Maintenance 75 • Diagnostic 100 • Repair 150", pts: "50–150" },
  { icon: "star",         color: "#F59E0B", title: "Customer rating",      desc: "Earn 20 pts per star on every rated job (5★ = 100 pts)", pts: "20–100" },
  { icon: "trending-up",  color: "#10B981", title: "Approved upsells",     desc: "Earn 2 pts per $1 — only upsells the customer explicitly approves", pts: "2 / $" },
  { icon: "award",        color: "#8B5CF6", title: "Tenure & loyalty",     desc: "Stay active on the platform to unlock periodic bonuses", pts: "—" },
];

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, paddingBottom: 60 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  hero: { borderRadius: 16, padding: 20, marginBottom: 16 },
  heroRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  heroLabel: { fontSize: 14, fontWeight: "600", opacity: 0.95 },
  heroBalance: { fontSize: 44, fontWeight: "800", marginTop: 4 },
  heroSub: { fontSize: 13, marginTop: 4 },
  tabs: { flexDirection: "row", borderRadius: 12, padding: 4, marginBottom: 16 },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: "center" },
  tabText: { fontSize: 13, fontWeight: "600" },
  section: {},
  h2: { fontSize: 16, fontWeight: "700", marginBottom: 10, marginTop: 4 },
  earnRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 12, borderWidth: 1, marginBottom: 8 },
  earnIcon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  earnTitle: { fontSize: 14, fontWeight: "600" },
  earnDesc: { fontSize: 12, marginTop: 2 },
  earnPts: { fontSize: 13, fontWeight: "700" },
  rewardCard: { flexDirection: "row", alignItems: "center", padding: 14, borderRadius: 12, borderWidth: 1, marginBottom: 8 },
  rewardLabel: { fontSize: 14, fontWeight: "600" },
  rewardDesc: { fontSize: 12, marginTop: 2 },
  rewardCost: { fontSize: 13, fontWeight: "700", marginTop: 6 },
  redeemBtn: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, minWidth: 88, alignItems: "center" },
  redeemText: { fontSize: 13, fontWeight: "700" },
  histRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 10, borderWidth: 1, marginBottom: 6 },
  histTitle: { fontSize: 13, fontWeight: "600" },
  histDesc: { fontSize: 12, marginTop: 2 },
  histDate: { fontSize: 11, marginTop: 2 },
  histPts: { fontSize: 14, fontWeight: "700" },
  empty: { fontSize: 13, paddingVertical: 24, textAlign: "center" },
  linkRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 14, borderRadius: 12, borderWidth: 1, marginTop: 12 },
  linkText: { flex: 1, fontSize: 13, fontWeight: "600" },
});
