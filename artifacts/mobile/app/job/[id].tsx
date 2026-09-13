import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput } from "react-native";
import { confirm, alertMessage } from "@/utils/confirm";
import { useColors } from "@/hooks/useColors";
import {
  useGetJob, useRateJob, useCancelJob, useRateCustomer, useCreateFlag,
  useApproveJobTransport, useListJobInspections,
  useListMyBookings, useCancelBayBooking, useGetJobLiftRequirement, useSetJobLiftRequirement,
  getGetJobQueryKey, getListJobInspectionsQueryKey, getListMyBookingsQueryKey,
  getGetJobLiftRequirementQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { StatusBadge } from "@/components/StatusBadge";
import { CommercialJobContext } from "@/components/partner/CommercialJobIntegration";
import { useAuth } from "@/context/AuthContext";
import { useState, useEffect } from "react";
import * as Haptics from "expo-haptics";
import * as WebBrowser from "expo-web-browser";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getApiUrl } from "@/lib/apiConfig";

const STATUS_ORDER = ["REQUESTED", "OFFERED", "PENDING_APPROVAL", "ACCEPTED", "EN_ROUTE", "IN_PROGRESS", "COMPLETED", "PAID"];

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
  const rateCustomerMutation = useRateCustomer();
  const cancelMutation = useCancelJob();
  const cancelBookingMutation = useCancelBayBooking();
  const setLiftRequirementMutation = useSetJobLiftRequirement();
  const flagMutation = useCreateFlag();
  const approveTransportMutation = useApproveJobTransport();
  const queryClient = useQueryClient();
  const { data: inspections } = useListJobInspections(jobId, {
    query: {
      enabled: Number.isFinite(jobId) && job?.requiresGhostGarage === true,
      queryKey: getListJobInspectionsQueryKey(jobId),
    },
  });
  const { data: linkedBookings } = useListMyBookings({
    query: {
      enabled: user?.role === "mechanic" && job?.mechanicId === user.id,
      queryKey: getListMyBookingsQueryKey(),
      // A shop owner can approve/reject a request while the mechanic is on
      // this screen. Keep the linked booking status fresh without creating a
      // second realtime transport channel.
      refetchInterval: 10_000,
    },
  });
  const { data: liftRequirement } = useGetJobLiftRequirement(jobId, {
    query: {
      enabled: user?.role === "mechanic" && job?.mechanicId === user.id,
      queryKey: getGetJobLiftRequirementQueryKey(jobId),
    },
  });

  const [rating, setRating] = useState(0);
  const [reviewText, setReviewText] = useState("");
  const [custRating, setCustRating] = useState(0);
  const [custReviewText, setCustReviewText] = useState("");
  const [payLoading, setPayLoading] = useState(false);
  const isCommercialJob = Boolean(
    job?.partnerKindSnapshot === "dealership" || job?.partnerKindSnapshot === "fleet",
  ) && job?.sourceOrganizationId != null && job?.sourceServiceRequestId != null;
  const isCommercialPrincipal = Boolean(
    user?.role === "shop_owner" &&
    job?.customerId === user.id &&
    isCommercialJob,
  );

  // Trust system: when a customer lands on a job that's still awaiting their
  // 60s approval of the assigned mechanic, route them straight to the
  // approval screen. A commercial principal uses the same approval controls;
  // mechanic and admin keep the regular detail view.
  useEffect(() => {
    if (
      job?.status === "PENDING_APPROVAL" &&
      ((user?.role === "customer" && job?.customerId === user.id) || isCommercialPrincipal)
    ) {
      router.replace(`/job/${jobId}/approve`);
    }
  }, [job?.status, job?.customerId, user?.role, user?.id, jobId, router, isCommercialPrincipal]);

  const handlePay = async () => {
    setPayLoading(true);
    try {
      const token = await AsyncStorage.getItem("auth_token");
      const res = await fetch(getApiUrl(`/payments/jobs/${jobId}/checkout`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      const data = await res.json().catch(() => ({})) as { url?: string; error?: string };
      if (!res.ok) {
        await alertMessage("Payment unavailable", data.error ?? "Could not start checkout.");
        return;
      }
      if (!data.url) {
        await alertMessage("Payment unavailable", "Checkout could not be started. Please try again.");
        return;
      }
      if (Platform.OS === "web") window.open(data.url, "_blank");
      else await WebBrowser.openBrowserAsync(data.url);
    } catch (e: any) {
      await alertMessage("Network error", e?.message ?? "Try again.");
    } finally {
      setPayLoading(false);
    }
  };

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
  // Commercial principals use the shop-owner role but are the customer of
  // record for their organization jobs. The API accepts them for checkout,
  // so keep the payment action visible for the same server-authorized actor.
  const canAuthorizePayment =
    (isCustomer && job.customerId === user?.id) || isCommercialPrincipal;
  const canApproveTransport = isCustomer || isCommercialPrincipal;
  const liftRequired = liftRequirement?.requiresGhostGarage ?? job.requiresGhostGarage;
  const canCancel =
    (isCustomer && ["REQUESTED", "OFFERED"].includes(job.status)) ||
    (isMechanic && job.mechanicId === user?.id && ["ACCEPTED", "EN_ROUTE"].includes(job.status));
  const canRate = isCustomer && (job.status === "COMPLETED" || job.status === "PAID") && !job.rating;
  const canRateCustomer = isMechanic && job.mechanicId === user?.id && (job.status === "COMPLETED" || job.status === "PAID") && !job.customerRating;
  const canSubmitWorklog = isMechanic && job.status === "IN_PROGRESS" && job.mechanicId === user?.id;
  const canFlagMechanic = isCustomer && job.mechanicId != null;
  const canFlagCustomer = isMechanic && job.mechanicId === user?.id;
  const linkedBooking = (linkedBookings ?? [])
    .filter((booking) => booking.jobId === job.id)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

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
      { jobId, data: { rating, reviewText: reviewText.trim() || undefined } },
      {
        onSuccess: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          setReviewText("");
          refetch();
        },
      }
    );
  };

  const handleRateCustomer = () => {
    if (custRating < 1) return;
    rateCustomerMutation.mutate(
      { jobId, data: { rating: custRating, reviewText: custReviewText.trim() || undefined } },
      {
        onSuccess: () => {
          try { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); } catch { /* web */ }
          setCustReviewText("");
          refetch();
        },
      }
    );
  };

  const handleApproveTransport = async () => {
    const ok = await confirm({
      title: "Approve transport to shop bay?",
      message: "Your mechanic will drive the vehicle to a partner shop bay for service. You can track them en route.",
      confirmText: "Approve",
    });
    if (!ok) return;
    approveTransportMutation.mutate({ jobId }, {
      onSuccess: () => {
        try { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); } catch { /* web */ }
        queryClient.invalidateQueries({ queryKey: getGetJobQueryKey(jobId) });
        queryClient.invalidateQueries({ queryKey: getListJobInspectionsQueryKey(jobId) });
      },
      onError: (e: any) => void alertMessage("Couldn't approve", e?.message ?? "Try again."),
    });
  };

  const handleRequireLift = async () => {
    const ok = await confirm({
      title: "Require a shop lift?",
      message: "This will require a customer transport approval, a scheduled bay, and pre/post inspections before the work log can be submitted.",
      confirmText: "Require Lift",
    });
    if (!ok) return;
    setLiftRequirementMutation.mutate(
      { jobId, data: { requiresGhostGarage: true } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetJobQueryKey(jobId) });
          queryClient.invalidateQueries({ queryKey: getGetJobLiftRequirementQueryKey(jobId) });
          void alertMessage("Lift required", "The customer must approve transport before you schedule a bay.");
        },
        onError: (e: any) => void alertMessage("Couldn't require lift", e?.message ?? "Try again."),
      },
    );
  };

  const openBaySearch = (status?: string, reason?: string | null) => {
    const query = status
      ? `?bookingStatus=${encodeURIComponent(status)}${reason ? `&bookingReason=${encodeURIComponent(reason)}` : ""}`
      : "";
    router.push(`/bays/${jobId}${query}`);
  };

  const handleCancelBooking = async (bookingId: number, reschedule: boolean) => {
    const ok = await confirm({
      title: reschedule ? "Reschedule lift?" : "Cancel lift booking?",
      message: reschedule
        ? "The current bay request will be cancelled so you can choose a different interval."
        : "The mechanic and shop will be notified that this bay request was cancelled.",
      confirmText: reschedule ? "Cancel & Reschedule" : "Cancel Booking",
      destructive: !reschedule,
    });
    if (!ok) return;
    cancelBookingMutation.mutate(
      {
        bookingId,
        data: { reason: reschedule ? "Mechanic requested reschedule" : "Cancelled by mechanic" },
      },
      {
        onSuccess: (booking) => {
          queryClient.invalidateQueries({ queryKey: getListMyBookingsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetJobQueryKey(jobId) });
          if (reschedule) {
            openBaySearch(booking.status, booking.cancellationReason);
          } else {
            void alertMessage("Booking cancelled", "You can schedule another lift interval when ready.");
          }
        },
        onError: (e: any) => void alertMessage("Couldn't cancel booking", e?.message ?? "Try again."),
      },
    );
  };

  const handleFlag = async (kind: "mechanic" | "customer") => {
    const targetId = kind === "mechanic" ? job.mechanicId : job.customerId;
    if (!targetId) return;
    const ok = await confirm({
      title: kind === "mechanic" ? "Report this mechanic?" : "Report this customer?",
      message: kind === "mechanic"
        ? "Use for rude/no-show/unsafe/scam behavior. Admins will review."
        : "Use for scam/no-show/unsafe behavior. Admins will review.",
      confirmText: "Report",
      destructive: true,
    });
    if (!ok) return;
    flagMutation.mutate({
      data: {
        targetId,
        jobId,
        type: kind === "mechanic" ? "rude" : "scam",
        reason: kind === "mechanic" ? "Reported from job detail" : "Reported from job detail",
      },
    }, {
      onSuccess: () => void alertMessage("Report submitted", "Thanks — our team will review."),
      onError: (e: any) => void alertMessage("Couldn't submit", e?.message ?? "Try again."),
    });
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

            {isCommercialJob ? <CommercialJobContext job={job} /> : null}
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

          {/* Customer payment authorization */}
          {canAuthorizePayment && job.status === "ACCEPTED" && job.estimatedPrice != null && (
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>Authorize Payment</Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 13, lineHeight: 18, marginBottom: 12 }}>
                Funds are placed on hold now. You're only charged when the mechanic completes the job. Card, Apple Pay, and Google Pay all supported.
              </Text>
              <Pressable
                style={[styles.primaryBtn, { backgroundColor: colors.primary }, payLoading && { opacity: 0.6 }]}
                onPress={handlePay}
                disabled={payLoading}
              >
                {payLoading
                  ? <ActivityIndicator color="white" />
                  : <Text style={styles.primaryBtnText}>Pay & Authorize ${job.estimatedPrice.toFixed(2)}</Text>}
              </Pressable>
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

          {/* Customer rates mechanic */}
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
              <TextInput
                style={[styles.textarea, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
                placeholder="Write a review for this mechanic (visible to other customers)"
                placeholderTextColor={colors.mutedForeground}
                value={reviewText}
                onChangeText={setReviewText}
                multiline
                textAlignVertical="top"
              />
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

          {/* Show customer's existing review (read-only) */}
          {isCustomer && job.rating != null && job.mechanicReviewText ? (
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>Your Review</Text>
              <Text style={{ color: colors.foreground, fontSize: 14, lineHeight: 20 }}>{job.mechanicReviewText}</Text>
            </View>
          ) : null}

          {/* Show mechanic's review of customer (visible to both) */}
          {job.customerRating != null ? (
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>
                {isCustomer ? "Mechanic's Review of You" : "Your Review of Customer"}
              </Text>
              <View style={styles.ratingRow}>
                {[1,2,3,4,5].map((s) => (
                  <Feather key={s} name="star" size={16} color={s <= job.customerRating! ? colors.primary : colors.border} />
                ))}
              </View>
              {job.customerReviewText ? (
                <Text style={{ color: colors.foreground, fontSize: 14, lineHeight: 20 }}>{job.customerReviewText}</Text>
              ) : null}
            </View>
          ) : null}

          {/* Mechanic rates customer */}
          {canRateCustomer && (
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>Rate Customer</Text>
              <View style={styles.ratingStars}>
                {[1, 2, 3, 4, 5].map((s) => (
                  <Pressable key={s} onPress={() => setCustRating(s)}>
                    <Feather name="star" size={36} color={s <= custRating ? colors.primary : colors.border} />
                  </Pressable>
                ))}
              </View>
              <TextInput
                style={[styles.textarea, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
                placeholder="Notes for other mechanics (clean site? fair to work with?)"
                placeholderTextColor={colors.mutedForeground}
                value={custReviewText}
                onChangeText={setCustReviewText}
                multiline
                textAlignVertical="top"
              />
              <Pressable
                style={[styles.primaryBtn, { backgroundColor: colors.primary }, custRating < 1 && { opacity: 0.4 }]}
                onPress={handleRateCustomer}
                disabled={custRating < 1 || rateCustomerMutation.isPending}
              >
                {rateCustomerMutation.isPending
                  ? <ActivityIndicator color="white" />
                  : <Text style={styles.primaryBtnText}>Submit Customer Rating</Text>}
              </Pressable>
            </View>
          )}

          {/* Mechanic: Vehicle Workbench primary CTA — only for active assigned jobs */}
          {isMechanic && job.mechanicId === user?.id && job.vehicleId &&
            ["ACCEPTED", "EN_ROUTE", "IN_PROGRESS"].includes(job.status) && (
            <Pressable
              style={[styles.partsBtn, { backgroundColor: colors.primary + "18", borderColor: colors.primary + "55" }]}
              onPress={() => router.push(`/workbench/${job.id}`)}
            >
              <Feather name="tool" size={18} color={colors.primary} />
              <Text style={[styles.partsBtnText, { color: colors.primary, fontWeight: "700" }]}>Open Vehicle Workbench</Text>
            </Pressable>
          )}

          {/* Mechanic can add the existing Ghost Garage requirement without
              creating inventory, billing, or a second job. */}
          {isMechanic && job.mechanicId === user?.id &&
            ["ACCEPTED", "EN_ROUTE", "IN_PROGRESS"].includes(job.status) &&
            !liftRequired && (
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>Need a lift?</Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 13, lineHeight: 18 }}>
                Require an indoor bay for this job. The customer will be asked to approve transport before a bay can be reserved.
              </Text>
              <Pressable
                style={[styles.primaryBtn, { backgroundColor: colors.primary }, setLiftRequirementMutation.isPending && { opacity: 0.6 }]}
                onPress={() => { void handleRequireLift(); }}
                disabled={setLiftRequirementMutation.isPending}
              >
                {setLiftRequirementMutation.isPending
                  ? <ActivityIndicator color="white" />
                  : <Text style={styles.primaryBtnText}>Require Lift</Text>}
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

          {/* Ghost Garage: customer transport approval CTA */}
          {canApproveTransport && job.requiresGhostGarage && !job.customerTransportApproved && (
            <View style={[styles.card, { backgroundColor: colors.primary + "10", borderColor: colors.primary + "55" }]}>
              <Text style={[styles.cardTitle, { color: colors.primary }]}>Approve Transport to Shop Bay</Text>
              <Text style={{ color: colors.foreground, fontSize: 13, lineHeight: 18 }}>
                This job needs an indoor bay (lift, alignment, etc). Approve so your mechanic can drive your vehicle to the shop. You'll be able to track them along the way.
              </Text>
              <Pressable
                style={[styles.primaryBtn, { backgroundColor: colors.primary }, approveTransportMutation.isPending && { opacity: 0.6 }]}
                onPress={() => { void handleApproveTransport(); }}
                disabled={approveTransportMutation.isPending}
              >
                {approveTransportMutation.isPending
                  ? <ActivityIndicator color="white" />
                  : <Text style={styles.primaryBtnText}>Approve Transport</Text>}
              </Pressable>
            </View>
          )}

          {/* Ghost Garage: transport approved badge + tracker entry */}
          {job.requiresGhostGarage && job.customerTransportApproved && (
            <Pressable
              style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, flexDirection: "row", alignItems: "center", gap: 10 }]}
              onPress={() => router.push(`/transport/${job.id}`)}
            >
              <Feather name="truck" size={18} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: "700" }}>
                  Vehicle Transport
                </Text>
                <Text style={{ color: colors.mutedForeground, fontSize: 12, marginTop: 2 }}>
                  Track both legs · live GPS + mileage logs
                </Text>
              </View>
              <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
            </Pressable>
          )}

          {/* Inspections viewer */}
          {job.requiresGhostGarage && inspections && inspections.length > 0 && (
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>Inspections</Text>
              {inspections.map((insp) => (
                <View key={insp.id} style={{ paddingTop: 8, borderTopWidth: 1, borderColor: colors.border, marginTop: 8 }}>
                  <Text style={{ color: colors.primary, fontSize: 12, fontWeight: "700", letterSpacing: 0.5 }}>
                    {insp.kind.toUpperCase()}-INSPECTION  ·  {insp.mileage.toLocaleString()} mi
                  </Text>
                  {insp.notes ? (
                    <Text style={{ color: colors.foreground, fontSize: 13, marginTop: 4 }}>{insp.notes}</Text>
                  ) : null}
                  {insp.mediaUrls && insp.mediaUrls.length > 0 ? (
                    <Text style={{ color: colors.mutedForeground, fontSize: 12, marginTop: 6 }}>
                      {insp.mediaUrls.length} photo{insp.mediaUrls.length === 1 ? "" : "s"}
                    </Text>
                  ) : null}
                </View>
              ))}
            </View>
          )}

          {/* Mechanic Ghost Garage actions */}
          {isMechanic && job.mechanicId === user?.id && job.requiresGhostGarage &&
            ["ACCEPTED", "EN_ROUTE", "IN_PROGRESS"].includes(job.status) && (() => {
              const hasPre = inspections?.some((i) => i.kind === "pre");
              const hasPost = inspections?.some((i) => i.kind === "post");
              const canScheduleLift = !linkedBooking ||
                linkedBooking.status === "rejected" ||
                linkedBooking.status === "cancelled";
              return (
                <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Text style={[styles.cardTitle, { color: colors.foreground }]}>Ghost Garage</Text>
                  {linkedBooking ? (
                    <View style={[styles.bookingStatus, { backgroundColor: colors.background, borderColor: colors.border }]}>
                      <View style={{ flex: 1, gap: 3 }}>
                        <Text style={[styles.bookingStatusTitle, { color: colors.foreground }]}>
                          Bay request · {String(linkedBooking.status).toUpperCase()}
                        </Text>
                        <Text style={[styles.bookingStatusDetail, { color: colors.mutedForeground }]}>
                          {new Date(linkedBooking.startTime).toLocaleString()} · {linkedBooking.estimatedHours}h
                        </Text>
                        {linkedBooking.cancellationReason ? (
                          <Text style={[styles.bookingStatusReason, { color: colors.destructive }]}>
                            Reason: {linkedBooking.cancellationReason}
                          </Text>
                        ) : null}
                        {["pending", "reserved", "active"].includes(linkedBooking.status) ? (
                          <View style={styles.bookingActions}>
                            <Pressable
                              style={[styles.smallAction, { borderColor: colors.destructive }, cancelBookingMutation.isPending && { opacity: 0.6 }]}
                              onPress={() => { void handleCancelBooking(linkedBooking.id, false); }}
                              disabled={cancelBookingMutation.isPending}
                            >
                              <Text style={{ color: colors.destructive, fontSize: 12, fontWeight: "700" }}>Cancel</Text>
                            </Pressable>
                            {linkedBooking.status !== "active" ? (
                              <Pressable
                                style={[styles.smallAction, { borderColor: colors.primary }, cancelBookingMutation.isPending && { opacity: 0.6 }]}
                                onPress={() => { void handleCancelBooking(linkedBooking.id, true); }}
                                disabled={cancelBookingMutation.isPending}
                              >
                                <Text style={{ color: colors.primary, fontSize: 12, fontWeight: "700" }}>Reschedule</Text>
                              </Pressable>
                            ) : null}
                          </View>
                        ) : null}
                      </View>
                      {["rejected", "cancelled"].includes(String(linkedBooking.status)) ? (
                        <Pressable
                          style={[styles.smallAction, { borderColor: colors.primary }]}
                          onPress={() => openBaySearch(linkedBooking.status, linkedBooking.cancellationReason)}
                        >
                          <Text style={{ color: colors.primary, fontSize: 12, fontWeight: "700" }}>Try another bay</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  ) : null}
                  {canScheduleLift ? (
                    <Pressable
                      style={[styles.partsBtn, { backgroundColor: colors.secondary, borderColor: colors.border, marginTop: 0 }]}
                      onPress={() => router.push(`/bays/${job.id}`)}
                    >
                      <Feather name="home" size={16} color={colors.foreground} />
                      <Text style={[styles.partsBtnText, { color: colors.foreground }]}>Schedule Lift</Text>
                    </Pressable>
                  ) : null}
                  <Pressable
                    style={[styles.partsBtn, { backgroundColor: hasPre ? colors.muted : colors.primary + "18", borderColor: colors.primary + "44" }]}
                    onPress={() => router.push(`/inspection/${job.id}?kind=pre`)}
                  >
                    <Feather name={hasPre ? "check" : "camera"} size={16} color={colors.primary} />
                    <Text style={[styles.partsBtnText, { color: colors.primary }]}>
                      {hasPre ? "Pre-Inspection ✓" : "Capture Pre-Inspection"}
                    </Text>
                  </Pressable>
                  {hasPre && (
                    <Pressable
                      style={[styles.partsBtn, { backgroundColor: hasPost ? colors.muted : colors.primary + "18", borderColor: colors.primary + "44" }]}
                      onPress={() => router.push(`/inspection/${job.id}?kind=post`)}
                    >
                      <Feather name={hasPost ? "check" : "camera"} size={16} color={colors.primary} />
                      <Text style={[styles.partsBtnText, { color: colors.primary }]}>
                        {hasPost ? "Post-Inspection ✓" : "Capture Post-Inspection"}
                      </Text>
                    </Pressable>
                  )}
                </View>
              );
            })()}

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

          {isCustomer && (job.status === "PAID" || job.status === "COMPLETED") && (
            <Pressable
              style={[styles.flagBtn, { borderColor: colors.border, backgroundColor: colors.card, marginTop: 8 }]}
              onPress={() => router.push(`/job/${job.id}/invoice`)}
            >
              <Feather name="file-text" size={14} color={colors.primary} />
              <Text style={[styles.flagBtnText, { color: colors.primary }]}>View Invoice</Text>
            </Pressable>
          )}

          {(canFlagMechanic || canFlagCustomer) && (
            <Pressable
              style={[styles.flagBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
              onPress={() => handleFlag(isMechanic ? "customer" : "mechanic")}
              disabled={flagMutation.isPending}
            >
              <Feather name="flag" size={14} color="#EF4444" />
              <Text style={styles.flagBtnText}>
                Report {isMechanic ? "Customer" : "Mechanic"}
              </Text>
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
  textarea: { minHeight: 80, padding: 12, borderRadius: 10, borderWidth: 1, fontSize: 14 },
  flagBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, borderRadius: 12, borderWidth: 1, marginTop: 12 },
  flagBtnText: { color: "#EF4444", fontWeight: "600", fontSize: 13 },
  bookingStatus: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: 10, borderWidth: 1 },
  bookingStatusTitle: { fontSize: 13, fontWeight: "700" },
  bookingStatusDetail: { fontSize: 12 },
  bookingStatusReason: { fontSize: 12, lineHeight: 17 },
  bookingActions: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 5 },
  smallAction: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 7 },
});
