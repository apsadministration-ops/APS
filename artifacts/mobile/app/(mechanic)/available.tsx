import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator } from "react-native";
import { confirm, alertMessage } from "@/utils/confirm";
import { useColors } from "@/hooks/useColors";
import { useListAvailableJobs, useAcceptJob, Job } from "@workspace/api-client-react";
import { Feather } from "@expo/vector-icons";
import { StatusBadge } from "@/components/StatusBadge";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";

function AvailableJobCard({ job, onAccept, isPending }: { job: Job; onAccept: () => void; isPending: boolean }) {
  const colors = useColors();
  const router = useRouter();
  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Pressable onPress={() => router.push(`/job/${job.id}`)}>
        <View style={styles.cardHeader}>
          <View style={styles.titleRow}>
            <Text style={[styles.vehicleTitle, { color: colors.foreground }]}>
              {job.vehicle?.year} {job.vehicle?.make} {job.vehicle?.model}
            </Text>
            <StatusBadge status={job.status} />
          </View>
          <Text style={[styles.jobType, { color: colors.primary }]}>{job.jobType.toUpperCase()}</Text>
        </View>

        <Text style={[styles.desc, { color: colors.foreground }]} numberOfLines={2}>
          {job.description}
        </Text>

        <View style={styles.meta}>
          {job.locationAddress ? (
            <View style={styles.metaItem}>
              <Feather name="map-pin" size={13} color={colors.mutedForeground} />
              <Text style={[styles.metaText, { color: colors.mutedForeground }]} numberOfLines={1}>
                {job.locationAddress}
              </Text>
            </View>
          ) : null}
          {job.estimatedPrice ? (
            <View style={styles.metaItem}>
              <Feather name="dollar-sign" size={13} color={colors.mutedForeground} />
              <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
                Est. ${job.estimatedPrice.toFixed(0)}
              </Text>
            </View>
          ) : null}
          <View style={styles.metaItem}>
            <Feather name="clock" size={13} color={colors.mutedForeground} />
            <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
              {new Date(job.createdAt).toLocaleDateString()}
            </Text>
          </View>
        </View>
      </Pressable>

      <Pressable
        style={[styles.acceptBtn, { backgroundColor: colors.primary }, isPending && { opacity: 0.6 }]}
        onPress={onAccept}
        disabled={isPending}
      >
        {isPending
          ? <ActivityIndicator color="white" size="small" />
          : <Text style={styles.acceptText}>Accept Job</Text>}
      </Pressable>
    </View>
  );
}

export default function AvailableJobsScreen() {
  const colors = useColors();
  const { data: jobs, isLoading, refetch } = useListAvailableJobs();
  const acceptMutation = useAcceptJob();
  const router = useRouter();

  const handleAccept = async (job: Job) => {
    const ok = await confirm({
      title: "Accept Job",
      message: `Accept this ${job.jobType} job for ${job.vehicle?.year} ${job.vehicle?.make} ${job.vehicle?.model}?`,
      confirmText: "Accept",
    });
    if (!ok) return;
    acceptMutation.mutate(
      { jobId: job.id },
      {
        onSuccess: () => {
          try { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); } catch { /* web */ }
          refetch();
          router.push(`/job/${job.id}`);
        },
        onError: () => {
          void alertMessage("Error", "Failed to accept job. It may have been taken.");
        },
      }
    );
  };

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
        data={jobs ?? []}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
        onRefresh={refetch}
        refreshing={isLoading}
        ListEmptyComponent={
          <View style={[styles.emptyState, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="inbox" size={48} color={colors.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No available jobs</Text>
            <Text style={[styles.emptyDesc, { color: colors.mutedForeground }]}>
              Check back later for new service requests.
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <AvailableJobCard
            job={item}
            onAccept={() => { void handleAccept(item); }}
            isPending={acceptMutation.isPending}
          />
        )}
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
    gap: 14,
  },
  cardHeader: { gap: 4, marginBottom: 4 },
  titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  vehicleTitle: { fontSize: 16, fontWeight: "700", flex: 1, marginRight: 8 },
  jobType: { fontSize: 11, fontWeight: "700", letterSpacing: 0.5, marginTop: 2 },
  desc: { fontSize: 14, lineHeight: 20 },
  meta: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  metaText: { fontSize: 12, fontWeight: "500" },
  acceptBtn: {
    height: 44,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  acceptText: { color: "white", fontWeight: "700", fontSize: 15 },
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
