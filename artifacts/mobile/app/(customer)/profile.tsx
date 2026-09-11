import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator,
} from "react-native";
import { confirm } from "@/utils/confirm";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { getApiUrl } from "@/lib/apiConfig";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useState, useEffect, useCallback } from "react";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";

interface LoyaltyData {
  balance: number;
  history: { id: number; points: number; reason: string; createdAt: string }[];
}

function Row({ icon, label, value, onPress, danger, badge }: {
  icon: string; label: string; value?: string; onPress?: () => void; danger?: boolean; badge?: string;
}) {
  const colors = useColors();
  return (
    <Pressable
      style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}
      onPress={onPress}
    >
      <View style={[styles.rowIcon, { backgroundColor: danger ? colors.destructive + "20" : colors.secondary }]}>
        <Feather name={icon as any} size={18} color={danger ? colors.destructive : colors.foreground} />
      </View>
      <View style={styles.rowContent}>
        <Text style={[styles.rowLabel, { color: danger ? colors.destructive : colors.foreground }]}>{label}</Text>
        {value ? <Text style={[styles.rowValue, { color: colors.mutedForeground }]}>{value}</Text> : null}
      </View>
      {badge && (
        <View style={[styles.badge, { backgroundColor: colors.primary }]}>
          <Text style={styles.badgeText}>{badge}</Text>
        </View>
      )}
      {onPress && <Feather name="chevron-right" size={18} color={colors.mutedForeground} />}
    </Pressable>
  );
}

export default function ProfileScreen() {
  const colors = useColors();
  const { user, logout } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [loyalty, setLoyalty] = useState<LoyaltyData | null>(null);
  const [loadingLoyalty, setLoadingLoyalty] = useState(true);

  const fetchLoyalty = useCallback(async () => {
    try {
      const token = await AsyncStorage.getItem("auth_token");
      const res = await fetch(getApiUrl("/loyalty"), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) setLoyalty(await res.json());
    } catch { /* non-fatal */ }
    finally { setLoadingLoyalty(false); }
  }, []);

  useEffect(() => { fetchLoyalty(); }, [fetchLoyalty]);

  const handleLogout = async () => {
    const ok = await confirm({
      title: "Sign Out",
      message: "Are you sure you want to sign out?",
      confirmText: "Sign Out",
      destructive: true,
    });
    if (!ok) return;
    try { await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); } catch { /* web */ }
    await logout();
  };

  const pts = loyalty?.balance ?? user?.loyaltyPoints ?? 0;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 120 }}
        contentInsetAdjustmentBehavior="automatic"
      >
        <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
          <Text style={styles.avatarText}>{user?.name?.charAt(0).toUpperCase() ?? "?"}</Text>
        </View>
        <Text style={[styles.name, { color: colors.foreground }]}>{user?.name}</Text>
        <View style={[styles.roleBadge, { backgroundColor: colors.secondary }]}>
          <Text style={[styles.roleText, { color: colors.secondaryForeground }]}>CUSTOMER</Text>
        </View>

        {/* Loyalty Points Card */}
        <Pressable
          style={[styles.loyaltyCard, { backgroundColor: colors.primary + "12", borderColor: colors.primary + "30" }]}
          onPress={() => router.push("/loyalty")}
        >
          <View style={[styles.loyaltyIcon, { backgroundColor: colors.primary }]}>
            <Feather name="gift" size={20} color="white" />
          </View>
          <View style={styles.loyaltyInfo}>
            <Text style={[styles.loyaltyTitle, { color: colors.foreground }]}>APS Rewards</Text>
            {loadingLoyalty
              ? <ActivityIndicator size="small" color={colors.primary} />
              : <Text style={[styles.loyaltyBalance, { color: colors.primary }]}>
                {pts.toLocaleString()} pts
              </Text>}
            <Text style={[styles.loyaltySub, { color: colors.mutedForeground }]}>
              Tap to earn, redeem & track rewards
            </Text>
          </View>
          <Feather name="chevron-right" size={18} color={colors.primary} />
        </Pressable>

        {/* Recent loyalty activity */}
        {loyalty && loyalty.history.length > 0 && (
          <View style={[styles.recentCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.recentTitle, { color: colors.foreground }]}>Recent Activity</Text>
            {loyalty.history.slice(0, 3).map((h) => (
              <View key={h.id} style={styles.historyRow}>
                <View style={[styles.historyIcon, { backgroundColor: h.points > 0 ? "#22C55E20" : "#EF444420" }]}>
                  <Feather name={h.points > 0 ? "plus-circle" : "minus-circle"} size={14} color={h.points > 0 ? "#22C55E" : "#EF4444"} />
                </View>
                <Text style={[styles.historyReason, { color: colors.foreground }]} numberOfLines={1}>{h.reason}</Text>
                <Text style={[styles.historyPts, { color: h.points > 0 ? "#22C55E" : "#EF4444" }]}>
                  {h.points > 0 ? "+" : ""}{h.points}
                </Text>
              </View>
            ))}
            <Pressable onPress={() => router.push("/loyalty")} style={styles.viewAllBtn}>
              <Text style={[styles.viewAllText, { color: colors.primary }]}>View all rewards & history →</Text>
            </Pressable>
          </View>
        )}

        <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>ACCOUNT</Text>
        <Row icon="mail" label="Email" value={user?.email} />
        <Row icon="phone" label="Phone" value={user?.phone ?? "Not set"} />
        <Row icon="shield" label="Account Status" value={user?.status?.toUpperCase()} />
        {user?.referralCode && (
          <Row
            icon="gift"
            label="My Referral Code"
            value={user.referralCode}
            badge="Share"
            onPress={() => router.push("/referral")}
          />
        )}

        <Text style={[styles.sectionTitle, { color: colors.mutedForeground, marginTop: 24 }]}>ACTIONS</Text>
        <Row icon="log-out" label="Sign Out" onPress={() => { void handleLogout(); }} danger />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  avatar: {
    width: 80, height: 80, borderRadius: 40,
    alignItems: "center", justifyContent: "center",
    alignSelf: "center", marginTop: 16, marginBottom: 12,
  },
  avatarText: { fontSize: 32, fontWeight: "700", color: "white" },
  name: { fontSize: 22, fontWeight: "700", textAlign: "center", marginBottom: 8 },
  roleBadge: {
    alignSelf: "center", paddingHorizontal: 12, paddingVertical: 4,
    borderRadius: 20, marginBottom: 24,
  },
  roleText: { fontSize: 11, fontWeight: "700", letterSpacing: 1 },
  loyaltyCard: {
    flexDirection: "row", alignItems: "center", gap: 14,
    padding: 16, borderRadius: 16, borderWidth: 1, marginBottom: 12,
  },
  loyaltyIcon: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  loyaltyInfo: { flex: 1, gap: 2 },
  loyaltyTitle: { fontSize: 14, fontWeight: "600" },
  loyaltyBalance: { fontSize: 24, fontWeight: "800" },
  loyaltySub: { fontSize: 12 },
  recentCard: { borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 20, gap: 10 },
  recentTitle: { fontSize: 14, fontWeight: "700" },
  historyRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  historyIcon: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  historyReason: { flex: 1, fontSize: 13 },
  historyPts: { fontSize: 13, fontWeight: "700" },
  viewAllBtn: { paddingTop: 4 },
  viewAllText: { fontSize: 13, fontWeight: "600" },
  sectionTitle: { fontSize: 11, fontWeight: "700", letterSpacing: 1, marginBottom: 8 },
  row: {
    flexDirection: "row", alignItems: "center", gap: 14,
    padding: 14, borderRadius: 12, borderWidth: 1, marginBottom: 8,
  },
  rowIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  rowContent: { flex: 1 },
  rowLabel: { fontSize: 15, fontWeight: "600" },
  rowValue: { fontSize: 13, marginTop: 2 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, marginRight: 4 },
  badgeText: { color: "white", fontSize: 11, fontWeight: "700" },
});
