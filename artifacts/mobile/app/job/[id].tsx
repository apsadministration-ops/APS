import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { confirm } from "@/utils/confirm";
import { useColors } from "@/hooks/useColors";
import { useGetJob, useRateJob, useCancelJob } from "@workspace/api-client-react";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { StatusBadge } from "@/components/StatusBadge";
import { useAuth } from "@/context/AuthContext";
import { useState } from "react";
import * as Haptics from "expo-haptics";

const STATUS_ORDER = ["REQUESTED", "OFFERED", "ACCEPTED", "EN_ROUTE", "IN_PROGRESS", "COMPLETED", "PAID"];

function TimelineStep({ label, active, done }: { label: string; active: boolean; done: boolean }) {
  const colors = useColors();
  return (
    <View style={styles.timelineStep}>
      <View style={[
        styles.timelineDot,
        done && { backgroundColor: colors.primary },
        active && { backgroundColor: colors.primary, borderColor: colors.primary },
        !done && !active && { backgroundColor: colors.muted, borderColor: colors.border },
      ]} />
      <Text style={[styles.timelineLabel, { color: done || active ? colors.foreground : colors.mutedForeground }]}>
        {label.replace("_", " ")}
      </Text>
    </View>
  );
}

export default function JobDetailScreen() {
  const colors = useColors();
  const { user } = useAuth();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const jobId = parseInt(id, 10);

  const { data: job, isLoading, refetch } = useGetJob(jobId);
  const rateMutation = useRateJob();
  const cancelMutation = useCancelJob();

  const [rating, setRating] = useState(0);

  if (isLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!job) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.destructive }}>Job not found</Text>
      </View>
    );
  }

  const isCustomer = user?.role === "customer";
  const isMechanic = user?.role === "mechanic";
  const canCancel =
    (isCustomer && ["REQUESTED", "OFFERED"].includes(job.status)) ||
    (isMechanic && job.mechanicId === user?.id && ["ACCEPTED", "EN_ROUTE"].includes(job.status));
  const canRate = isCustomer && (job.status === "COMPLETED" || job.status === "PAID") && !job.rating;
  const canSubmitWorklog = isMechanic && job.status === "IN_PROGRESS" && job.mechanicId === user?.id;

  const currentStep = STATUS_ORDER.indexOf(job.status);
  const visibleStatuses = job.status === "CANCELLED"
    ? ["REQUESTED", "CANCELLED"]
    : STATUS_ORDER.slice(0, STATUS_ORDER.indexOf("PAID") + 1).filter((s) => s !== "OFFERED");

  const handleCancel = async () => {
    const ok = await confirm({
      title: "Cancel Job",
      message: isMechanic
        ? "Drop this job? It will be released back to other mechanics."
        : "Are you sure you want to cancel this job?",
      confirmText: isMechanic ? "Drop Job" : "Yes, Cancel",
      cancelText: "No",
      destructive: true,
    });
    if (!ok) return;
    cancelMutation.mutate({ jobId }, {
      onSuccess: () => {
        try { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); } catch { /* web */ }
        refetch();
      },
    });
  };

  const handleRate = () => {
    if (rating < 1) return;
    rateMutation.mutate(
      { jobId, data: { rating } },
      {
        onSuccess: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          refetch();
        },
      }
    );
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: `Job #${job.id}`,
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.foreground,
          headerShown: true,
        }}
      />
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
          contentInsetAdjustmentBehavior="automatic"
        >
          {/* Header Card */}
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.cardHeader}>
              <View>
                <Text style={[styles.jobType, { color: colors.primary }]}>{job.jobType.toUpperCase()}</Text>
                <Text style={[styles.vehicleName, { color: colors.foreground }]}>
                  {job.vehicle?.year} {job.vehicle?.make} {job.vehicle?.model}
                </Text>
                <Text style={[styles.vin, { color: colors.mutedForeground }]}>VIN: {job.vin}</Text>
              </View>
              <StatusBadge status={job.status} />
            </View>

            <Text style={[styles.desc, { color: colors.foreground }]}>{job.description}</Text>

            {job.locationAddress ? (
              <View style={styles.infoRow}>
                <Feather name="map-pin" size={14} color={colors.mutedForeground} />
                <Text style={[styles.infoText, { color: colors.mutedForeground }]}>{job.locationAddress}</Text>
              </View>
            ) : null}
          </View>

          {/* Pricing */}
          {(job.estimatedPrice != null || job.finalPrice != null) && (
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>Pricing</Text>
              {job.estimatedPrice != null && (
                <View style={styles.priceRow}>
                  <Text style={[styles.priceLabel, { color: colors.mutedForeground }]}>Estimated</Text>
                  <Text style={[styles.priceValue, { color: colors.foreground }]}>${job.estimatedPrice.toFixed(2)}</Text>
                </View>
              )}
              {job.finalPrice != null && (
                <View style={styles.priceRow}>
                  <Text style={[styles.priceLabel, { color: colors.mutedForeground }]}>Final</Text>
                  <Text style={[styles.priceValue, { color: colors.primary, fontWeight: "700" }]}>${job.finalPrice.toFixed(2)}</Text>
                </View>
              )}
            </View>
          )}

          {/* Mechanic */}
          {job.mechanicId && (
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>Mechanic</Text>
              <View style={styles.personRow}>
                <View style={[styles.avatar, { backgroundColor: colors.secondary }]}>
                  <Text style={[styles.avatarText, { color: colors.secondaryForeground }]}>
                    {job.mechanicName?.charAt(0).toUpperCase()}
                  </Text>
                </View>
                <View>
                  <Text style={[styles.personName, { color: colors.foreground }]}>{job.mechanicName}</Text>
                  {job.rating && (
                    <View style={styles.ratingRow}>
                      {[1, 2, 3, 4, 5].map((s) => (
                        <Feather key={s} name="star" size={14} color={s <= job.rating! ? colors.primary : colors.border} />
                      ))}
                    </View>
                  )}
                </View>
              </View>
            </View>
          )}

          {/* Status Timeline */}
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Status Timeline</Text>
            <View style={styles.timeline}>
              {visibleStatuses.map((s) => (
                <TimelineStep
                  key={s}
                  label={s}
                  active={s === job.status}
                  done={STATUS_ORDER.indexOf(s) < currentStep}
                />
              ))}
            </View>
          </View>

          {/* Rate */}
          {canRate && (
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>Rate Mechanic</Text>
              <View style={styles.ratingStars}>
                {[1, 2, 3, 4, 5].map((s) => (
                  <Pressable key={s} onPress={() => setRating(s)}>
                    <Feather name="star" size={36} color={s <= rating ? colors.primary : colors.border} />
                  </Pressable>
                ))}
              </View>
              <Pressable
                style={[styles.primaryBtn, { backgroundColor: colors.primary }, rating < 1 && { opacity: 0.4 }]}
                onPress={handleRate}
                disabled={rating < 1 || rateMutation.isPending}
              >
                {rateMutation.isPending
                  ? <ActivityIndicator color="white" />
                  : <Text style={styles.primaryBtnText}>Submit Rating</Text>}
              </Pressable>
            </View>
          )}

          {/* Mechanic tools row */}
          {isMechanic && job.vehicleId && (
            <View style={styles.toolsRow}>
              <Pressable
                style={[styles.toolBtn, { backgroundColor: colors.secondary, borderColor: colors.border }]}
                onPress={() => router.push(`/parts/${job.vehicleId}`)}
              >
                <Feather name="settings" size={16} color={colors.foreground} />
                <Text style={[styles.toolBtnText, { color: colors.foreground }]}>Parts</Text>
              </Pressable>
              <Pressable
                style={[styles.toolBtn, { backgroundColor: colors.secondary, borderColor: colors.border }]}
                onPress={() => router.push(`/obd2/${job.vehicleId}`)}
              >
                <Feather name="cpu" size={16} color={colors.foreground} />
                <Text style={[styles.toolBtnText, { color: colors.foreground }]}>OBD2</Text>
              </Pressable>
              <Pressable
                style={[styles.toolBtn, { backgroundColor: colors.secondary, borderColor: colors.border }]}
                onPress={() => router.push(`/messages/${job.id}`)}
              >
                <Feather name="message-circle" size={16} color={colors.foreground} />
                <Text style={[styles.toolBtnText, { color: colors.foreground }]}>Chat</Text>
              </Pressable>
            </View>
          )}

          {/* Customer: chat + tracker buttons */}
          {isCustomer && job.mechanicId && (
            <Pressable
              style={[styles.partsBtn, { backgroundColor: colors.secondary, borderColor: colors.border }]}
              onPress={() => router.push(`/messages/${job.id}`)}
            >
              <Feather name="message-circle" size={18} color={colors.foreground} />
              <Text style={[styles.partsBtnText, { color: colors.foreground }]}>Chat with Mechanic</Text>
            </Pressable>
          )}

          {/* Customer tracker button — visible when job is active */}
          {isCustomer && ["ACCEPTED","EN_ROUTE","IN_PROGRESS"].includes(job.status) && (
            <Pressable
              style={[styles.partsBtn, { backgroundColor: colors.primary + "18", borderColor: colors.primary + "44" }]}
              onPress={() => router.push(`/tracker/${job.id}`)}
            >
              <Feather name="navigation" size={18} color={colors.primary} />
              <Text style={[styles.partsBtnText, { color: colors.primary }]}>Track Mechanic</Text>
              <View style={styles.liveDot} />
            </Pressable>
          )}

          {/* Actions */}
          {canSubmitWorklog && (
            <Pressable
              style={[styles.primaryBtn, { backgroundColor: colors.primary, marginTop: 4 }]}
              onPress={() => router.push(`/worklog/${job.id}`)}
            >
              <Text style={styles.primaryBtnText}>Submit Work Log</Text>
            </Pressable>
          )}

          {canCancel && (
            <Pressable
              style={[styles.primaryBtn, { backgroundColor: colors.destructive, marginTop: 8 }]}
              onPress={() => { void handleCancel(); }}
              disabled={cancelMutation.isPending}
            >
              {cancelMutation.isPending
                ? <ActivityIndicator color="white" />
                : <Text style={styles.primaryBtnText}>{isMechanic ? "Drop Job" : "Cancel Job"}</Text>}
            </Pressable>
          )}
        </ScrollView>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  card: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    gap: 12,
  },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  cardTitle: { fontSize: 16, fontWeight: "700" },
  jobType: { fontSize: 11, fontWeight: "700", letterSpacing: 0.5 },
  vehicleName: { fontSize: 18, fontWeight: "700", marginTop: 2 },
  vin: { fontSize: 12, fontFamily: "monospace", marginTop: 2 },
  desc: { fontSize: 15, lineHeight: 22 },
  infoRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  infoText: { fontSize: 13 },
  priceRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  priceLabel: { fontSize: 14 },
  priceValue: { fontSize: 20, fontWeight: "600" },
  personRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 18, fontWeight: "700" },
  personName: { fontSize: 15, fontWeight: "600" },
  ratingRow: { flexDirection: "row", gap: 2, marginTop: 4 },
  timeline: { gap: 0 },
  timelineStep: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 },
  timelineDot: { width: 14, height: 14, borderRadius: 7, borderWidth: 2 },
  timelineLabel: { fontSize: 14, fontWeight: "500" },
  ratingStars: { flexDirection: "row", justifyContent: "center", gap: 12, paddingVertical: 8 },
  primaryBtn: {
    height: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnText: { color: "white", fontWeight: "700", fontSize: 16 },
  partsBtn: {
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginTop: 4,
  },
  partsBtnText: { fontSize: 15, fontWeight: "600", flex: 1, textAlign: "center" },
  toolsRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 4,
  },
  toolBtn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  toolBtnText: { fontSize: 13, fontWeight: "600" },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#22C55E" },
});
