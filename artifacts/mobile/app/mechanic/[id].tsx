import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput } from "react-native";
import { alertMessage, confirm } from "@/utils/confirm";
import { useColors } from "@/hooks/useColors";
import { Feather } from "@expo/vector-icons";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import {
  useListMechanics, useGetMechanicReviews, useAddFavorite, useRemoveFavorite, useCreateFlag,
  getListMechanicsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

const FLAG_TYPES = [
  { value: "rude", label: "Rude / unprofessional" },
  { value: "no_show", label: "No-show" },
  { value: "unsafe", label: "Unsafe work" },
  { value: "scam", label: "Scam / overcharge" },
  { value: "other", label: "Other" },
] as const;

export default function MechanicDetailScreen() {
  const colors = useColors();
  const router = useRouter();
  const qc = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const mechId = parseInt(id, 10);

  const { data: mechanics } = useListMechanics();
  const mech = mechanics?.find((m) => m.id === mechId);
  const { data: reviews, isLoading } = useGetMechanicReviews(mechId);
  const addFav = useAddFavorite();
  const removeFav = useRemoveFavorite();
  const createFlag = useCreateFlag();

  const [reportOpen, setReportOpen] = useState(false);
  const [flagType, setFlagType] = useState<string>("rude");
  const [flagReason, setFlagReason] = useState("");

  if (!mech) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const toggleFav = () => {
    if (mech.isFavorite) {
      removeFav.mutate({ mechanicId: mech.id }, { onSuccess: () => qc.invalidateQueries({ queryKey: getListMechanicsQueryKey() }) });
    } else {
      addFav.mutate({ data: { mechanicId: mech.id } }, { onSuccess: () => qc.invalidateQueries({ queryKey: getListMechanicsQueryKey() }) });
    }
  };

  const submitFlag = async () => {
    const ok = await confirm({
      title: "Report this mechanic?",
      message: "Reports are reviewed by admins and may affect this mechanic's standing on the platform.",
      confirmText: "Report",
      destructive: true,
    });
    if (!ok) return;
    createFlag.mutate({ data: {
      targetId: mech.id,
      type: flagType as any,
      reason: flagReason.trim() || undefined,
    }}, {
      onSuccess: () => {
        setReportOpen(false); setFlagReason("");
        void alertMessage("Report submitted", "Thanks — our team will review this.");
      },
      onError: (e: any) => void alertMessage("Couldn't submit", e?.message ?? "Try again."),
    });
  };

  let certifications: string[] = [];
  try { certifications = JSON.parse(mech.certifications || "[]"); } catch { /* noop */ }

  return (
    <>
      <Stack.Screen options={{
        title: mech.name,
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.foreground,
      }} />
      <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: 16, paddingBottom: 120 }}>
        {/* Header */}
        <View style={[styles.headerCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.avatar, { backgroundColor: colors.secondary }]}>
            <Text style={[styles.avatarText, { color: colors.secondaryForeground }]}>{mech.name.charAt(0).toUpperCase()}</Text>
          </View>
          <Text style={[styles.name, { color: colors.foreground }]}>{mech.name}</Text>
          {mech.mechanicTier ? <Text style={[styles.tier, { color: colors.primary }]}>{mech.mechanicTier.toUpperCase()}</Text> : null}
          <View style={styles.statRow}>
            <View style={styles.stat}>
              <Text style={[styles.statValue, { color: colors.foreground }]}>{mech.averageRating?.toFixed(1) ?? "—"}</Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Rating</Text>
            </View>
            <View style={styles.stat}>
              <Text style={[styles.statValue, { color: colors.foreground }]}>{mech.reviewCount}</Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Reviews</Text>
            </View>
            <View style={styles.stat}>
              <Text style={[styles.statValue, { color: colors.foreground }]}>{mech.completedJobs}</Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Jobs</Text>
            </View>
          </View>
          <View style={styles.actionRow}>
            <Pressable
              style={[styles.actionBtn, { backgroundColor: colors.primary, flex: 1 }]}
              onPress={() => router.push({ pathname: "/request-service", params: { mechanicId: String(mech.id), mechanicName: mech.name } })}
            >
              <Feather name="send" size={16} color="white" />
              <Text style={styles.actionText}>Request</Text>
            </Pressable>
            <Pressable
              style={[styles.actionBtn, { backgroundColor: mech.isFavorite ? "#EF444420" : colors.secondary, borderWidth: 1, borderColor: mech.isFavorite ? "#EF4444" : colors.border }]}
              onPress={toggleFav}
            >
              <Feather name="heart" size={16} color={mech.isFavorite ? "#EF4444" : colors.foreground} />
              <Text style={[styles.actionText, { color: mech.isFavorite ? "#EF4444" : colors.foreground }]}>
                {mech.isFavorite ? "Favorited" : "Favorite"}
              </Text>
            </Pressable>
          </View>
        </View>

        {certifications.length > 0 ? (
          <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Certifications</Text>
            <View style={styles.certWrap}>
              {certifications.map((c, i) => (
                <View key={i} style={[styles.certPill, { backgroundColor: colors.secondary }]}>
                  <Feather name="award" size={11} color={colors.foreground} />
                  <Text style={[styles.certText, { color: colors.foreground }]}>{c}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {/* Reviews */}
        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Customer Reviews</Text>
          {isLoading ? (
            <ActivityIndicator color={colors.primary} />
          ) : (reviews ?? []).length === 0 ? (
            <Text style={[styles.muted, { color: colors.mutedForeground }]}>No reviews yet.</Text>
          ) : (
            (reviews ?? []).map((r) => (
              <View key={r.jobId} style={[styles.review, { borderColor: colors.border }]}>
                <View style={styles.reviewHeader}>
                  <Text style={[styles.reviewerName, { color: colors.foreground }]}>{r.reviewerName}</Text>
                  <View style={styles.starsRow}>
                    {[1,2,3,4,5].map((s) => (
                      <Feather key={s} name="star" size={13} color={s <= r.rating ? colors.primary : colors.border} />
                    ))}
                  </View>
                </View>
                {r.text ? <Text style={[styles.reviewText, { color: colors.foreground }]}>{r.text}</Text> : null}
              </View>
            ))
          )}
        </View>

        {/* Report */}
        {!reportOpen ? (
          <Pressable
            style={[styles.reportBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
            onPress={() => setReportOpen(true)}
          >
            <Feather name="flag" size={14} color="#EF4444" />
            <Text style={[styles.reportText, { color: "#EF4444" }]}>Report this mechanic</Text>
          </Pressable>
        ) : (
          <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Report Mechanic</Text>
            <View style={styles.flagTypes}>
              {FLAG_TYPES.map((t) => (
                <Pressable
                  key={t.value}
                  style={[styles.flagOption, { borderColor: flagType === t.value ? "#EF4444" : colors.border, backgroundColor: flagType === t.value ? "#EF444420" : "transparent" }]}
                  onPress={() => setFlagType(t.value)}
                >
                  <Text style={[styles.flagOptionText, { color: flagType === t.value ? "#EF4444" : colors.foreground }]}>{t.label}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              style={[styles.textarea, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
              placeholder="Optional details (what happened?)"
              placeholderTextColor={colors.mutedForeground}
              multiline
              value={flagReason}
              onChangeText={setFlagReason}
              textAlignVertical="top"
            />
            <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
              <Pressable style={[styles.actionBtn, { backgroundColor: colors.secondary, flex: 1 }]} onPress={() => setReportOpen(false)}>
                <Text style={[styles.actionText, { color: colors.foreground }]}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.actionBtn, { backgroundColor: "#EF4444", flex: 1 }, createFlag.isPending && { opacity: 0.6 }]}
                onPress={submitFlag}
                disabled={createFlag.isPending}
              >
                {createFlag.isPending
                  ? <ActivityIndicator color="white" size="small" />
                  : <Text style={styles.actionText}>Submit Report</Text>}
              </Pressable>
            </View>
          </View>
        )}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  headerCard: { padding: 20, borderWidth: 1, borderRadius: 16, alignItems: "center", marginBottom: 12 },
  avatar: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  avatarText: { fontSize: 28, fontWeight: "800" },
  name: { fontSize: 20, fontWeight: "800" },
  tier: { fontSize: 11, fontWeight: "700", letterSpacing: 1, marginTop: 2 },
  statRow: { flexDirection: "row", marginTop: 16, marginBottom: 16, gap: 24 },
  stat: { alignItems: "center" },
  statValue: { fontSize: 22, fontWeight: "800" },
  statLabel: { fontSize: 11, fontWeight: "600", marginTop: 2 },
  actionRow: { flexDirection: "row", gap: 8, alignSelf: "stretch" },
  actionBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, borderRadius: 10 },
  actionText: { color: "white", fontWeight: "700", fontSize: 14 },
  section: { padding: 16, borderWidth: 1, borderRadius: 14, marginBottom: 12 },
  sectionTitle: { fontSize: 15, fontWeight: "700", marginBottom: 12 },
  certWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  certPill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  certText: { fontSize: 12, fontWeight: "600" },
  review: { borderTopWidth: 1, paddingTop: 10, marginTop: 8 },
  reviewHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  reviewerName: { fontSize: 13, fontWeight: "700" },
  starsRow: { flexDirection: "row", gap: 2 },
  reviewText: { fontSize: 13, lineHeight: 18 },
  muted: { fontSize: 13, textAlign: "center", paddingVertical: 12 },
  reportBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, borderRadius: 10, borderWidth: 1, marginTop: 4 },
  reportText: { fontSize: 13, fontWeight: "600" },
  flagTypes: { gap: 6, marginBottom: 10 },
  flagOption: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1 },
  flagOptionText: { fontSize: 13, fontWeight: "600" },
  textarea: { minHeight: 80, padding: 12, borderRadius: 10, borderWidth: 1, fontSize: 14 },
});
