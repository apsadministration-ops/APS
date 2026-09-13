import {
  View, Text, StyleSheet, Pressable, ActivityIndicator, ScrollView, TextInput,
} from "react-native";
import { useColors } from "@/hooks/useColors";
import {
  useListAvailableBays, useCreateBayBooking, useGetJob,
  getListMyBookingsQueryKey, getGetJobQueryKey,
  ListAvailableBaysParams, BayWithShop,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useState, useMemo } from "react";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { alertMessage } from "@/utils/confirm";

function getDefaultSchedule() {
  const date = new Date(Date.now() + 15 * 60 * 1000);
  date.setSeconds(0, 0);
  return {
    date: date.toISOString().slice(0, 10),
    time: date.toTimeString().slice(0, 5),
  };
}

export default function FindBayScreen() {
  const colors = useColors();
  const router = useRouter();
  const { jobId, bookingStatus, bookingReason } = useLocalSearchParams<{
    jobId: string;
    bookingStatus?: string;
    bookingReason?: string;
  }>();
  const jid = parseInt(jobId, 10);
  const queryClient = useQueryClient();

  const { data: job } = useGetJob(jid);
  const [selectedBay, setSelectedBay] = useState<BayWithShop | null>(null);
  const defaultSchedule = useMemo(() => getDefaultSchedule(), []);
  const [scheduledDate, setScheduledDate] = useState(defaultSchedule.date);
  const [scheduledTime, setScheduledTime] = useState(defaultSchedule.time);
  const [estimatedHours, setEstimatedHours] = useState("2");
  const [error, setError] = useState("");

  const scheduleStart = useMemo(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate) || !/^\d{2}:\d{2}$/.test(scheduledTime)) {
      return null;
    }
    const start = new Date(`${scheduledDate}T${scheduledTime}:00`);
    return Number.isFinite(start.getTime()) ? start.toISOString() : null;
  }, [scheduledDate, scheduledTime]);

  const params: ListAvailableBaysParams = useMemo(() => {
    if (!job?.jobType) return {};
    const hours = parseFloat(estimatedHours);
    // The generated client serializes query objects through Object.entries.
    return {
      jobCategory: job.jobType,
      ...(scheduleStart && Number.isFinite(hours) && hours > 0
        ? { jobId: jid, startsAt: scheduleStart, durationHours: hours }
        : {}),
    };
  }, [estimatedHours, jid, job?.jobType, scheduleStart]);

  const { data: bays, isLoading, refetch } = useListAvailableBays(params);
  const createBookingMutation = useCreateBayBooking();

  const book = () => {
    setError("");
    if (!selectedBay) { setError("Pick a bay first."); return; }
    const hours = parseFloat(estimatedHours);
    if (!Number.isFinite(hours) || hours < 0.25) { setError("Estimated hours must be at least 0.25."); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate) || !/^\d{2}:\d{2}$/.test(scheduledTime)) {
      setError("Enter a valid date (YYYY-MM-DD) and time (HH:MM).");
      return;
    }
    const start = new Date(`${scheduledDate}T${scheduledTime}:00`);
    if (Number.isNaN(start.getTime()) || start.getTime() <= Date.now()) {
      setError("Choose a future date and time.");
      return;
    }
    const startTime = start.toISOString();
    createBookingMutation.mutate(
      {
        bayId: selectedBay.id,
        data: { jobId: jid, startTime, estimatedHours: hours },
      },
      {
        onSuccess: async (booking) => {
          queryClient.invalidateQueries({ queryKey: getListMyBookingsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetJobQueryKey(jid) });
          const pending = booking.status === "pending";
          await alertMessage(
            pending ? "Request sent" : "Bay reserved",
            `${pending ? "Booking request" : "Booking"} #${booking.id} at ${selectedBay.shop.name} — ${selectedBay.name}.`,
          );
          router.back();
        },
        onError: (e: any) => setError(e?.message ?? "Couldn't reserve bay."),
      },
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
    <>
      <Stack.Screen
        options={{
           title: "Schedule a Lift",
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.foreground,
          headerShown: true,
          presentation: "modal",
        }}
      />
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <KeyboardAwareScrollViewCompat
          contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
          bottomOffset={20}
        >
          {job && (
            <View style={[styles.jobCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.jobLabel, { color: colors.mutedForeground }]}>BOOKING FOR JOB</Text>
              <Text style={[styles.jobTitle, { color: colors.foreground }]}>
                #{job.id} · {job.jobType.toUpperCase()}
              </Text>
              <Text style={[styles.jobDesc, { color: colors.mutedForeground }]} numberOfLines={2}>
                {job.description}
              </Text>
              {job.requiresGhostGarage && !job.customerTransportApproved ? (
                <View style={[styles.warn, { backgroundColor: colors.destructive + "14", borderColor: colors.destructive + "44" }]}>
                  <Feather name="alert-triangle" size={14} color={colors.destructive} />
                  <Text style={{ color: colors.destructive, fontSize: 12, fontWeight: "600", flex: 1 }}>
                    Customer hasn't approved transport yet — they'll need to before this can be reserved.
                  </Text>
                </View>
              ) : null}
            </View>
          )}

          {bookingStatus ? (
            <View style={[styles.contextCard, { backgroundColor: colors.primary + "10", borderColor: colors.primary + "44" }]}>
              <Feather name="refresh-cw" size={15} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: "700" }}>
                  Previous bay request: {bookingStatus.toUpperCase()}
                </Text>
                <Text style={{ color: colors.mutedForeground, fontSize: 12, lineHeight: 17 }}>
                  Choose a new interval below. This search does not reserve a bay until you submit a request.
                </Text>
                {bookingReason ? (
                  <Text style={{ color: colors.mutedForeground, fontSize: 12, lineHeight: 17 }}>
                    Reason: {bookingReason}
                  </Text>
                ) : null}
              </View>
            </View>
          ) : null}

          <Pressable onPress={() => { void refetch(); }} style={[styles.refreshBtn, { borderColor: colors.border }]}>
            <Feather name="refresh-cw" size={14} color={colors.mutedForeground} />
            <Text style={{ color: colors.mutedForeground, fontSize: 12, fontWeight: "600" }}>Refresh list</Text>
          </Pressable>

          {(bays ?? []).length === 0 ? (
            <View style={[styles.empty, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Feather name="grid" size={40} color={colors.mutedForeground} />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No bays available</Text>
              <Text style={[styles.emptyDesc, { color: colors.mutedForeground }]}>
                No active bays accept this job's category at your tier.
              </Text>
            </View>
          ) : (
            <View style={{ gap: 10 }}>
              {(bays ?? []).map((b) => {
                const sel = selectedBay?.id === b.id;
                return (
                  <Pressable
                    key={b.id}
                    style={[styles.bayCard, {
                      backgroundColor: colors.card,
                      borderColor: sel ? colors.primary : colors.border,
                      borderWidth: sel ? 2 : 1,
                    }]}
                    onPress={() => setSelectedBay(b)}
                  >
                    <View style={styles.bayHead}>
                      <Text style={[styles.bayName, { color: colors.foreground }]}>{b.name}</Text>
                      <Text style={[styles.bayRate, { color: colors.primary }]}>${b.hourlyRate.toFixed(2)}/hr</Text>
                    </View>
                    <Text style={[styles.shopName, { color: colors.foreground }]}>{b.shop.name}</Text>
                    <Text style={[styles.shopAddr, { color: colors.mutedForeground }]}>
                      {b.shop.address}, {b.shop.city}
                    </Text>
                    <View style={styles.bayMeta}>
                      <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
                        Min tier: {b.minMechanicTier}
                      </Text>
                      {b.allowedJobCategories.length > 0 && (
                        <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
                          · {b.allowedJobCategories.join(", ")}
                        </Text>
                      )}
                    </View>
                    {b.equipment.length > 0 && (
                      <Text style={[styles.equip, { color: colors.mutedForeground }]} numberOfLines={2}>
                        🛠 {b.equipment.join(" · ")}
                      </Text>
                    )}
                  </Pressable>
                );
              })}
            </View>
          )}

          {selectedBay && (
            <View style={[styles.formCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.formTitle, { color: colors.foreground }]}>Reserve {selectedBay.name}</Text>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>SCHEDULE</Text>
              <View style={styles.scheduleRow}>
                <View style={styles.scheduleField}>
                  <Text style={[styles.inputHint, { color: colors.mutedForeground }]}>DATE</Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={colors.mutedForeground}
                    keyboardType="numbers-and-punctuation"
                    value={scheduledDate}
                    onChangeText={setScheduledDate}
                    accessibilityLabel="Scheduled date"
                  />
                </View>
                <View style={styles.scheduleField}>
                  <Text style={[styles.inputHint, { color: colors.mutedForeground }]}>START TIME</Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
                    placeholder="HH:MM"
                    placeholderTextColor={colors.mutedForeground}
                    keyboardType="numbers-and-punctuation"
                    value={scheduledTime}
                    onChangeText={setScheduledTime}
                    accessibilityLabel="Scheduled start time"
                  />
                </View>
              </View>
              <Text style={[styles.helper, { color: colors.mutedForeground }]}>
                Availability is checked for this date and time when you reserve.
              </Text>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>ESTIMATED HOURS</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
                placeholder="2"
                placeholderTextColor={colors.mutedForeground}
                keyboardType="decimal-pad"
                value={estimatedHours}
                onChangeText={setEstimatedHours}
              />
              <Text style={[styles.helper, { color: colors.mutedForeground }]}>
                Final cost is billed at ${selectedBay.hourlyRate.toFixed(2)}/hr from start to complete (1 hour minimum).
              </Text>

              {error ? <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}

              <Pressable
                style={[styles.submitBtn, { backgroundColor: colors.primary }, createBookingMutation.isPending && { opacity: 0.6 }]}
                onPress={book}
                disabled={createBookingMutation.isPending}
              >
                {createBookingMutation.isPending
                  ? <ActivityIndicator color="white" />
                  : <Text style={styles.submitText}>Reserve Bay</Text>}
              </Pressable>
            </View>
          )}
        </KeyboardAwareScrollViewCompat>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  jobCard: { padding: 14, borderRadius: 14, borderWidth: 1, marginBottom: 12, gap: 4 },
  jobLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 1 },
  jobTitle: { fontSize: 16, fontWeight: "700" },
  jobDesc: { fontSize: 13, lineHeight: 18 },
  warn: { flexDirection: "row", gap: 8, alignItems: "center", padding: 10, borderRadius: 8, borderWidth: 1, marginTop: 8 },
  contextCard: { flexDirection: "row", alignItems: "flex-start", gap: 9, padding: 11, borderRadius: 10, borderWidth: 1 },
  refreshBtn: { flexDirection: "row", gap: 6, alignItems: "center", alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, marginBottom: 12 },
  empty: { padding: 28, alignItems: "center", borderWidth: 1, borderStyle: "dashed", borderRadius: 14 },
  emptyTitle: { fontSize: 16, fontWeight: "700", marginTop: 12 },
  emptyDesc: { fontSize: 13, marginTop: 4, textAlign: "center" },
  bayCard: { padding: 14, borderRadius: 14, gap: 4 },
  bayHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  bayName: { fontSize: 16, fontWeight: "700" },
  bayRate: { fontSize: 16, fontWeight: "800" },
  shopName: { fontSize: 14, fontWeight: "600" },
  shopAddr: { fontSize: 12 },
  bayMeta: { flexDirection: "row", gap: 4, marginTop: 4 },
  metaText: { fontSize: 12 },
  equip: { fontSize: 12, marginTop: 4 },
  formCard: { borderWidth: 1, borderRadius: 14, padding: 16, marginTop: 16, gap: 8 },
  formTitle: { fontSize: 17, fontWeight: "700", marginBottom: 4 },
  label: { fontSize: 11, fontWeight: "700", letterSpacing: 1, marginTop: 8, marginBottom: 4 },
  scheduleRow: { flexDirection: "row", gap: 8 },
  scheduleField: { flex: 1, gap: 4 },
  inputHint: { fontSize: 10, fontWeight: "700", letterSpacing: 0.6 },
  input: { height: 46, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, fontSize: 15 },
  helper: { fontSize: 12, marginTop: 6 },
  error: { fontSize: 14, marginTop: 8 },
  submitBtn: { height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center", marginTop: 12 },
  submitText: { color: "white", fontWeight: "700", fontSize: 16 },
});
