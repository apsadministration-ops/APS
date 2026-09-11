import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput,
} from "react-native";
import { confirm } from "@/utils/confirm";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useState, useEffect, useCallback } from "react";
import * as Haptics from "expo-haptics";
import * as WebBrowser from "expo-web-browser";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getApiUrl } from "@/lib/apiConfig";

const TIER_META: Record<string, { color: string; label: string; icon: string; desc: string }> = {
  detailer: { color: "#60A5FA", label: "Detailer", icon: "droplet", desc: "TIER 1 — entry level, cosmetic and basic services" },
  technician: { color: "#34D399", label: "Basic Mechanic", icon: "tool", desc: "TIER 2 — oil changes, brakes, diagnostics assistance" },
  senior: { color: "#FBBF24", label: "Intermediate Mechanic", icon: "star", desc: "TIER 3 — suspension, CV axles, steering systems" },
  advanced: { color: "#FB923C", label: "Advanced Mechanic", icon: "zap", desc: "TIER 4 — high-skill repairs and full diagnostics" },
  master: { color: "#F472B6", label: "Master Mechanic", icon: "award", desc: "TIER 5 — full diagnostic authority, complex systems" },
};

const TIER_ORDER = ["detailer", "technician", "senior", "advanced", "master"];

interface LoyaltyData { balance: number; history: { id: number; points: number; reason: string; createdAt: string }[] }
interface ConnectStatus { accountId: string | null; ready: boolean; chargesEnabled: boolean; payoutsEnabled: boolean; detailsSubmitted: boolean }

function Row({ icon, label, value, onPress, danger }: {
  icon: string; label: string; value?: string; onPress?: () => void; danger?: boolean;
}) {
  const colors = useColors();
  return (
    <Pressable style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={onPress}>
      <View style={[styles.rowIcon, { backgroundColor: danger ? colors.destructive + "20" : colors.secondary }]}>
        <Feather name={icon as any} size={18} color={danger ? colors.destructive : colors.foreground} />
      </View>
      <View style={styles.rowContent}>
        <Text style={[styles.rowLabel, { color: danger ? colors.destructive : colors.foreground }]}>{label}</Text>
        {value ? <Text style={[styles.rowValue, { color: colors.mutedForeground }]}>{value}</Text> : null}
      </View>
      {onPress && <Feather name="chevron-right" size={18} color={colors.mutedForeground} />}
    </Pressable>
  );
}

export default function MechanicProfileScreen() {
  const colors = useColors();
  const { user, logout } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tier = user?.mechanicTier ?? "detailer";
  const tierMeta = TIER_META[tier] ?? TIER_META.detailer;
  const tierIndex = TIER_ORDER.indexOf(tier);
  const nextTier = TIER_ORDER[tierIndex + 1];

  const [certifications, setCertifications] = useState<string[]>([]);
  const [loyalty, setLoyalty] = useState<LoyaltyData | null>(null);
  const [newCert, setNewCert] = useState("");
  const [addingCert, setAddingCert] = useState(false);
  const [showAddCert, setShowAddCert] = useState(false);
  const [connect, setConnect] = useState<ConnectStatus | null>(null);
  const [payoutsLoading, setPayoutsLoading] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const token = await AsyncStorage.getItem("auth_token");
      const authHeaders: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
      const meRes = await fetch(getApiUrl("/auth/me"), { headers: authHeaders });
      if (meRes.ok) {
        const me = await meRes.json();
        try { setCertifications(JSON.parse(me.certifications ?? "[]")); } catch { setCertifications([]); }
      }
      const lRes = await fetch(getApiUrl("/loyalty"), { headers: authHeaders });
      if (lRes.ok) setLoyalty(await lRes.json());
      const cRes = await fetch(getApiUrl("/payments/connect/status"), { headers: authHeaders });
      if (cRes.ok) setConnect(await cRes.json());
    } catch { /* non-fatal */ }
  }, []);

  const handlePayouts = async () => {
    setPayoutsLoading(true);
    try {
      const token = await AsyncStorage.getItem("auth_token");
      const res = await fetch(getApiUrl("/payments/connect/onboarding"), {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      if (!res.ok || !data.url) return;
      if (Platform.OS === "web") window.open(data.url, "_blank");
      else await WebBrowser.openBrowserAsync(data.url);
      // Re-fetch status when user returns
      setTimeout(() => { void fetchData(); }, 1500);
    } finally { setPayoutsLoading(false); }
  };

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleAddCert = async () => {
    if (!newCert.trim()) return;
    setAddingCert(true);
    try {
      const token = await AsyncStorage.getItem("auth_token");
      const updated = [...certifications, newCert.trim()];
      const res = await fetch(getApiUrl(`/users/${user?.id}`), {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ certifications: JSON.stringify(updated) }),
      });
      if (res.ok) { setCertifications(updated); setNewCert(""); setShowAddCert(false); }
    } catch { /* non-fatal */ }
    finally { setAddingCert(false); }
  };

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

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 120 }}
        contentInsetAdjustmentBehavior="automatic"
      >
        {/* Avatar */}
        <View style={[styles.avatar, { backgroundColor: tierMeta.color }]}>
          <Text style={styles.avatarText}>{user?.name?.charAt(0).toUpperCase() ?? "?"}</Text>
        </View>
        <Text style={[styles.name, { color: colors.foreground }]}>{user?.name}</Text>

        {/* Tier badge */}
        <View style={[styles.tierCard, { backgroundColor: tierMeta.color + "18", borderColor: tierMeta.color + "44" }]}>
          <View style={[styles.tierIcon, { backgroundColor: tierMeta.color }]}>
            <Feather name={tierMeta.icon as any} size={20} color="white" />
          </View>
          <View style={styles.tierInfo}>
            <Text style={[styles.tierLabel, { color: tierMeta.color }]}>{tierMeta.label}</Text>
            <Text style={[styles.tierDesc, { color: colors.mutedForeground }]}>{tierMeta.desc}</Text>
          </View>
        </View>

        {/* Tier progression */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>Certification Path</Text>
          {TIER_ORDER.map((t, i) => {
            const meta = TIER_META[t];
            const done = i < tierIndex;
            const active = t === tier;
            return (
              <View key={t} style={styles.pathRow}>
                <View style={[styles.pathDot, {
                  backgroundColor: done || active ? meta.color : colors.border,
                  borderColor: active ? meta.color : "transparent",
                  borderWidth: active ? 3 : 0,
                }]} />
                <View style={styles.pathInfo}>
                  <Text style={[styles.pathLabel, { color: active ? colors.foreground : colors.mutedForeground, fontWeight: active ? "700" : "400" }]}>
                    {meta.label} {active ? "← Current" : ""}
                  </Text>
                  <Text style={[styles.pathDesc, { color: colors.mutedForeground }]}>{meta.desc}</Text>
                </View>
                {done && <Feather name="check-circle" size={18} color={meta.color} />}
              </View>
            );
          })}
          {nextTier && (
            <View style={[styles.nextTierNote, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
              <Feather name="info" size={14} color={colors.mutedForeground} />
              <Text style={[styles.nextTierText, { color: colors.mutedForeground }]}>
                Add certifications and have admin promote you to <Text style={{ fontWeight: "700" }}>{TIER_META[nextTier]?.label}</Text>.
              </Text>
            </View>
          )}
        </View>

        {/* Certifications */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.certHeader}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Certifications</Text>
            <Pressable
              style={[styles.addCertBtn, { backgroundColor: colors.primary + "18", borderColor: colors.primary + "44" }]}
              onPress={() => setShowAddCert(!showAddCert)}
            >
              <Feather name="plus" size={14} color={colors.primary} />
              <Text style={[styles.addCertText, { color: colors.primary }]}>Add</Text>
            </Pressable>
          </View>

          {showAddCert && (
            <View style={styles.addCertForm}>
              <TextInput
                style={[styles.certInput, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
                placeholder="e.g. ASE A1 Engine Repair"
                placeholderTextColor={colors.mutedForeground}
                value={newCert}
                onChangeText={setNewCert}
              />
              <Pressable
                style={[styles.certSubmitBtn, { backgroundColor: colors.primary }]}
                onPress={handleAddCert}
                disabled={addingCert}
              >
                {addingCert ? <ActivityIndicator size="small" color="white" /> : <Text style={styles.certSubmitText}>Save</Text>}
              </Pressable>
            </View>
          )}

          {certifications.length === 0 ? (
            <View style={styles.emptyCert}>
              <Feather name="award" size={24} color={colors.mutedForeground} />
              <Text style={[styles.emptyCertText, { color: colors.mutedForeground }]}>
                No certifications yet. Add your ASE, manufacturer, or training certifications.
              </Text>
            </View>
          ) : (
            certifications.map((cert, i) => (
              <View key={i} style={[styles.certRow, { backgroundColor: colors.secondary, borderRadius: 10 }]}>
                <Feather name="award" size={16} color={tierMeta.color} />
                <Text style={[styles.certText, { color: colors.foreground }]}>{cert}</Text>
              </View>
            ))
          )}
        </View>

        {/* Performance Rewards (job, ratings, upsells, tenure) */}
        <Pressable
          style={[styles.card, { backgroundColor: colors.primary + "12", borderColor: colors.primary + "30" }]}
          onPress={() => router.push("/loyalty")}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <View style={[styles.tierIcon, { backgroundColor: colors.primary }]}>
              <Feather name="award" size={20} color="white" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>Performance Rewards</Text>
              <Text style={[styles.loyaltyBal, { color: colors.primary, textAlign: "left", fontSize: 22 }]}>
                {(user?.mechanicPoints ?? 0).toLocaleString()} pts
              </Text>
              <Text style={[styles.tierDesc, { color: colors.mutedForeground }]}>
                Earn for jobs, ratings, and approved upsells
              </Text>
            </View>
            <Feather name="chevron-right" size={20} color={colors.primary} />
          </View>
        </Pressable>

        {/* Customer-side referral points (if any) */}
        {loyalty && loyalty.balance > 0 && (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Referral Points</Text>
            <Text style={[styles.loyaltyBal, { color: colors.primary }]}>{loyalty.balance.toLocaleString()} pts</Text>
            <Pressable
              style={[styles.referralLink, { borderColor: colors.border }]}
              onPress={() => router.push("/referral")}
            >
              <Feather name="gift" size={16} color={colors.primary} />
              <Text style={[styles.referralLinkText, { color: colors.primary }]}>View Referral Program</Text>
              <Feather name="chevron-right" size={16} color={colors.primary} />
            </Pressable>
          </View>
        )}

        {/* Account info */}
        <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>ACCOUNT</Text>
        <Row icon="mail" label="Email" value={user?.email} />
        <Row icon="phone" label="Phone" value={user?.phone ?? "Not set"} />
        <Row icon="shield" label="Account Status" value={user?.status?.toUpperCase()} />
        {user?.referralCode && (
          <>
            <Row icon="gift" label="My Referral Code" value={user.referralCode} onPress={() => router.push("/referral")} />
            <Row icon="zap" label="Amplification Kit" value="QR, booking link, AI content" onPress={() => router.push("/(mechanic)/amplification")} />
            <Row icon="dollar-sign" label="Payouts Dashboard" value="Earnings, tips, status, retries" onPress={() => router.push("/mechanic/payouts")} />
          </>
        )}

        {/* Payouts */}
        <Text style={[styles.sectionTitle, { color: colors.mutedForeground, marginTop: 24 }]}>PAYOUTS</Text>
        <Pressable
          style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border, opacity: payoutsLoading ? 0.6 : 1 }]}
          onPress={() => { void handlePayouts(); }}
          disabled={payoutsLoading}
        >
          <View style={[styles.rowIcon, { backgroundColor: connect?.ready ? "#22c55e22" : colors.secondary }]}>
            <Feather name={connect?.ready ? "check-circle" : "credit-card"} size={18} color={connect?.ready ? "#22c55e" : colors.foreground} />
          </View>
          <View style={styles.rowContent}>
            <Text style={[styles.rowLabel, { color: colors.foreground }]}>
              {connect?.ready ? "Payouts Active" : connect?.accountId ? "Resume Payout Setup" : "Set up Payouts"}
            </Text>
            <Text style={[styles.rowValue, { color: colors.mutedForeground }]}>
              {connect?.ready
                ? "Funds transfer to your bank automatically"
                : connect?.accountId
                  ? "Onboarding in progress — tap to continue"
                  : "Required before customers can pay you"}
            </Text>
          </View>
          {payoutsLoading
            ? <ActivityIndicator size="small" color={colors.mutedForeground} />
            : <Feather name="chevron-right" size={18} color={colors.mutedForeground} />}
        </Pressable>

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
  name: { fontSize: 22, fontWeight: "700", textAlign: "center", marginBottom: 16 },
  tierCard: {
    flexDirection: "row", alignItems: "center", gap: 14,
    padding: 16, borderRadius: 16, borderWidth: 1, marginBottom: 16,
  },
  tierIcon: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  tierInfo: { flex: 1 },
  tierLabel: { fontSize: 18, fontWeight: "800" },
  tierDesc: { fontSize: 12, marginTop: 2 },
  card: { borderWidth: 1, borderRadius: 16, padding: 16, marginBottom: 16, gap: 10 },
  cardTitle: { fontSize: 16, fontWeight: "700" },
  pathRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  pathDot: { width: 16, height: 16, borderRadius: 8 },
  pathInfo: { flex: 1 },
  pathLabel: { fontSize: 14 },
  pathDesc: { fontSize: 12 },
  nextTierNote: { flexDirection: "row", gap: 8, padding: 12, borderRadius: 10, borderWidth: 1, alignItems: "flex-start" },
  nextTierText: { flex: 1, fontSize: 13, lineHeight: 18 },
  certHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  addCertBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1 },
  addCertText: { fontSize: 13, fontWeight: "600" },
  addCertForm: { flexDirection: "row", gap: 10 },
  certInput: { flex: 1, height: 44, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, fontSize: 14 },
  certSubmitBtn: { height: 44, paddingHorizontal: 16, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  certSubmitText: { color: "white", fontWeight: "700", fontSize: 14 },
  emptyCert: { flexDirection: "row", gap: 10, alignItems: "flex-start", padding: 12 },
  emptyCertText: { flex: 1, fontSize: 13, lineHeight: 20 },
  certRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12 },
  certText: { flex: 1, fontSize: 14, fontWeight: "500" },
  loyaltyBal: { fontSize: 28, fontWeight: "800", textAlign: "center" },
  referralLink: {
    flexDirection: "row", alignItems: "center", gap: 10,
    padding: 12, borderRadius: 10, borderWidth: 1,
  },
  referralLinkText: { flex: 1, fontSize: 14, fontWeight: "600" },
  sectionTitle: { fontSize: 11, fontWeight: "700", letterSpacing: 1, marginBottom: 8 },
  row: {
    flexDirection: "row", alignItems: "center", gap: 14,
    padding: 14, borderRadius: 12, borderWidth: 1, marginBottom: 8,
  },
  rowIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  rowContent: { flex: 1 },
  rowLabel: { fontSize: 15, fontWeight: "600" },
  rowValue: { fontSize: 13, marginTop: 2 },
});
