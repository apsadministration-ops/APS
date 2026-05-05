import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator, Alert } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useListJobs, useUpdateJobStatus, Job } from "@workspace/api-client-react";
import { Feather } from "@expo/vector-icons";
import { StatusBadge } from "@/components/StatusBadge";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";

const ACTIVE_STATUSES = ["ACCEPTED", "EN_ROUTE", "IN_PROGRESS"];

const STATUS_FLOW: Record<string, { next: string; label: string }> = {
  ACCEPTED: { next: "EN_ROUTE", label: "Start Driving" },
  EN_ROUTE: { next: "IN_PROGRESS", label: "Arrived - Start Work" },
  IN_PROGRESS: { next: "COMPLETED", label: "Submit Work Log" },
};

function ActiveJobCard({ job }: { job: Job }) {
  const colors = useColors();
  const router = useRouter();
  const updateMutation = useUpdateJobStatus();
  const flow = STATUS_FLOW[job.status];

  const handleNext = () => {
    if (!flow) return;
    if (job.status === "IN_PROGRESS") {
      router.push(`/worklog/${job.id}`);
      return;
    }
    Alert.alert("Update Status", `Mark as "${flow.next.replace("_", " ")}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Confirm",
        onPress: () => {
          updateMutation.mutate(
            { jobId: job.id, data: { status: flow.next } },
            {
              onSuccess: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
            }
          );
        },
      },
    ]);
  };

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Pressable onPress={() => router.push(`/job/${job.id}`)}>
        <View style={styles.cardTop}>
          <View style={styles.titleRow}>
            <Text style={[styles.vehicleTitle, { color: colors.foreground }]}>
              {job.vehicle?.year} {job.vehicle?.make} {job.vehicle?.model}
            </Text>
            <StatusBadge status={job.status} />
          </View>
          <Text style={[styles.jobType, { color: colors.primary }]}>{job.jobType.toUpperCase()}</Text>
        </View>

        <Text style={[styles.desc, { color: colors.foreground }]} numberOfLines={2}>{job.description}</Text>

        <View style={styles.meta}>
          <View style={styles.metaItem}>
            <Feather name="user" size={13} color={colors.mutedForeground} />
            <Text style={[styles.metaText, { color: colors.mutedForeground }]}>{job.customerName}</Text>
          </View>
          {job.locationAddress ? (
            <View style={styles.metaItem}>
              <Feather name="map-pin" size={13} color={colors.mutedForeground} />
              <Text style={[styles.metaText, { color: colors.mutedForeground }]} numberOfLines={1}>
                {job.locationAddress}
              </Text>
            </View>
          ) : null}
        </View>
      </Pressable>

      {flow && (
        <Pressable
          style={[styles.nextBtn, { backgroundColor: colors.primary }, updateMutation.isPending && { opacity: 0.6 }]}
          onPress={handleNext}
          disabled={updateMutation.isPending}
        >
          {updateMutation.isPending
            ? <ActivityIndicator color="white" size="small" />
            : (
              <>
                <Feather name="arrow-right-circle" size={18} color="white" />
                <Text style={styles.nextText}>{flow.label}</Text>
              </>
            )}
        </Pressable>
      )}
    </View>
  );
}

export default function ActiveJobsScreen() {
  const colors = useColors();
  const { user } = useAuth();
  const { data: jobs, isLoading, refetch } = useListJobs(
    { mechanicId: user?.id },
    { query: { enabled: !!user?.id } }
  );

  const active = (jobs ?? []).filter((j: Job) => ACTIVE_STATUSES.includes(j.status));

  if (isLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={active}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
        onRefresh={refetch}
        refreshing={isLoading}
        ListEmptyComponent={
          <View style={[styles.emptyState, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="play-circle" size={48} color={colors.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No active jobs</Text>
            <Text style={[styles.emptyDesc, { color: colors.mutedForeground }]}>
              Accept a job from the Available tab to get started.
            </Text>
          </View>
        }
        renderItem={({ item }) => <ActiveJobCard job={item} />}
      />
    </View>
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
  cardTop: { gap: 4 },
  titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  vehicleTitle: { fontSize: 16, fontWeight: "700", flex: 1, marginRight: 8 },
  jobType: { fontSize: 11, fontWeight: "700", letterSpacing: 0.5 },
  desc: { fontSize: 14, lineHeight: 20 },
  meta: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  metaText: { fontSize: 12, fontWeight: "500" },
  nextBtn: {
    height: 46,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  nextText: { color: "white", fontWeight: "700", fontSize: 15 },
  emptyState: {
    padding: 40,
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 16,
    borderStyle: "dashed",
  },
  emptyTitle: { fontSize: 16, fontWeight: "600", marginTop: 16, marginBottom: 8 },
  emptyDesc: { fontSize: 14, textAlign: "center" },
});
