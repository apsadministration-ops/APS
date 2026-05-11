/**
 * Customer 24h work-confirmation screen. Customer can confirm the completed
 * work (immediate capture + payout) or open a dispute (freezes the payment).
 *
 * Server is the source of truth for the countdown — we display
 * `secondsRemaining` rather than recomputing locally so the timer can never
 * disagree with the sweep.
 */

import { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, TextInput } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useColors } from "@/hooks/useColors";

interface ConfirmDto {
  id: number;
  jobId: number;
  status: "pending" | "confirmed" | "auto_confirmed" | "disputed";
  expiresAt: string;
  secondsRemaining: number;
  payment: { amount: number; mechanicPayout: number; status: string; captureBlockedReason: string | null } | null;
}

export default function ConfirmWorkScreen() {
  const colors = useColors();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const jobId = Number(id);
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  const [data, setData] = useState<ConfirmDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [showDispute, setShowDispute] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const token = await AsyncStorage.getItem("auth_token");
      const res = await fetch(`https://${domain}/api/work-confirmations/job/${jobId}`, {
        headers: token ? { Authorization: `Bearer ${token}` } as Record<string, string> : {},
      });
      if (!res.ok) {
        setError(res.status === 404 ? "No pending work to confirm." : "Could not load.");
        setLoading(false);
        return;
      }
      const json: ConfirmDto = await res.json();
      setData(json);
      setSeconds(json.secondsRemaining);
      setLoading(false);
    } catch {
      setError("Network error.");
      setLoading(false);
    }
  }, [domain, jobId]);

  useEffect(() => { void load(); }, [load]);
  // 12s server resync.
  useEffect(() => {
    if (!data || data.status !== "pending") return;
    const t = setInterval(() => { void load(); }, 12000);
    return () => clearInterval(t);
  }, [data, load]);
  // 1s local tick.
  useEffect(() => {
    if (!data || data.status !== "pending") return;
    const t = setInterval(() => setSeconds((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [data]);

  async function act(path: "confirm" | "dispute") {
    if (busy) return;
    if (path === "dispute" && reason.trim().length < 10) {
      setError("Please share at least 10 characters describing the issue.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const token = await AsyncStorage.getItem("auth_token");
      const res = await fetch(`https://${domain}/api/work-confirmations/${jobId}/${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } as Record<string, string> : {}),
        },
        body: path === "dispute" ? JSON.stringify({ reason: reason.trim() }) : "{}",
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Could not submit.");
        setBusy(false);
        return;
      }
      router.replace(`/job/${jobId}`);
    } catch {
      setError("Network error.");
      setBusy(false);
    }
  }

  const fmt = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m ${ss}s`;
  };

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!data) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background, padding: 24 }]}>
        <Stack.Screen options={{ title: "Confirm work" }} />
        <Text style={{ color: colors.foreground, fontSize: 16, textAlign: "center" }}>{error ?? "Nothing to confirm."}</Text>
      </View>
    );
  }

  const done = data.status !== "pending";

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={{ padding: 20, paddingBottom: 80 }}>
      <Stack.Screen options={{ title: "Confirm work" }} />

      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.h1, { color: colors.foreground }]}>Approve your completed work</Text>
        <Text style={[styles.body, { color: colors.mutedForeground }]}>
          Your funds release to the mechanic when you confirm — or automatically in {fmt(seconds)}. If something is wrong, open a dispute and we'll freeze the payment for review.
        </Text>
        {!done && (
          <View style={[styles.timer, { backgroundColor: colors.secondary }]}>
            <Feather name="clock" size={20} color={colors.primary} />
            <Text style={[styles.timerText, { color: colors.foreground }]}>{fmt(seconds)} left</Text>
          </View>
        )}
        {data.payment && (
          <View style={{ marginTop: 16 }}>
            <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>Job total</Text>
            <Text style={{ color: colors.foreground, fontSize: 22, fontWeight: "700" }}>${data.payment.amount.toFixed(2)}</Text>
            <Text style={{ color: colors.mutedForeground, fontSize: 12, marginTop: 4 }}>
              ${data.payment.mechanicPayout.toFixed(2)} goes to your mechanic.
            </Text>
          </View>
        )}
      </View>

      {error && (
        <Text style={{ color: "#dc2626", marginTop: 12 }}>{error}</Text>
      )}

      {done ? (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, marginTop: 16 }]}>
          <Text style={{ color: colors.foreground, fontWeight: "600" }}>
            {data.status === "confirmed" ? "Confirmed — payment is on the way." :
             data.status === "auto_confirmed" ? "Auto-confirmed after 24h. Payment is on the way." :
             "Disputed — our team will review."}
          </Text>
        </View>
      ) : !showDispute ? (
        <View style={{ marginTop: 16, gap: 12 }}>
          <Pressable
            disabled={busy}
            onPress={() => void act("confirm")}
            style={[styles.btn, { backgroundColor: colors.primary, opacity: busy ? 0.7 : 1 }]}
          >
            <Feather name="check" size={20} color="white" />
            <Text style={styles.btnText}>Confirm — release funds now</Text>
          </Pressable>
          <Pressable
            disabled={busy}
            onPress={() => setShowDispute(true)}
            style={[styles.btn, { backgroundColor: colors.secondary, borderColor: colors.border, borderWidth: 1 }]}
          >
            <Feather name="alert-circle" size={20} color={colors.foreground} />
            <Text style={[styles.btnText, { color: colors.foreground }]}>Open a dispute instead</Text>
          </Pressable>
        </View>
      ) : (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, marginTop: 16 }]}>
          <Text style={{ color: colors.foreground, fontWeight: "600", marginBottom: 8 }}>What's wrong?</Text>
          <TextInput
            multiline
            value={reason}
            onChangeText={setReason}
            placeholder="Describe the issue (10+ chars)…"
            placeholderTextColor={colors.mutedForeground}
            style={{
              minHeight: 100, padding: 12, color: colors.foreground,
              backgroundColor: colors.secondary, borderRadius: 8, textAlignVertical: "top",
            }}
          />
          <View style={{ flexDirection: "row", gap: 12, marginTop: 12 }}>
            <Pressable
              onPress={() => { setShowDispute(false); setReason(""); }}
              style={[styles.btn, { backgroundColor: colors.secondary, flex: 1 }]}
            >
              <Text style={[styles.btnText, { color: colors.foreground }]}>Cancel</Text>
            </Pressable>
            <Pressable
              disabled={busy}
              onPress={() => void act("dispute")}
              style={[styles.btn, { backgroundColor: "#dc2626", flex: 1, opacity: busy ? 0.7 : 1 }]}
            >
              <Text style={styles.btnText}>Submit dispute</Text>
            </Pressable>
          </View>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  card: { borderRadius: 12, borderWidth: 1, padding: 16 },
  h1: { fontSize: 20, fontWeight: "700", marginBottom: 8 },
  body: { fontSize: 14, lineHeight: 20 },
  timer: { marginTop: 16, padding: 12, borderRadius: 8, flexDirection: "row", alignItems: "center", gap: 8 },
  timerText: { fontSize: 16, fontWeight: "600" },
  btn: { padding: 14, borderRadius: 10, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  btnText: { color: "white", fontWeight: "600", fontSize: 15 },
});
