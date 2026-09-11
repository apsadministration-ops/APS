/**
 * Customer approval screen — shown when a job is in PENDING_APPROVAL.
 *
 * Surfaces the assigned mechanic's full reputation snapshot (trust score,
 * categories, badges, completion rate) and gives the customer 60 seconds to
 * approve or decline. The countdown is driven by the server's
 * `secondsRemaining` so we never show a clock that disagrees with the
 * server's expiry. If the user does nothing, polling will pick up the
 * server-side auto_approved flip and we route to the live job view.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useColors } from "@/hooks/useColors";
import { confirm } from "@/utils/confirm";
import { getApiUrl } from "@/lib/apiConfig";

interface ApprovalDto {
  id: number;
  jobId: number;
  status: "pending" | "approved" | "declined" | "auto_approved" | "expired";
  expiresAt: string;
  secondsRemaining: number;
  mechanic: null | {
    id: number;
    name: string;
    avatarUrl: string | null;
    mechanicTier: string | null;
    overallAvg: number;
    reviewCount: number;
    categoriesAvg: Record<string, number>;
    trustScore: number;
    completionRate: number;
    repeatCustomerRate: number;
    badges: string[];
  };
}

const CATEGORY_LABELS: Record<string, string> = {
  professionalism: "Professionalism",
  communication: "Communication",
  punctuality: "Punctuality",
  cleanliness: "Cleanliness",
  workmanship: "Workmanship",
  efficiency: "Efficiency",
  honesty: "Honesty",
  vehicleCare: "Vehicle Care",
};

const BADGE_LABELS: Record<string, string> = {
  top_rated: "Top Rated",
  trusted_mechanic: "Trusted Mechanic",
  high_completion: "High Completion",
  highly_recommended: "Highly Recommended",
  master_technician: "Master Technician",
};

export default function ApproveMechanicScreen() {
  const colors = useColors();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const jobId = Number(id);

  const [approval, setApproval] = useState<ApprovalDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState<number>(60);
  const [declineReason, setDeclineReason] = useState("");
  const [showDecline, setShowDecline] = useState(false);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchApproval = useCallback(async () => {
    try {
      const token = await AsyncStorage.getItem("auth_token");
      const res = await fetch(getApiUrl(`/approvals/job/${jobId}`), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const data = (await res.json()) as ApprovalDto;
        setApproval(data);
        setSecondsLeft(data.secondsRemaining);
        // If the server has already finalized this approval, leave the screen.
        if (data.status !== "pending") {
          // Approved / auto_approved → live job. Declined → home.
          router.replace(data.status === "declined" ? "/(customer)" : `/job/${jobId}`);
        }
      }
    } catch { /* non-fatal — keep last good state */ }
    finally { setLoading(false); }
  }, [jobId, router]);

  useEffect(() => { fetchApproval(); }, [fetchApproval]);

  // 1Hz local countdown; refetch from server every 10s as a heartbeat so we
  // notice if the server auto-approved (or someone moved the job).
  useEffect(() => {
    tickRef.current = setInterval(() => {
      setSecondsLeft((s) => Math.max(0, s - 1));
    }, 1000);
    const heartbeat = setInterval(() => { fetchApproval(); }, 10000);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
      clearInterval(heartbeat);
    };
  }, [fetchApproval]);

  // When local countdown hits 0, immediately refetch — the server will have
  // (or be about to) auto-approve and we want to follow through.
  useEffect(() => {
    if (secondsLeft === 0) {
      fetchApproval();
    }
  }, [secondsLeft, fetchApproval]);

  const submit = async (decision: "approve" | "decline") => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const token = await AsyncStorage.getItem("auth_token");
      const url = getApiUrl(`/approvals/${jobId}/${decision}`);
      const body = decision === "decline" ? JSON.stringify({ reason: declineReason }) : undefined;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        await confirm({ title: "Couldn't submit", message: err.error ?? "Please try again.", confirmText: "OK" });
        return;
      }
      router.replace(decision === "approve" ? `/job/${jobId}` : "/(customer)");
    } catch {
      await confirm({
        title: "Couldn't submit",
        message: "We couldn't reach the server. Please try again.",
        confirmText: "OK",
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || !approval) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }
  const m = approval.mechanic;
  if (!m) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.mutedForeground }}>Mechanic data unavailable.</Text>
      </View>
    );
  }
  const stars = "★".repeat(Math.round(m.overallAvg)) + "☆".repeat(5 - Math.round(m.overallAvg));

  return (
    <>
      <Stack.Screen options={{
        title: "Approve Mechanic",
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.foreground,
      }} />
      <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={{ padding: 16, paddingBottom: 140, gap: 14 }}>
        {/* Countdown */}
        <View style={[styles.timerCard, { backgroundColor: secondsLeft <= 10 ? colors.destructive + "22" : colors.primary + "16", borderColor: secondsLeft <= 10 ? colors.destructive : colors.primary }]}>
          <Feather name="clock" size={22} color={secondsLeft <= 10 ? colors.destructive : colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.timerLabel, { color: colors.foreground }]}>You have {secondsLeft}s to respond</Text>
            <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>If you do nothing, this mechanic is auto-approved.</Text>
          </View>
        </View>

        {/* Mechanic header */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.row}>
            <View style={[styles.avatar, { backgroundColor: colors.muted }]}>
              {m.avatarUrl
                ? <Text>{/* image placeholder — wire when avatar uploads land */}</Text>
                : <Feather name="user" size={32} color={colors.mutedForeground} />}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.name, { color: colors.foreground }]}>{m.name}</Text>
              <Text style={{ color: colors.mutedForeground, textTransform: "capitalize" }}>
                {m.mechanicTier ?? "Mechanic"}
              </Text>
              <Text style={[styles.stars, { color: colors.primary }]}>
                {stars} <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>{m.overallAvg.toFixed(1)} ({m.reviewCount})</Text>
              </Text>
            </View>
          </View>

          {/* Trust score */}
          <View style={styles.trustRow}>
            <TrustChip color={colors.primary} label="Trust Score" value={String(m.trustScore)} />
            <TrustChip color={colors.primary} label="Completion" value={`${Math.round(m.completionRate * 100)}%`} />
            <TrustChip color={colors.primary} label="Repeat" value={`${Math.round(m.repeatCustomerRate * 100)}%`} />
          </View>
        </View>

        {/* Badges */}
        {m.badges.length > 0 && (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.section, { color: colors.foreground }]}>Verified Badges</Text>
            <View style={styles.badgeWrap}>
              {m.badges.map((b) => (
                <View key={b} style={[styles.badge, { backgroundColor: colors.accent }]}>
                  <Feather name="check-circle" size={14} color={colors.accentForeground} />
                  <Text style={[styles.badgeText, { color: colors.accentForeground }]}>{BADGE_LABELS[b] ?? b}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Category averages */}
        {Object.keys(m.categoriesAvg).length > 0 && (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.section, { color: colors.foreground }]}>Category Ratings</Text>
            {Object.entries(m.categoriesAvg).map(([k, v]) => (
              <View key={k} style={styles.catRow}>
                <Text style={{ color: colors.foreground, flex: 1 }}>{CATEGORY_LABELS[k] ?? k}</Text>
                <View style={[styles.catBarBg, { backgroundColor: colors.muted }]}>
                  <View style={[styles.catBarFill, { backgroundColor: colors.primary, width: `${(v / 5) * 100}%` }]} />
                </View>
                <Text style={{ color: colors.mutedForeground, width: 36, textAlign: "right" }}>{v.toFixed(1)}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Decline reason input (optional) */}
        {showDecline && (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.section, { color: colors.foreground }]}>Tell us why (optional)</Text>
            <TextInput
              value={declineReason}
              onChangeText={setDeclineReason}
              placeholder="e.g. Too far away, prefer different specialty…"
              placeholderTextColor={colors.mutedForeground}
              multiline
              style={[styles.input, { borderColor: colors.border, color: colors.foreground }]}
            />
          </View>
        )}

        {/* Actions */}
        <View style={{ gap: 10, marginTop: 8 }}>
          {!showDecline && (
            <Pressable
              onPress={() => submit("approve")}
              disabled={submitting}
              style={[styles.primaryBtn, { backgroundColor: colors.primary, opacity: submitting ? 0.6 : 1 }]}
            >
              <Feather name="check" size={18} color={colors.primaryForeground} />
              <Text style={[styles.primaryBtnText, { color: colors.primaryForeground }]}>Approve Mechanic</Text>
            </Pressable>
          )}
          {showDecline ? (
            <>
              <Pressable
                onPress={() => submit("decline")}
                disabled={submitting}
                style={[styles.primaryBtn, { backgroundColor: colors.destructive, opacity: submitting ? 0.6 : 1 }]}
              >
                <Text style={[styles.primaryBtnText, { color: colors.destructiveForeground }]}>Confirm Decline</Text>
              </Pressable>
              <Pressable onPress={() => setShowDecline(false)} style={[styles.secondaryBtn, { borderColor: colors.border }]}>
                <Text style={{ color: colors.foreground, fontWeight: "600" }}>Back</Text>
              </Pressable>
            </>
          ) : (
            <Pressable onPress={() => setShowDecline(true)} style={[styles.secondaryBtn, { borderColor: colors.border }]}>
              <Text style={{ color: colors.destructive, fontWeight: "600" }}>Decline & Reassign</Text>
            </Pressable>
          )}
        </View>
      </ScrollView>
    </>
  );
}

function TrustChip({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <View style={[styles.chip, { backgroundColor: color + "18", borderColor: color + "55" }]}>
      <Text style={[styles.chipValue, { color }]}>{value}</Text>
      <Text style={[styles.chipLabel, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  timerCard: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 14, borderWidth: 1 },
  timerLabel: { fontWeight: "700", fontSize: 15 },
  card: { padding: 16, borderRadius: 14, borderWidth: 1, gap: 10 },
  row: { flexDirection: "row", gap: 14, alignItems: "center" },
  avatar: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center" },
  name: { fontSize: 18, fontWeight: "700" },
  stars: { fontSize: 16, marginTop: 2 },
  trustRow: { flexDirection: "row", gap: 8, marginTop: 6 },
  chip: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center", borderWidth: 1 },
  chipValue: { fontSize: 18, fontWeight: "800" },
  chipLabel: { fontSize: 11, fontWeight: "600", marginTop: 2, textTransform: "uppercase", letterSpacing: 0.5 },
  section: { fontSize: 14, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 },
  badgeWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  badge: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999 },
  badgeText: { fontSize: 12, fontWeight: "700" },
  catRow: { flexDirection: "row", alignItems: "center", gap: 10, marginVertical: 4 },
  catBarBg: { flex: 2, height: 8, borderRadius: 4, overflow: "hidden" },
  catBarFill: { height: "100%" },
  input: { borderWidth: 1, borderRadius: 10, padding: 12, minHeight: 80, textAlignVertical: "top" },
  primaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 14, borderRadius: 12 },
  primaryBtnText: { fontSize: 16, fontWeight: "700" },
  secondaryBtn: { padding: 14, borderRadius: 12, borderWidth: 1, alignItems: "center" },
});
