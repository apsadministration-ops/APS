import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator } from "react-native";
import { confirm, alertMessage } from "@/utils/confirm";
import { useColors } from "@/hooks/useColors";
import {
  useListAvailableJobs,
  useAcceptJob,
  getListAvailableJobsQueryKey,
  Job,
} from "@workspace/api-client-react";
import { Feather } from "@expo/vector-icons";
import { StatusBadge } from "@/components/StatusBadge";
import { CommercialJobContext } from "@/components/partner/CommercialJobIntegration";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { useAuth } from "@/context/AuthContext";
import { useState } from "react";
import {
  COMMISSION,
  commissionForJob,
  isWorkingDown,
  tierLabel,
  type TierKey,
  type ServiceCategory,
} from "@workspace/tier-catalog";

type Mode = "my_tier" | "work_down";

function CommissionPill({ job, myTier }: { job: Job; myTier: TierKey }) {
  const colors = useColors();
  const reqTier = ((job.requiredTier as TierKey | null) ?? "detailer");
  const result = commissionForJob({
    category: job.jobType as ServiceCategory,
    jobTier: reqTier,
    mechanicTier: myTier,
  });
  const isDown = result.reason === "working_down";
  const isDet = result.reason === "detailing";
  const bg = isDet ? "#22C55E22" : isDown ? "#F59E0B22" : colors.primary + "22";
  const fg = isDet ? "#15803D" : isDown ? "#B45309" : colors.primary;
  return (
    <View style={[styles.pill, { backgroundColor: bg, borderColor: fg + "55" }]}>
      <Feather name="dollar-sign" size={11} color={fg} />
      <Text style={[styles.pillText, { color: fg }]}>You keep {result.mechanicPct}%</Text>
    </View>
  );
}

function AvailableJobCard({ job, onAccept, isPending, myTier }: { job: Job; onAccept: () => void; isPending: boolean; myTier: TierKey }) {
  const colors = useColors();
  const router = useRouter();
  const reqTier = ((job.requiredTier as TierKey | null) ?? "detailer");
  const workingDown = isWorkingDown(myTier, reqTier);
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
          <View style={styles.tagRow}>
            <Text style={[styles.jobType, { color: colors.primary }]}>{job.jobType.toUpperCase()}</Text>
            <Text style={[styles.dot, { color: colors.mutedForeground }]}>·</Text>
            <Text style={[styles.tierTag, { color: colors.mutedForeground }]}>{tierLabel(reqTier)}</Text>
            {workingDown ? (
              <Text style={[styles.workDownTag, { color: "#B45309" }]}>· working down</Text>
            ) : null}
          </View>
          <CommercialJobContext job={job} compact />
        </View>

        <Text style={[styles.desc, { color: colors.foreground }]} numberOfLines={2}>
          {job.description}
        </Text>

        <View style={styles.meta}>
          <CommissionPill job={job} myTier={myTier} />
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
  const router = useRouter();
  const { user } = useAuth();
  const myTier = ((user?.mechanicTier ?? "detailer") as TierKey);
  const [mode, setMode] = useState<Mode>("my_tier");
  const { data: jobs, isLoading, refetch, isRefetching } = useListAvailableJobs(
    { mode },
    { query: { queryKey: getListAvailableJobsQueryKey({ mode }) } },
  );
  const acceptMutation = useAcceptJob();

  const handleAccept = async (job: Job) => {
    const reqTier = ((job.requiredTier as TierKey | null) ?? "detailer");
    const commission = commissionForJob({
      category: job.jobType as ServiceCategory,
      jobTier: reqTier,
      mechanicTier: myTier,
    });
    const ok = await confirm({
      title: "Accept Job",
      message: `Accept this ${job.jobType} job for ${job.vehicle?.year} ${job.vehicle?.make} ${job.vehicle?.model}?\n\nYou keep ${commission.mechanicPct}% of labor (${commission.reasonLabel})`,
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

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Tier filter dropdown — strict default is "my tier only". */}
      <View style={[styles.modeRow, { backgroundColor: colors.background, borderBottomColor: colors.border }]}>
        <Pressable
          style={[
            styles.modeOption,
            { borderColor: mode === "my_tier" ? colors.primary : colors.border, backgroundColor: mode === "my_tier" ? colors.primary + "14" : colors.card },
          ]}
          onPress={() => setMode("my_tier")}
        >
          <Feather name="target" size={13} color={mode === "my_tier" ? colors.primary : colors.mutedForeground} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.modeTitle, { color: mode === "my_tier" ? colors.primary : colors.foreground }]}>My tier — {tierLabel(myTier)}</Text>
            <Text style={[styles.modeSub, { color: colors.mutedForeground }]}>{COMMISSION.normal.mechanicPct}% / {COMMISSION.detailing.mechanicPct}% on detailing</Text>
          </View>
        </Pressable>
        <Pressable
          style={[
            styles.modeOption,
            { borderColor: mode === "work_down" ? "#F59E0B" : colors.border, backgroundColor: mode === "work_down" ? "#F59E0B14" : colors.card },
          ]}
          onPress={() => setMode("work_down")}
        >
          <Feather name="arrow-down" size={13} color={mode === "work_down" ? "#B45309" : colors.mutedForeground} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.modeTitle, { color: mode === "work_down" ? "#B45309" : colors.foreground }]}>Work Down</Text>
            <Text style={[styles.modeSub, { color: colors.mutedForeground }]}>Lower-tier jobs · {COMMISSION.workingDown.mechanicPct}%</Text>
          </View>
        </Pressable>
      </View>

      {isLoading && !jobs ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
      ) : (
        <FlatList
          data={jobs ?? []}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
          onRefresh={refetch}
          refreshing={isRefetching}
          ListEmptyComponent={
            <View style={[styles.emptyState, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Feather name={mode === "my_tier" ? "inbox" : "search"} size={48} color={colors.mutedForeground} />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
                {mode === "my_tier" ? `No ${tierLabel(myTier)} jobs right now` : "No lower-tier jobs available"}
              </Text>
              <Text style={[styles.emptyDesc, { color: colors.mutedForeground }]}>
                {mode === "my_tier"
                  ? "Try Work Down to take jobs from lower tiers (paid at 75% instead of 80%)."
                  : "Check back later — lower-tier work pops up throughout the day."}
              </Text>
              <Pressable onPress={() => router.push("/mechanic/earnings" as never)} style={[styles.earningsLink, { borderColor: colors.border }]}>
                <Feather name="trending-up" size={14} color={colors.primary} />
                <Text style={[styles.earningsLinkText, { color: colors.primary }]}>How much can you earn?</Text>
              </Pressable>
            </View>
          }
          renderItem={({ item }) => (
            <AvailableJobCard
              job={item}
              onAccept={() => { void handleAccept(item); }}
              isPending={acceptMutation.isPending}
              myTier={myTier}
            />
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  modeRow: {
    flexDirection: "row", gap: 8, padding: 12, borderBottomWidth: 1,
  },
  modeOption: {
    flex: 1, flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, borderWidth: 1.5,
  },
  modeTitle: { fontSize: 13, fontWeight: "700" },
  modeSub: { fontSize: 10, marginTop: 1 },
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
  tagRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  jobType: { fontSize: 11, fontWeight: "700", letterSpacing: 0.5 },
  dot: { fontSize: 11, fontWeight: "700" },
  tierTag: { fontSize: 11, fontWeight: "600" },
  workDownTag: { fontSize: 11, fontWeight: "700" },
  desc: { fontSize: 14, lineHeight: 20 },
  meta: { flexDirection: "row", flexWrap: "wrap", gap: 12, alignItems: "center" },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  metaText: { fontSize: 12, fontWeight: "500" },
  pill: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, borderWidth: 1,
  },
  pillText: { fontSize: 11, fontWeight: "700" },
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
  emptyTitle: { fontSize: 16, fontWeight: "600", marginTop: 16, marginBottom: 8, textAlign: "center" },
  emptyDesc: { fontSize: 14, textAlign: "center" },
  earningsLink: {
    flexDirection: "row", alignItems: "center", gap: 6,
    marginTop: 16, paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: 10, borderWidth: 1,
  },
  earningsLinkText: { fontSize: 13, fontWeight: "700" },
});
