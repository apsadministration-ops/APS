/**
 * Customer tip screen. Tips are a SEPARATE Stripe Checkout — 100% to the
 * mechanic by default. Available after the job is COMPLETED or PAID.
 */

import { useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, TextInput, Linking } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useColors } from "@/hooks/useColors";
import { getApiUrl } from "@/lib/apiConfig";

const PRESETS = [5, 10, 20, 40];

export default function TipScreen() {
  const colors = useColors();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const jobId = Number(id);
  const [amount, setAmount] = useState<number>(10);
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    if (busy) return;
    const cents = Math.round((Number(custom) || amount) * 100);
    if (cents < 100 || cents > 50000) {
      setError("Tip must be between $1 and $500.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const token = await AsyncStorage.getItem("auth_token");
      const res = await fetch(getApiUrl(`/tips/jobs/${jobId}`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } as Record<string, string> : {}),
        },
        body: JSON.stringify({ amountCents: cents }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Could not start tip.");
        setBusy(false);
        return;
      }
      if (!json.url) {
        setError("Could not start the tip checkout. Please try again.");
        setBusy(false);
        return;
      }
      await Linking.openURL(json.url);
      router.back();
    } catch {
      setError("Network error.");
      setBusy(false);
    }
  }

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={{ padding: 20, paddingBottom: 80 }}>
      <Stack.Screen options={{ title: "Send a tip" }} />
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.h1, { color: colors.foreground }]}>Tip your mechanic</Text>
        <Text style={[styles.body, { color: colors.mutedForeground }]}>100% goes to your mechanic.</Text>

        <View style={styles.presets}>
          {PRESETS.map((p) => {
            const active = amount === p && !custom;
            return (
              <Pressable
                key={p}
                onPress={() => { setAmount(p); setCustom(""); }}
                style={[
                  styles.preset,
                  { backgroundColor: active ? colors.primary : colors.secondary, borderColor: colors.border },
                ]}
              >
                <Text style={{ color: active ? "white" : colors.foreground, fontWeight: "600", fontSize: 18 }}>${p}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={{ color: colors.mutedForeground, marginTop: 16, marginBottom: 6 }}>Custom amount</Text>
        <TextInput
          value={custom}
          onChangeText={(t) => { setCustom(t.replace(/[^0-9.]/g, "")); }}
          placeholder="$ amount"
          keyboardType="decimal-pad"
          placeholderTextColor={colors.mutedForeground}
          style={{
            padding: 12, color: colors.foreground, fontSize: 16,
            backgroundColor: colors.secondary, borderRadius: 8,
          }}
        />
      </View>

      {error && <Text style={{ color: "#dc2626", marginTop: 12 }}>{error}</Text>}

      <Pressable
        disabled={busy}
        onPress={() => void send()}
        style={[styles.btn, { backgroundColor: colors.primary, marginTop: 20, opacity: busy ? 0.7 : 1 }]}
      >
        {busy ? <ActivityIndicator color="white" /> : (
          <>
            <Feather name="heart" size={20} color="white" />
            <Text style={styles.btnText}>Send tip</Text>
          </>
        )}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, borderWidth: 1, padding: 16 },
  h1: { fontSize: 20, fontWeight: "700", marginBottom: 4 },
  body: { fontSize: 14, lineHeight: 20 },
  presets: { flexDirection: "row", gap: 10, marginTop: 16, flexWrap: "wrap" },
  preset: { flex: 1, minWidth: 70, padding: 14, borderRadius: 10, borderWidth: 1, alignItems: "center" },
  btn: { padding: 14, borderRadius: 10, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  btnText: { color: "white", fontWeight: "600", fontSize: 15 },
});
