import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator,
  Share, RefreshControl,
} from "react-native";
import { Stack } from "expo-router";
import { useState, useEffect, useCallback } from "react";
import { useColors } from "@/hooks/useColors";
import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Clipboard from "expo-clipboard";
import { getApiUrl } from "@/lib/apiConfig";

type FriendStatus = "pending" | "converted" | "rewarded";

interface ReferralData {
  referralCode: string;
  referralLink: string | null;
  rewardPerConversion: number;
  totalReferrals: number;
  pendingReferrals: number;
  convertedReferrals: number;
  totalPointsEarned: number;
  referredUsers: {
    id: number;
    name: string;
    createdAt: string;
    status: FriendStatus;
    pointsAwarded: number;
  }[];
}

const STATUS_META: Record<FriendStatus, { color: string; label: string; icon: keyof typeof Feather.glyphMap }> = {
  pending:   { color: "#F59E0B", label: "Pending first job",  icon: "clock" },
  converted: { color: "#3B82F6", label: "Converted",          icon: "check" },
  rewarded:  { color: "#22C55E", label: "Rewarded",           icon: "check-circle" },
};

export default function ReferralScreen() {
  const colors = useColors();
  const [data, setData] = useState<ReferralData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [copied, setCopied] = useState(false);
  const fetchData = useCallback(async () => {
    try {
      const token = await AsyncStorage.getItem("auth_token");
      const res = await fetch(getApiUrl("/referral"), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) setData(await res.json());
    } catch { /* non-fatal */ }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const shareText = data?.referralCode
    ? `Join me on APS — Automotive Platform System! Use my referral code ${data.referralCode} when you sign up. After your first paid service, I earn ${data.rewardPerConversion.toLocaleString()} bonus points.${data.referralLink ? `\n\n${data.referralLink}` : ""}`
    : "";

  const handleCopy = async () => {
    if (!data?.referralCode) return;
    await Clipboard.setStringAsync(data.referralLink ?? data.referralCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShare = async () => {
    if (!data?.referralCode) return;
    await Share.share({ message: shareText, title: "Join APS with my referral code" });
  };

  return (
    <>
      <Stack.Screen options={{
        title: "Refer a Friend",
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.foreground,
        headerShown: true,
      }} />
      <ScrollView
        style={[styles.container, { backgroundColor: colors.background }]}
        contentContainerStyle={{ padding: 16, paddingBottom: 100, gap: 16 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchData(); }} tintColor={colors.primary} />}
      >
        {loading ? (
          <View style={styles.center}><ActivityIndicator color={colors.primary} size="large" /></View>
        ) : !data ? (
          <View style={styles.center}>
            <Text style={{ color: colors.mutedForeground }}>Couldn't load your referral info.</Text>
          </View>
        ) : (
          <>
            {/* Hero — referral code + share */}
            <View style={[styles.hero, { backgroundColor: colors.primary + "12", borderColor: colors.primary + "44" }]}>
              <View style={[styles.heroIcon, { backgroundColor: colors.primary }]}>
                <Feather name="gift" size={26} color="white" />
              </View>
              <Text style={[styles.heroTitle, { color: colors.foreground }]}>Refer friends, earn rewards</Text>
              <Text style={[styles.heroSub, { color: colors.mutedForeground }]}>
                Share your code. When a friend signs up and completes their first paid service,
                you earn {data.rewardPerConversion.toLocaleString()} bonus points.
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
                    {copied ? "Copied!" : data.referralLink ? "Copy link" : "Copy code"}
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

            {/* Stats */}
            <View style={styles.statsRow}>
              <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.statVal, { color: colors.primary }]}>{data.totalReferrals}</Text>
                <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Sent</Text>
              </View>
              <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.statVal, { color: "#F59E0B" }]}>{data.pendingReferrals}</Text>
                <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Pending</Text>
              </View>
              <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.statVal, { color: "#22C55E" }]}>{data.convertedReferrals}</Text>
                <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Converted</Text>
              </View>
              <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.statVal, { color: colors.primary }]}>{data.totalPointsEarned.toLocaleString()}</Text>
                <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Points</Text>
              </View>
            </View>

            {/* How it works */}
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>How it works</Text>
              {[
                { n: "1", title: "Share your code",        desc: "Send your APS code to a friend." },
                { n: "2", title: "They sign up",           desc: "Friend creates an APS account using your code." },
                { n: "3", title: "They book a service",    desc: "Friend completes their first paid service job." },
                { n: "4", title: "You earn",               desc: `${data.rewardPerConversion.toLocaleString()} points land in your loyalty balance.` },
              ].map((s) => (
                <View key={s.n} style={styles.stepRow}>
                  <View style={[styles.stepDot, { backgroundColor: colors.primary }]}>
                    <Text style={styles.stepNum}>{s.n}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.stepTitle, { color: colors.foreground }]}>{s.title}</Text>
                    <Text style={[styles.stepDesc, { color: colors.mutedForeground }]}>{s.desc}</Text>
                  </View>
                </View>
              ))}
            </View>

            {/* Friends list with status */}
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>Friends you've referred</Text>
              {data.referredUsers.length === 0 ? (
                <Text style={[styles.empty, { color: colors.mutedForeground }]}>
                  No referrals yet. Share your code above to get started.
                </Text>
              ) : (
                data.referredUsers.map((u) => {
                  const meta = STATUS_META[u.status];
                  return (
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
                          {u.pointsAwarded > 0 ? `  •  +${u.pointsAwarded.toLocaleString()} pts` : ""}
                        </Text>
                      </View>
                      <View style={[styles.statusPill, { backgroundColor: meta.color + "22", borderColor: meta.color + "55" }]}>
                        <Feather name={meta.icon} size={12} color={meta.color} />
                        <Text style={[styles.statusText, { color: meta.color }]}>{meta.label}</Text>
                      </View>
                    </View>
                  );
                })
              )}
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
  hero: { borderRadius: 18, borderWidth: 1, padding: 20, gap: 12, alignItems: "center" },
  heroIcon: { width: 56, height: 56, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  heroTitle: { fontSize: 18, fontWeight: "800", textAlign: "center" },
  heroSub: { fontSize: 13, lineHeight: 19, textAlign: "center" },
  codeBox: {
    width: "100%", borderWidth: 2, borderRadius: 14, padding: 18,
    alignItems: "center", borderStyle: "dashed", marginTop: 4,
  },
  codeText: { fontSize: 26, fontWeight: "800", letterSpacing: 3, fontFamily: "monospace" },
  codeActions: { flexDirection: "row", gap: 10, width: "100%" },
  codeBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, height: 46, borderRadius: 12, paddingHorizontal: 18, borderWidth: 1,
  },
  codeBtnText: { fontSize: 14, fontWeight: "700" },
  statsRow: { flexDirection: "row", gap: 8 },
  statCard: { flex: 1, borderWidth: 1, borderRadius: 14, padding: 12, alignItems: "center", gap: 4 },
  statVal: { fontSize: 20, fontWeight: "800" },
  statLabel: { fontSize: 11, textAlign: "center" },
  card: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 14 },
  cardTitle: { fontSize: 16, fontWeight: "700" },
  stepRow: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  stepDot: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  stepNum: { color: "white", fontWeight: "800", fontSize: 13 },
  stepTitle: { fontSize: 14, fontWeight: "700" },
  stepDesc: { fontSize: 13, lineHeight: 18, marginTop: 2 },
  empty: { fontSize: 13, fontStyle: "italic", textAlign: "center", paddingVertical: 12 },
  friendRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  friendAvatar: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  friendAvatarText: { fontSize: 16, fontWeight: "700" },
  friendInfo: { flex: 1 },
  friendName: { fontSize: 15, fontWeight: "600" },
  friendDate: { fontSize: 12, marginTop: 1 },
  statusPill: {
    flexDirection: "row", alignItems: "center", gap: 4,
    borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4,
  },
  statusText: { fontSize: 11, fontWeight: "700" },
});
