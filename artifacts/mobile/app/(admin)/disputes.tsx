/**
 * Admin disputes dashboard. Lists open + recent disputes (both customer-
 * filed and Stripe chargebacks) and lets admins resolve internal disputes
 * (customer_filed). Stripe chargeback outcomes are owned by Stripe — the UI
 * still lets admins mark them under_review for triage tracking.
 */

import { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl, TextInput } from "react-native";
import { Stack } from "expo-router";
import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useColors } from "@/hooks/useColors";
import { getApiUrl } from "@/lib/apiConfig";

interface Dispute {
  id: number; jobId: number; customerId: number; mechanicId: number | null;
  kind: "customer_filed" | "stripe_chargeback";
  status: "open" | "under_review" | "resolved_customer" | "resolved_mechanic" | "canceled";
  reason: string | null; customerNotes: string | null; resolutionNotes: string | null;
  amountCents: number | null; createdAt: string;
}

export default function DisputesScreen() {
  const colors = useColors();
  const [rows, setRows] = useState<Dispute[]>([]);
  const [filter, setFilter] = useState<"all" | "open" | "under_review">("open");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState<Dispute | null>(null);
  const [notes, setNotes] = useState("");
  const [outcome, setOutcome] = useState<"resolved_customer" | "resolved_mechanic" | "canceled" | "under_review">("under_review");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const token = await AsyncStorage.getItem("auth_token");
      const q = filter === "all" ? "" : `?status=${filter}`;
    const res = await fetch(getApiUrl(`/disputes${q}`), {
        headers: token ? { Authorization: `Bearer ${token}` } as Record<string, string> : {},
      });
      setRows(await res.json());
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filter]);
  useEffect(() => { setLoading(true); void load(); }, [load]);

  async function resolve() {
    if (!editing || busy) return;
    setBusy(true);
    try {
      const token = await AsyncStorage.getItem("auth_token");
      await fetch(getApiUrl(`/admin/disputes/${editing.id}/resolve`), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } as Record<string, string> : {}) },
        body: JSON.stringify({ outcome, notes }),
      });
      setEditing(null);
      setNotes("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <View style={[styles.center, { backgroundColor: colors.background }]}><ActivityIndicator color={colors.primary} /></View>;

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} />}>
      <Stack.Screen options={{ title: "Disputes" }} />

      <View style={styles.filterRow}>
        {(["open", "under_review", "all"] as const).map((f) => (
          <Pressable key={f} onPress={() => setFilter(f)}
            style={[styles.fBtn, { backgroundColor: filter === f ? colors.primary : colors.secondary }]}>
            <Text style={{ color: filter === f ? "white" : colors.foreground, textTransform: "capitalize" }}>{f.replace(/_/g, " ")}</Text>
          </Pressable>
        ))}
      </View>

      {rows.length === 0 && <Text style={{ color: colors.mutedForeground, marginTop: 12 }}>No disputes match.</Text>}

      {rows.map((d) => (
        <Pressable key={d.id} onPress={() => { setEditing(d); setNotes(d.resolutionNotes ?? ""); setOutcome("under_review"); }}
          style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={{ color: colors.foreground, fontWeight: "700" }}>Job #{d.jobId} · {d.kind === "stripe_chargeback" ? "Chargeback" : "Customer dispute"}</Text>
            <Text style={{ color: pillColor(d.status), fontWeight: "600", textTransform: "capitalize" }}>{d.status.replace(/_/g, " ")}</Text>
          </View>
          <Text style={{ color: colors.mutedForeground, fontSize: 12, marginTop: 4 }}>
            {new Date(d.createdAt).toLocaleString()}{d.amountCents != null ? ` · $${(d.amountCents / 100).toFixed(2)}` : ""}
          </Text>
          {d.reason && <Text style={{ color: colors.foreground, marginTop: 8 }}>{d.reason}</Text>}
          {d.customerNotes && <Text style={{ color: colors.mutedForeground, fontSize: 13, marginTop: 4 }}>“{d.customerNotes}”</Text>}
        </Pressable>
      ))}

      {editing && (
        <View style={[styles.modal, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={{ color: colors.foreground, fontWeight: "700", fontSize: 16 }}>Resolve dispute #{editing.id}</Text>
          <Text style={{ color: colors.mutedForeground, marginTop: 4 }}>
            {editing.kind === "stripe_chargeback"
              ? "Stripe owns the final outcome — you can mark this for internal triage only."
              : "Choose an outcome. Resolving in the mechanic's favor will unblock the payout."}
          </Text>
          <View style={{ marginTop: 12, gap: 8 }}>
            {(editing.kind === "stripe_chargeback"
              ? ["under_review"] as const
              : ["resolved_mechanic", "resolved_customer", "under_review", "canceled"] as const
            ).map((o) => (
              <Pressable key={o} onPress={() => setOutcome(o)}
                style={[styles.outcomeBtn, { backgroundColor: outcome === o ? colors.primary : colors.secondary }]}>
                <Text style={{ color: outcome === o ? "white" : colors.foreground, textTransform: "capitalize" }}>{o.replace(/_/g, " ")}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput multiline value={notes} onChangeText={setNotes} placeholder="Resolution notes (optional)"
            placeholderTextColor={colors.mutedForeground}
            style={{ minHeight: 80, padding: 10, marginTop: 12, color: colors.foreground, backgroundColor: colors.secondary, borderRadius: 8, textAlignVertical: "top" }} />
          <View style={{ flexDirection: "row", gap: 12, marginTop: 12 }}>
            <Pressable onPress={() => { setEditing(null); setNotes(""); }} style={[styles.btn, { backgroundColor: colors.secondary, flex: 1 }]}>
              <Text style={{ color: colors.foreground, fontWeight: "600" }}>Cancel</Text>
            </Pressable>
            <Pressable disabled={busy} onPress={() => void resolve()} style={[styles.btn, { backgroundColor: colors.primary, flex: 1, opacity: busy ? 0.7 : 1 }]}>
              <Feather name="check" size={16} color="white" />
              <Text style={{ color: "white", fontWeight: "600" }}>Save</Text>
            </Pressable>
          </View>
        </View>
      )}
    </ScrollView>
  );
}

function pillColor(s: string): string {
  if (s === "open") return "#dc2626";
  if (s === "under_review") return "#f59e0b";
  if (s === "resolved_mechanic") return "#16a34a";
  if (s === "resolved_customer") return "#3b82f6";
  return "#6b7280";
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  filterRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  fBtn: { flex: 1, padding: 10, borderRadius: 8, alignItems: "center" },
  card: { borderRadius: 10, borderWidth: 1, padding: 14, marginBottom: 10 },
  modal: { borderRadius: 12, borderWidth: 1, padding: 16, marginTop: 16 },
  outcomeBtn: { padding: 10, borderRadius: 8, alignItems: "center" },
  btn: { padding: 12, borderRadius: 8, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 },
});
