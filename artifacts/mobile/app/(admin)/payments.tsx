import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl,
} from "react-native";
import { useRouter } from "expo-router";
import { confirm } from "@/utils/confirm";
import { useColors } from "@/hooks/useColors";
import { Feather } from "@expo/vector-icons";
import { useState, useEffect, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

interface Payment {
  id: number;
  jobId: number;
  amount: number;
  platformFee: number;
  mechanicPayout: number;
  status: string;
  providerSessionId?: string | null;
  createdAt: string;
  releasedAt?: string;
  job?: {
    vin: string;
    jobType: string;
    mechanicName?: string;
    customerName?: string;
  };
}

const STATUS_COLOR: Record<string, string> = {
  // Legacy escrow flow
  held: "#F59E0B",
  released: "#22C55E",
  // Stripe flow
  pending: "#94A3B8",
  authorized: "#F59E0B",
  captured: "#22C55E",
  failed: "#EF4444",
  canceled: "#6B7280",
  refunded: "#EF4444",
};

export default function AdminPaymentsScreen() {
  const colors = useColors();
  const router = useRouter();
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [releasing, setReleasing] = useState<number | null>(null);
  const [filter, setFilter] = useState<"all" | "open" | "completed">("open");
  const domain = process.env.EXPO_PUBLIC_DOMAIN;

  const fetchPayments = useCallback(async () => {
    try {
      const token = await AsyncStorage.getItem("auth_token");
      const res = await fetch(`https://${domain}/api/payments`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setPayments(await res.json());
    } catch { /* non-fatal */ }
    finally { setLoading(false); setRefreshing(false); }
  }, [domain]);

  useEffect(() => { fetchPayments(); }, [fetchPayments]);

  const handleRelease = async (paymentId: number, jobId: number, amount: number) => {
    const ok = await confirm({
      title: "Release Payment",
      message: `Release $${amount.toFixed(2)} to the mechanic? This cannot be undone.`,
      confirmText: "Release",
    });
    if (!ok) return;
    setReleasing(paymentId);
    try {
      const token = await AsyncStorage.getItem("auth_token");
      // Server route is keyed by jobId, not the payment row id.
      const res = await fetch(`https://${domain}/api/payments/${jobId}/release`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) fetchPayments();
    } catch { /* non-fatal */ }
    finally { setReleasing(null); }
  };

  const onRefresh = () => { setRefreshing(true); fetchPayments(); };

  // "open" = needs attention (legacy held OR Stripe authorized waiting for capture)
  // "completed" = settled (legacy released OR Stripe captured)
  const isOpen = (p: Payment) => p.status === "held" || p.status === "authorized";
  const isDone = (p: Payment) => p.status === "released" || p.status === "captured";
  const filtered = payments.filter((p) =>
    filter === "all" ? true : filter === "open" ? isOpen(p) : isDone(p),
  );
  const totalHeld = payments.filter(isOpen).reduce((s, p) => s + p.mechanicPayout, 0);
  const totalReleased = payments.filter(isDone).reduce((s, p) => s + p.amount, 0);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Summary bar */}
      <View style={[styles.summary, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryAmount, { color: "#F59E0B" }]}>${totalHeld.toFixed(2)}</Text>
          <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>Held (mechanic payout)</Text>
        </View>
        <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryAmount, { color: "#22C55E" }]}>${totalReleased.toFixed(2)}</Text>
          <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>Released</Text>
        </View>
      </View>

      {/* Quick links */}
      <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 16, marginTop: 8 }}>
        <Pressable onPress={() => router.push("/(admin)/disputes")}
          style={{ flex: 1, backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: 8, padding: 12, alignItems: "center", flexDirection: "row", gap: 8, justifyContent: "center" }}>
          <Feather name="alert-octagon" size={16} color="#dc2626" />
          <Text style={{ color: colors.foreground, fontWeight: "600" }}>Disputes</Text>
        </Pressable>
      </View>

      {/* Filter */}
      <View style={[styles.filterBar, { borderBottomColor: colors.border }]}>
        {([
          { k: "open", label: "Open" },
          { k: "completed", label: "Completed" },
          { k: "all", label: "All" },
        ] as const).map(({ k, label }) => (
          <Pressable
            key={k}
            style={[styles.filterBtn, { borderBottomWidth: filter === k ? 2 : 0, borderBottomColor: colors.primary }]}
            onPress={() => setFilter(k)}
          >
            <Text style={[styles.filterBtnText, { color: filter === k ? colors.primary : colors.mutedForeground }]}>
              {label}
            </Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} size="large" /></View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 120, gap: 10 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        >
          {filtered.length === 0 ? (
            <View style={[styles.empty, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Feather name="check-circle" size={36} color="#22C55E" />
              <Text style={[styles.emptyText, { color: colors.foreground }]}>
                {filter === "open" ? "No open payments" : "No payments found"}
              </Text>
            </View>
          ) : (
            filtered.map((payment) => {
              const statusColor = STATUS_COLOR[payment.status] ?? colors.mutedForeground;
              return (
                <View key={payment.id} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View style={styles.cardHeader}>
                    <View>
                      <Text style={[styles.cardTitle, { color: colors.foreground }]}>
                        Payment #{payment.id} — Job #{payment.jobId}
                      </Text>
                      <Text style={[styles.cardSub, { color: colors.mutedForeground }]}>
                        {new Date(payment.createdAt).toLocaleDateString()}
                      </Text>
                    </View>
                    <View style={[styles.statusPill, { backgroundColor: statusColor + "18" }]}>
                      <Text style={[styles.statusText, { color: statusColor }]}>{payment.status.toUpperCase()}</Text>
                    </View>
                  </View>

                  <View style={[styles.amountsRow, { backgroundColor: colors.background, borderRadius: 10 }]}>
                    <View style={styles.amountCol}>
                      <Text style={[styles.amountLabel, { color: colors.mutedForeground }]}>Total</Text>
                      <Text style={[styles.amountValue, { color: colors.foreground }]}>${payment.amount.toFixed(2)}</Text>
                    </View>
                    <View style={styles.amountCol}>
                      <Text style={[styles.amountLabel, { color: colors.mutedForeground }]}>Platform (10%)</Text>
                      <Text style={[styles.amountValue, { color: colors.primary }]}>${payment.platformFee.toFixed(2)}</Text>
                    </View>
                    <View style={styles.amountCol}>
                      <Text style={[styles.amountLabel, { color: colors.mutedForeground }]}>Mechanic</Text>
                      <Text style={[styles.amountValue, { color: "#22C55E", fontWeight: "800" }]}>${payment.mechanicPayout.toFixed(2)}</Text>
                    </View>
                  </View>

                  {/* Legacy held → admin manual release */}
                  {payment.status === "held" && !payment.providerSessionId && (
                    <Pressable
                      style={[styles.releaseBtn, { backgroundColor: colors.primary, opacity: releasing === payment.id ? 0.6 : 1 }]}
                      onPress={() => { void handleRelease(payment.id, payment.jobId, payment.mechanicPayout); }}
                      disabled={releasing === payment.id}
                    >
                      {releasing === payment.id
                        ? <ActivityIndicator size="small" color="white" />
                        : <>
                          <Feather name="unlock" size={16} color="white" />
                          <Text style={styles.releaseBtnText}>Release ${payment.mechanicPayout.toFixed(2)} to Mechanic</Text>
                        </>}
                    </Pressable>
                  )}
                  {/* Stripe authorized → captured automatically on work log submission */}
                  {payment.status === "authorized" && (
                    <View style={[styles.stripeNote, { backgroundColor: "#F59E0B18", borderColor: "#F59E0B40" }]}>
                      <Feather name="lock" size={14} color="#F59E0B" />
                      <Text style={[styles.stripeNoteText, { color: "#F59E0B" }]}>
                        Funds on hold via Stripe — captured automatically when the mechanic submits work log.
                      </Text>
                    </View>
                  )}
                  {payment.status === "captured" && payment.releasedAt && (
                    <Text style={[styles.releasedNote, { color: "#22C55E" }]}>
                      Captured {new Date(payment.releasedAt).toLocaleDateString()} via Stripe
                    </Text>
                  )}
                  {payment.status === "released" && payment.releasedAt && (
                    <Text style={[styles.releasedNote, { color: "#22C55E" }]}>
                      Released {new Date(payment.releasedAt).toLocaleDateString()}
                    </Text>
                  )}
                </View>
              );
            })
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  summary: {
    flexDirection: "row",
    padding: 16,
    borderBottomWidth: 1,
  },
  summaryItem: { flex: 1, alignItems: "center", gap: 2 },
  summaryAmount: { fontSize: 22, fontWeight: "800" },
  summaryLabel: { fontSize: 12, textAlign: "center" },
  summaryDivider: { width: 1 },
  filterBar: { flexDirection: "row", borderBottomWidth: 1, paddingHorizontal: 16 },
  filterBtn: { flex: 1, alignItems: "center", paddingVertical: 12 },
  filterBtnText: { fontSize: 14, fontWeight: "600" },
  card: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    gap: 12,
  },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  cardTitle: { fontSize: 14, fontWeight: "700" },
  cardSub: { fontSize: 12, marginTop: 2 },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  statusText: { fontSize: 11, fontWeight: "700" },
  amountsRow: { flexDirection: "row", padding: 12 },
  amountCol: { flex: 1, alignItems: "center", gap: 3 },
  amountLabel: { fontSize: 11 },
  amountValue: { fontSize: 16, fontWeight: "700" },
  releaseBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 48,
    borderRadius: 12,
  },
  releaseBtnText: { color: "white", fontWeight: "700", fontSize: 14 },
  releasedNote: { fontSize: 13, textAlign: "center", fontWeight: "600" },
  stripeNote: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 10, borderWidth: 1 },
  stripeNoteText: { flex: 1, fontSize: 12, fontWeight: "500", lineHeight: 16 },
  empty: { padding: 40, borderRadius: 16, borderWidth: 1, alignItems: "center", gap: 10 },
  emptyText: { fontSize: 16, fontWeight: "600" },
});
