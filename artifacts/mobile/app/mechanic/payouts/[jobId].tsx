/**
 * Per-job payout detail. Shows the underlying payment, the customer's
 * confirmation (if any), tips, and the Stripe transfer/payout event timeline.
 * Failed captures expose a "Retry" button that hits POST /payouts/:jobId/retry.
 */

import { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useColors } from "@/hooks/useColors";

interface Payment { id: number; status: string; amount: number; mechanicPayout: number; platformFee: number; captureBlockedReason: string | null; failureReason: string | null }
interface Confirmation { status: string; expiresAt: string; respondedAt: string | null; disputeReason: string | null }
interface Tip { id: number; amountCents: number; mechanicAmountCents: number; status: string; createdAt: string }
interface Event { id: number; kind: string; amountCents: number | null; failureMessage: string | null; createdAt: string }
interface Detail { job: { jobType: string; status: string }; payment: Payment | null; confirmation: Confirmation | null; tips: Tip[]; events: Event[] }

export default function PayoutDetail() {
  const colors = useColors();
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const id = Number(jobId);
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  const [data, setData] = useState<Detail | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const token = await AsyncStorage.getItem("auth_token");
    const res = await fetch(`https://${domain}/api/payouts/job/${id}`, {
      headers: token ? { Authorization: `Bearer ${token}` } as Record<string, string> : {},
    });
    setData(await res.json());
  }, [domain, id]);
  useEffect(() => { void load(); }, [load]);

  async function retry() {
    setBusy(true);
    setMsg(null);
    try {
      const token = await AsyncStorage.getItem("auth_token");
      const res = await fetch(`https://${domain}/api/payouts/${id}/retry`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } as Record<string, string> : {},
      });
      const json = await res.json();
      setMsg(json.ok ? "Capture retried successfully." : `Retry: ${json.reason ?? "failed"}`);
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return <View style={[styles.center, { backgroundColor: colors.background }]}><ActivityIndicator color={colors.primary} /></View>;
  }

  const { payment, confirmation, tips, events } = data;
  const canRetry = payment?.status === "payout_failed";

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={{ padding: 16, paddingBottom: 100 }}>
      <Stack.Screen options={{ title: `Payout — Job #${id}` }} />

      {payment ? (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>Your payout</Text>
          <Text style={{ color: colors.foreground, fontSize: 28, fontWeight: "800" }}>${payment.mechanicPayout.toFixed(2)}</Text>
          <Text style={{ color: colors.mutedForeground, fontSize: 12, marginTop: 4 }}>
            Total ${payment.amount.toFixed(2)} · APS fee ${payment.platformFee.toFixed(2)}
          </Text>
          <View style={[styles.statusPill, { backgroundColor: pillColor(payment.status) + "22" }]}>
            <Text style={{ color: pillColor(payment.status), fontWeight: "600", textTransform: "capitalize" }}>
              {payment.status.replace(/_/g, " ")}
            </Text>
          </View>
          {payment.captureBlockedReason && (
            <Text style={{ color: "#dc2626", marginTop: 8 }}>Blocked: {payment.captureBlockedReason}</Text>
          )}
          {payment.failureReason && (
            <Text style={{ color: "#dc2626", marginTop: 4, fontSize: 12 }}>{payment.failureReason}</Text>
          )}
          {canRetry && (
            <Pressable disabled={busy} onPress={() => void retry()}
              style={[styles.btn, { backgroundColor: colors.primary, marginTop: 12, opacity: busy ? 0.7 : 1 }]}>
              <Feather name="refresh-cw" size={16} color="white" />
              <Text style={styles.btnText}>Retry payout</Text>
            </Pressable>
          )}
          {msg && <Text style={{ color: colors.foreground, marginTop: 8 }}>{msg}</Text>}
        </View>
      ) : (
        <Text style={{ color: colors.mutedForeground }}>No payment recorded for this job.</Text>
      )}

      {confirmation && (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, marginTop: 12 }]}>
          <Text style={[styles.h2, { color: colors.foreground }]}>Customer confirmation</Text>
          <Text style={{ color: colors.mutedForeground, marginTop: 4, textTransform: "capitalize" }}>{confirmation.status.replace(/_/g, " ")}</Text>
          {confirmation.disputeReason && (
            <Text style={{ color: "#dc2626", marginTop: 6 }}>“{confirmation.disputeReason}”</Text>
          )}
        </View>
      )}

      {tips.length > 0 && (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, marginTop: 12 }]}>
          <Text style={[styles.h2, { color: colors.foreground }]}>Tips</Text>
          {tips.map((t) => (
            <View key={t.id} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 }}>
              <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{new Date(t.createdAt).toLocaleDateString()} · {t.status}</Text>
              <Text style={{ color: colors.foreground, fontWeight: "600" }}>${(t.mechanicAmountCents / 100).toFixed(2)}</Text>
            </View>
          ))}
        </View>
      )}

      <Text style={[styles.h2, { color: colors.foreground, marginTop: 20 }]}>Timeline</Text>
      {events.length === 0 ? (
        <Text style={{ color: colors.mutedForeground }}>No events yet.</Text>
      ) : events.map((e) => (
        <View key={e.id} style={[styles.eventRow, { borderColor: colors.border }]}>
          <Feather
            name={e.kind === "payout_paid" ? "check-circle" : e.kind.includes("failed") ? "alert-circle" : "activity"}
            size={16}
            color={e.kind === "payout_paid" ? "#16a34a" : e.kind.includes("failed") ? "#dc2626" : colors.mutedForeground}
          />
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.foreground, fontSize: 13 }}>{e.kind.replace(/_/g, " ")}</Text>
            {e.failureMessage && <Text style={{ color: "#dc2626", fontSize: 12 }}>{e.failureMessage}</Text>}
            <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>{new Date(e.createdAt).toLocaleString()}</Text>
          </View>
          {e.amountCents != null && (
            <Text style={{ color: colors.foreground, fontWeight: "600" }}>${(e.amountCents / 100).toFixed(2)}</Text>
          )}
        </View>
      ))}
    </ScrollView>
  );
}

function pillColor(status: string): string {
  switch (status) {
    case "captured":
    case "released": return "#16a34a";
    case "payout_failed":
    case "disputed": return "#dc2626";
    case "capture_pending":
    case "authorized": return "#f59e0b";
    default: return "#6b7280";
  }
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  card: { borderRadius: 12, borderWidth: 1, padding: 16 },
  h2: { fontSize: 16, fontWeight: "700" },
  statusPill: { alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, marginTop: 10 },
  btn: { padding: 12, borderRadius: 8, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  btnText: { color: "white", fontWeight: "600", fontSize: 14 },
  eventRow: { padding: 12, borderBottomWidth: 1, flexDirection: "row", alignItems: "center", gap: 12 },
});
