/**
 * Review submission screen.
 *
 * Renders the appropriate 8 categories for the caller's role (customer rates
 * mechanic, mechanic rates customer), an overall star rating, optional text,
 * and posts to /api/reviews. After submit the review enters the visibility
 * lock — the screen explains this so users aren't surprised when their words
 * don't appear immediately.
 */

import { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { confirm } from "@/utils/confirm";

const CATEGORIES_CUSTOMER = [
  ["professionalism", "Professionalism"],
  ["communication", "Communication"],
  ["punctuality", "Punctuality"],
  ["cleanliness", "Cleanliness"],
  ["workmanship", "Workmanship"],
  ["efficiency", "Efficiency"],
  ["honesty", "Honesty"],
  ["vehicleCare", "Vehicle Care"],
] as const;

const CATEGORIES_MECHANIC = [
  ["communication", "Communication"],
  ["punctuality", "Punctuality"],
  ["safety", "Safety"],
  ["professionalism", "Professionalism"],
  ["paymentReliability", "Payment Reliability"],
  ["accuracyOfDescription", "Accuracy of Description"],
  ["vehicleAccessibility", "Vehicle Accessibility"],
  ["cooperation", "Cooperation"],
] as const;

export default function SubmitReviewScreen() {
  const colors = useColors();
  const router = useRouter();
  const { user } = useAuth();
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const numericJobId = Number(jobId);
  const domain = process.env.EXPO_PUBLIC_DOMAIN;

  const isCustomer = user?.role === "customer";
  const cats = isCustomer ? CATEGORIES_CUSTOMER : CATEGORIES_MECHANIC;

  const [overall, setOverall] = useState<number>(0);
  const [categoryRatings, setCategoryRatings] = useState<Record<string, number>>({});
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (overall < 1) {
      await confirm({ title: "Add an overall rating", message: "Tap a star from 1 to 5.", confirmText: "OK" });
      return;
    }
    setSubmitting(true);
    try {
      const token = await AsyncStorage.getItem("auth_token");
      const res = await fetch(`https://${domain}/api/reviews`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: numericJobId,
          overallRating: overall,
          categories: categoryRatings,
          text: text.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        await confirm({ title: "Couldn't submit", message: err.error ?? "Please try again.", confirmText: "OK" });
        return;
      }
      await confirm({
        title: "Review submitted",
        message: "Your review will become visible once the other party reviews you, or after 72 hours — whichever comes first. This protects everyone from retaliation.",
        confirmText: "Got it",
      });
      router.back();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{
        title: "Leave a Review",
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.foreground,
      }} />
      <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={{ padding: 16, paddingBottom: 140, gap: 14 }}>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.section, { color: colors.foreground }]}>Overall</Text>
          <Stars value={overall} onChange={setOverall} color={colors.primary} mutedColor={colors.mutedForeground} size={36} />
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.section, { color: colors.foreground }]}>Rate each area</Text>
          {cats.map(([key, label]) => (
            <View key={key} style={styles.catRow}>
              <Text style={{ color: colors.foreground, flex: 1 }}>{label}</Text>
              <Stars
                value={categoryRatings[key] ?? 0}
                onChange={(v) => setCategoryRatings((s) => ({ ...s, [key]: v }))}
                color={colors.primary}
                mutedColor={colors.mutedForeground}
                size={22}
              />
            </View>
          ))}
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.section, { color: colors.foreground }]}>Tell us more (optional)</Text>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={isCustomer
              ? "What stood out about this mechanic? Anything we should know?"
              : "How was your experience with this customer?"}
            placeholderTextColor={colors.mutedForeground}
            multiline
            style={[styles.input, { borderColor: colors.border, color: colors.foreground }]}
            maxLength={4000}
          />
        </View>

        <View style={[styles.notice, { backgroundColor: colors.muted }]}>
          <Feather name="lock" size={14} color={colors.mutedForeground} />
          <Text style={{ color: colors.mutedForeground, flex: 1, fontSize: 12 }}>
            Hidden until both parties review or 72 hours pass — prevents retaliation.
          </Text>
        </View>

        <Pressable
          onPress={submit}
          disabled={submitting}
          style={[styles.primaryBtn, { backgroundColor: colors.primary, opacity: submitting ? 0.6 : 1 }]}
        >
          {submitting
            ? <ActivityIndicator color={colors.primaryForeground} />
            : <Text style={[styles.primaryBtnText, { color: colors.primaryForeground }]}>Submit Review</Text>}
        </Pressable>
      </ScrollView>
    </>
  );
}

function Stars({ value, onChange, color, mutedColor, size }: {
  value: number; onChange: (v: number) => void; color: string; mutedColor: string; size: number;
}) {
  return (
    <View style={{ flexDirection: "row", gap: 4 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Pressable key={n} onPress={() => onChange(n)} hitSlop={6}>
          <Feather name="star" size={size} color={n <= value ? color : mutedColor} style={{ opacity: n <= value ? 1 : 0.45 }} />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 16, borderRadius: 14, borderWidth: 1, gap: 10 },
  section: { fontSize: 14, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  catRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginVertical: 4 },
  input: { borderWidth: 1, borderRadius: 10, padding: 12, minHeight: 100, textAlignVertical: "top" },
  notice: { flexDirection: "row", gap: 8, alignItems: "center", padding: 10, borderRadius: 10 },
  primaryBtn: { padding: 14, borderRadius: 12, alignItems: "center", marginTop: 6 },
  primaryBtnText: { fontSize: 16, fontWeight: "700" },
});
