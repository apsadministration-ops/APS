import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl,
} from "react-native";
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
  held: "#F59E0B",
  released: "#22C55E",
  refunded: "#EF4444",
};

export default function AdminPaymentsScreen() {
  const colors = useColors();
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [releasing, setReleasing] = useState<number | null>(null);
  const [filter, setFilter] = useState<"all" | "held" | "released">("held");
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

  const handleRelease = async (paymentId: number, amount: number) => {
    const ok = await confirm({
      title: "Release Payment",
      message: `Release $${amount.toFixed(2)} to the mechanic? This cannot be undone.`,
      confirmText: "Release",
    });
    if (!ok) return;
    setReleasing(paymentId);
    try {
      const token = await AsyncStorage.getItem("auth_token");
      const res = await fetch(`https://${domain}/api/payments/${paymentId}/release`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) fetchPayments();
    } catch { /* non-fatal */ }
    finally { setReleasing(null); }
  };

  const onRefresh = () => { setRefreshing(true); fetchPayments(); };

  const filtered = payments.filter((p) => filter === "all" || p.status === filter);
  const totalHeld = payments.filter((p) => p.status === "held").reduce((s, p) => s + p.mechanicPayout, 0);
  const totalReleased = payments.filter((p) => p.status === "released").reduce((s, p) => s + p.amount, 0);

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

      {/* Filter */}
      <View style={[styles.filterBar, { borderBottomColor: colors.border }]}>
        {(["held", "released", "all"] as const).map((f) => (
          <Pressable
            key={f}
            style={[styles.filterBtn, { borderBottomWidth: filter === f ? 2 : 0, borderBottomColor: colors.primary }]}
            onPress={() => setFilter(f)}
          >
            <Text style={[styles.filterBtnText, { color: filter === f ? colors.primary : colors.mutedForeground }]}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
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
                {filter === "held" ? "No held payments" : "No payments found"}
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

                  {payment.status === "held" && (
                    <Pressable
                      style={[styles.releaseBtn, { backgroundColor: colors.primary, opacity: releasing === payment.id ? 0.6 : 1 }]}
                      onPress={() => { void handleRelease(payment.id, payment.mechanicPayout); }}
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
  empty: { padding: 40, borderRadius: 16, borderWidth: 1, alignItems: "center", gap: 10 },
  emptyText: { fontSize: 16, fontWeight: "600" },
});
