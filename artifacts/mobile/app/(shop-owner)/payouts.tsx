import {
  ActivityIndicator,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Stack, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  beginBusinessOrganizationPayoutOnboarding,
  customFetch,
  getBusinessOrganizationPayoutLoginLink,
  getBusinessOrganizationPayoutStatus,
  type BusinessConnectLoginLinkResponse,
  type BusinessConnectOnboardingResponse,
  type BusinessConnectStatusResponse,
  useListPartnerOrganizations,
} from "@workspace/api-client-react";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { useSelectedPartnerOrganization } from "@/hooks/useSelectedPartnerOrganization";
import { businessDisplayName } from "@/lib/businessAccount";
import {
  partnerOrganizationSubtypeLabel,
  partnerOrganizationsQueryKey,
} from "@/lib/partnerOrganization";

type Summary = {
  window: string;
  captured: number;
  pending: number;
  tips: number;
  fees: number;
  refunded: number;
  jobCount: number;
};

type Buckets = Record<string, { count: number; total: number }>;

type JobRow = {
  id: number;
  jobId: number;
  status: string;
  mechanicPayout: number;
  createdAt: string;
  job: { jobType?: string; status?: string } | null;
};

type EventRow = {
  id: number;
  kind: string;
  amountCents: number | null;
  failureMessage: string | null;
  createdAt: string;
};

class BusinessPayoutError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "BusinessPayoutError";
  }
}

async function requestJson<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const apiPath = path.startsWith("/api/") ? path : `/api${path}`;
  return customFetch<T>(apiPath, { ...options, responseType: "json" });
}

function financialPath(path: string, organizationId: number, params = "") {
  const separator = params ? "&" : "";
  return `/payouts/${path}?organizationId=${organizationId}${separator}${params}`;
}

export default function BusinessPayoutsScreen() {
  const colors = useColors();
  const router = useRouter();
  const { user } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dataOrganizationId, setDataOrganizationId] = useState<number | null>(null);
  const [actionLoading, setActionLoading] = useState<"onboard" | "login" | null>(null);
  const [status, setStatus] = useState<BusinessConnectStatusResponse | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [buckets, setBuckets] = useState<Buckets>({});
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const loadSequence = useRef(0);

  const organizationsQuery = useListPartnerOrganizations({
    query: {
      enabled: !!user && user.role === "shop_owner",
      queryKey: partnerOrganizationsQueryKey(user?.id),
    },
  });
  const {
    selectedId,
    selectedOrganization,
    isSelectionReady,
    storageError: selectionStorageError,
  } = useSelectedPartnerOrganization(user?.id, organizationsQuery.data);

  const load = useCallback(async () => {
    if (!isSelectionReady || organizationsQuery.isLoading) return;
    if (!selectedId || !selectedOrganization) {
      loadSequence.current += 1;
      setDataOrganizationId(null);
      setStatus(null);
      setSummary(null);
      setBuckets({});
      setJobs([]);
      setEvents([]);
      setError(null);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    if (selectedOrganization.status !== "active") {
      loadSequence.current += 1;
      setDataOrganizationId(selectedOrganization.id);
      setStatus(null);
      setSummary(null);
      setBuckets({});
      setJobs([]);
      setEvents([]);
      setError(
        "This organization is inactive. Reactivate it from Organizations before managing payouts.",
      );
      setLoading(false);
      setRefreshing(false);
      return;
    }

    setError(null);
    setLoading(true);
    const organizationId = selectedOrganization.id;
    const requestSequence = ++loadSequence.current;
    setDataOrganizationId(null);
    const results = await Promise.allSettled([
      getBusinessOrganizationPayoutStatus(organizationId),
      requestJson<Summary>(financialPath("summary", organizationId, "window=month")),
      requestJson<Buckets>(financialPath("buckets", organizationId)),
      requestJson<JobRow[]>(financialPath("jobs", organizationId, "limit=20")),
      requestJson<EventRow[]>(financialPath("events", organizationId, "limit=20")),
    ]);

    if (requestSequence !== loadSequence.current) return;
    const failures: string[] = [];
    const [statusResult, summaryResult, bucketsResult, jobsResult, eventsResult] = results;
    if (statusResult.status === "fulfilled") setStatus(statusResult.value);
    else failures.push(errorMessage(statusResult.reason, "Unable to load payout connection status."));
    if (summaryResult.status === "fulfilled") setSummary(summaryResult.value);
    else failures.push(errorMessage(summaryResult.reason, "Unable to load business payout summary."));
    if (bucketsResult.status === "fulfilled") setBuckets(bucketsResult.value);
    else failures.push(errorMessage(bucketsResult.reason, "Unable to load payout status buckets."));
    if (jobsResult.status === "fulfilled") setJobs(Array.isArray(jobsResult.value) ? jobsResult.value : []);
    else failures.push(errorMessage(jobsResult.reason, "Unable to load business payout jobs."));
    if (eventsResult.status === "fulfilled") setEvents(Array.isArray(eventsResult.value) ? eventsResult.value : []);
    else failures.push(errorMessage(eventsResult.reason, "Unable to load business payout events."));
    setError(failures.length > 0 ? failures.join(" ") : null);
    setDataOrganizationId(organizationId);
    setLoading(false);
    setRefreshing(false);
  }, [
    isSelectionReady,
    organizationsQuery.isLoading,
    selectedId,
    selectedOrganization,
  ]);

  useEffect(() => {
    void load();
  }, [load]);

  const startOnboarding = async () => {
    if (!selectedOrganization || selectedOrganization.status !== "active") return;
    const organizationId = selectedOrganization.id;
    setActionLoading("onboard");
    setError(null);
    try {
      const response: BusinessConnectOnboardingResponse =
        await beginBusinessOrganizationPayoutOnboarding(organizationId, {});
      if (!response.url) {
        throw new BusinessPayoutError("The payout provider did not return an onboarding link.");
      }
      await Linking.openURL(response.url);
      await load();
    } catch (actionError) {
      setError(errorMessage(actionError, "Unable to start business payout onboarding."));
    } finally {
      setActionLoading(null);
    }
  };

  const openDashboard = async () => {
    if (!selectedOrganization || !status?.accountId) return;
    const organizationId = selectedOrganization.id;
    setActionLoading("login");
    setError(null);
    try {
      const response: BusinessConnectLoginLinkResponse =
        await getBusinessOrganizationPayoutLoginLink(organizationId);
      if (!response.url) {
        throw new BusinessPayoutError("The payout provider did not return a dashboard link.");
      }
      await Linking.openURL(response.url);
    } catch (actionError) {
      setError(errorMessage(actionError, "Unable to open the business payout dashboard."));
    } finally {
      setActionLoading(null);
    }
  };

  const refresh = () => {
    setRefreshing(true);
    void organizationsQuery.refetch();
    void load();
  };

  if (
    organizationsQuery.isLoading ||
    !isSelectionReady ||
    loading ||
    (selectedId != null && dataOrganizationId !== selectedId)
  ) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ title: "Business payouts" }} />
        <ActivityIndicator color={colors.primary} />
        <Text style={[styles.centerText, { color: colors.mutedForeground }]}>
          Loading business payout context…
        </Text>
      </View>
    );
  }

  if (organizationsQuery.error) {
    return (
      <EmptyContext
        colors={colors}
        title="Unable to load businesses"
        message={errorMessage(
          organizationsQuery.error,
          "The business list could not be loaded. Try again before opening payouts.",
        )}
        buttonLabel="Retry"
        onPress={() => {
          void organizationsQuery.refetch();
        }}
      />
    );
  }

  if (!selectedOrganization || !selectedId) {
    const hasOrganizations = (organizationsQuery.data?.length ?? 0) > 0;
    return (
      <EmptyContext
        colors={colors}
        title={hasOrganizations ? "Select a business first" : "Create a business first"}
        message={
          hasOrganizations
            ? "Business payouts are scoped to the selected organization. Choose one before continuing."
            : "Create an organization before setting up its company payout account."
        }
        buttonLabel={hasOrganizations ? "Select business" : "Create organization"}
        onPress={() => router.push("/(shop-owner)/organizations" as any)}
      />
    );
  }

  const business = selectedOrganization;
  const businessName = businessDisplayName(business);
  const legalName = business.legalName?.trim();
  const isInactive = business.status !== "active";

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: "Business payouts" }} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />
        }
      >
        <View style={[styles.headerCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.headerIcon, { backgroundColor: colors.primary + "18" }]}>
            <Feather name="briefcase" size={20} color={colors.primary} />
          </View>
          <View style={styles.headerCopy}>
            <Text style={[styles.eyebrow, { color: colors.mutedForeground }]}>SELECTED BUSINESS</Text>
            <Text testID="text-business-payouts-name" style={[styles.title, { color: colors.foreground }]}>
              {businessName}
            </Text>
            <Text testID="text-business-payouts-subtype" style={[styles.meta, { color: colors.primary }]}>
              {partnerOrganizationSubtypeLabel(business.subtype)}
            </Text>
            {legalName && legalName !== business.name ? (
              <Text testID="text-business-payouts-legal-name" style={[styles.meta, { color: colors.mutedForeground }]}>
                Legal name: {legalName}
              </Text>
            ) : null}
            <Text testID="text-business-payouts-contact" style={[styles.meta, { color: colors.mutedForeground }]}>
              Business contact: {business.contactName || "Not provided"}
            </Text>
            <Text style={[styles.meta, { color: colors.mutedForeground }]}>
              Administrator: {user?.name || "Current account"} · {user?.email || "Signed-in account"}
            </Text>
          </View>
        </View>

        {isInactive ? (
          <View style={[styles.notice, { backgroundColor: colors.destructive + "14", borderColor: colors.destructive }]}>
            <Feather name="lock" size={17} color={colors.destructive} />
            <View style={styles.noticeCopy}>
              <Text style={[styles.noticeTitle, { color: colors.destructive }]}>Payouts blocked</Text>
              <Text style={[styles.noticeText, { color: colors.destructive }]}>
                Reactivate this organization before onboarding or opening its payout dashboard.
              </Text>
              <Pressable
                testID="button-manage-inactive-business"
                accessibilityRole="button"
                onPress={() => router.push("/(shop-owner)/organizations" as any)}
                style={[styles.compactButton, { borderColor: colors.destructive }]}
              >
                <Text style={[styles.compactButtonText, { color: colors.destructive }]}>
                  Manage organization
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {error || selectionStorageError ? (
          <View testID="error-business-payouts" style={[styles.notice, { backgroundColor: colors.destructive + "14", borderColor: colors.destructive }]}>
            <Feather name="alert-circle" size={17} color={colors.destructive} />
            <Text style={[styles.noticeText, { color: colors.destructive }]}>
              {error ?? selectionStorageError}
            </Text>
          </View>
        ) : null}

        <View style={[styles.connectCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionHeaderCopy}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Company payout account</Text>
              <Text style={[styles.sectionHint, { color: colors.mutedForeground }]}>
                This Stripe Connect account belongs to {businessName}, not to the administrator's personal account.
              </Text>
            </View>
            <View style={[styles.statusPill, { backgroundColor: status?.ready ? colors.primary + "20" : colors.secondary }]}>
              <Text style={[styles.statusPillText, { color: status?.ready ? colors.primary : colors.foreground }]}>
                {!status ? "Unavailable" : status.ready ? "Ready" : status.accountId ? "Needs setup" : "Not connected"}
              </Text>
            </View>
          </View>
          <View style={styles.statusRows}>
            <StatusRow label="Charges enabled" value={status?.chargesEnabled === true} colors={colors} />
            <StatusRow label="Payouts enabled" value={status?.payoutsEnabled === true} colors={colors} />
            <StatusRow label="Details submitted" value={status?.detailsSubmitted === true} colors={colors} />
          </View>
          {status && !status.accountId ? (
            <View
              testID="notice-business-payouts-legacy"
              style={[styles.legacyNotice, { backgroundColor: colors.secondary }]}
            >
              <Feather name="shield" size={16} color={colors.primary} />
              <Text style={[styles.noticeText, { color: colors.foreground }]}>
                Legacy administrator or mechanic payout accounts are not used for this business.
                Set up a separate company account instead.
              </Text>
            </View>
          ) : null}
          {!isInactive && status && !status.accountId ? (
            <Pressable
              testID="button-business-payouts-onboard"
              accessibilityRole="button"
              onPress={() => void startOnboarding()}
              disabled={actionLoading !== null}
              style={[styles.primaryButton, { backgroundColor: colors.primary, opacity: actionLoading ? 0.6 : 1 }]}
            >
              {actionLoading === "onboard" ? (
                <ActivityIndicator color={colors.primaryForeground} />
              ) : (
                <>
                  <Feather name="credit-card" size={17} color={colors.primaryForeground} />
                  <Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>
                    Set up company payouts
                  </Text>
                </>
              )}
            </Pressable>
          ) : null}
          {!isInactive && status?.accountId ? (
            <Pressable
              testID="button-business-payouts-dashboard"
              accessibilityRole="button"
              onPress={() => void openDashboard()}
              disabled={actionLoading !== null}
              style={[styles.outlineButton, { borderColor: colors.primary, opacity: actionLoading ? 0.6 : 1 }]}
            >
              {actionLoading === "login" ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <>
                  <Feather name="external-link" size={17} color={colors.primary} />
                  <Text style={[styles.outlineButtonText, { color: colors.primary }]}>
                    Open company payout dashboard
                  </Text>
                </>
              )}
            </Pressable>
          ) : null}
        </View>

        <View style={[styles.financialCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionHeaderCopy}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Business payout activity</Text>
              <Text style={[styles.sectionHint, { color: colors.mutedForeground }]}>
                Financial data is scoped to this organization and its explicitly linked locations.
              </Text>
            </View>
            <Text style={[styles.windowLabel, { color: colors.primary }]}>Last 30 days</Text>
          </View>
          {summary ? (
            <View style={styles.summaryGrid}>
              <Metric label="Captured" value={money(summary.captured)} colors={colors} />
              <Metric label="Pending" value={money(summary.pending)} colors={colors} />
              <Metric label="Tips" value={money(summary.tips)} colors={colors} />
              <Metric label="Jobs" value={String(summary.jobCount)} colors={colors} />
            </View>
          ) : (
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              Business payout summary is unavailable until the selected organization context loads.
            </Text>
          )}
          <Text style={[styles.subsectionTitle, { color: colors.foreground }]}>Status</Text>
          {Object.keys(buckets).length > 0 ? (
            <View style={styles.bucketGrid}>
              {Object.entries(buckets).map(([key, value]) => (
                <View key={key} style={[styles.bucket, { borderColor: colors.border }]}>
                  <Text style={[styles.bucketLabel, { color: colors.mutedForeground }]}>
                    {key.replace(/_/g, " ")}
                  </Text>
                  <Text style={[styles.bucketValue, { color: colors.foreground }]}>{value.count}</Text>
                  <Text style={[styles.bucketTotal, { color: colors.mutedForeground }]}>
                    {money(value.total)}
                  </Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              No business payout buckets are available.
            </Text>
          )}
        </View>

        <View style={[styles.activityCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Recent business payouts</Text>
          {jobs.length > 0 ? jobs.map((job) => (
            <View key={job.id} style={[styles.activityRow, { borderColor: colors.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.activityTitle, { color: colors.foreground }]}>
                  Job #{job.jobId} · {job.job?.jobType || "Service"}
                </Text>
                <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                  {new Date(job.createdAt).toLocaleDateString()} · {job.status}
                </Text>
              </View>
              <Text style={[styles.activityAmount, { color: colors.foreground }]}>
                {money(job.mechanicPayout)}
              </Text>
            </View>
          )) : (
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              No business payout jobs yet.
            </Text>
          )}
          <Text style={[styles.sectionTitle, { color: colors.foreground, marginTop: 20 }]}>Recent activity</Text>
          {events.length > 0 ? events.map((event) => (
            <View key={event.id} style={[styles.activityRow, { borderColor: colors.border }]}>
              <Feather name={event.kind.includes("failed") ? "alert-circle" : "activity"} size={16} color={colors.mutedForeground} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.activityTitle, { color: colors.foreground }]}>
                  {event.kind.replace(/_/g, " ")}
                </Text>
                {event.failureMessage ? (
                  <Text style={[styles.meta, { color: colors.destructive }]}>{event.failureMessage}</Text>
                ) : null}
                <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                  {new Date(event.createdAt).toLocaleString()}
                </Text>
              </View>
              {event.amountCents != null ? (
                <Text style={[styles.activityAmount, { color: colors.foreground }]}>
                  {money(event.amountCents / 100)}
                </Text>
              ) : null}
            </View>
          )) : (
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              No business payout events yet.
            </Text>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof BusinessPayoutError && error.message.trim()) return error.message;
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

function money(value: number) {
  return `$${Number.isFinite(value) ? value.toFixed(2) : "0.00"}`;
}

function StatusRow({
  label,
  value,
  colors,
}: {
  label: string;
  value: boolean;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={styles.statusRow}>
      <Text style={[styles.meta, { color: colors.mutedForeground }]}>{label}</Text>
      <View style={styles.statusValue}>
        <Feather name={value ? "check-circle" : "circle"} size={15} color={value ? colors.primary : colors.mutedForeground} />
        <Text style={[styles.meta, { color: value ? colors.primary : colors.mutedForeground }]}>
          {value ? "Yes" : "Not yet"}
        </Text>
      </View>
    </View>
  );
}

function Metric({
  label,
  value,
  colors,
}: {
  label: string;
  value: string;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={styles.metric}>
      <Text style={[styles.meta, { color: colors.mutedForeground }]}>{label}</Text>
      <Text style={[styles.metricValue, { color: colors.foreground }]}>{value}</Text>
    </View>
  );
}

function EmptyContext({
  colors,
  title,
  message,
  buttonLabel,
  onPress,
}: {
  colors: ReturnType<typeof useColors>;
  title: string;
  message: string;
  buttonLabel: string;
  onPress: () => void;
}) {
  return (
    <View style={[styles.center, styles.contextEmpty, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: "Business payouts" }} />
      <View style={[styles.emptyIcon, { backgroundColor: colors.secondary }]}>
        <Feather name="briefcase" size={26} color={colors.primary} />
      </View>
      <Text style={[styles.emptyTitle, { color: colors.foreground }]}>{title}</Text>
      <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>{message}</Text>
      <Pressable
        testID="button-business-payouts-context"
        accessibilityRole="button"
        onPress={onPress}
        style={[styles.primaryButton, { backgroundColor: colors.primary }]}
      >
        <Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>{buttonLabel}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, paddingBottom: 120, gap: 12 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  centerText: { fontSize: 13, marginTop: 10 },
  contextEmpty: { gap: 10 },
  headerCard: { flexDirection: "row", alignItems: "flex-start", gap: 12, padding: 14, borderRadius: 14, borderWidth: 1 },
  headerIcon: { width: 40, height: 40, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  headerCopy: { flex: 1, gap: 2 },
  eyebrow: { fontSize: 10, fontWeight: "800", letterSpacing: 0.8 },
  title: { fontSize: 19, fontWeight: "800" },
  meta: { fontSize: 12, lineHeight: 17 },
  notice: { flexDirection: "row", alignItems: "flex-start", gap: 9, padding: 12, borderRadius: 12, borderWidth: 1 },
  noticeCopy: { flex: 1, gap: 2 },
  noticeTitle: { fontSize: 13, fontWeight: "800" },
  noticeText: { flex: 1, fontSize: 12, lineHeight: 17 },
  legacyNotice: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 10, borderRadius: 10 },
  connectCard: { padding: 15, borderRadius: 14, borderWidth: 1, gap: 12 },
  sectionHeader: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  sectionHeaderCopy: { flex: 1, gap: 3 },
  sectionTitle: { fontSize: 16, fontWeight: "800" },
  sectionHint: { fontSize: 12, lineHeight: 17 },
  statusPill: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5 },
  statusPillText: { fontSize: 11, fontWeight: "800" },
  statusRows: { gap: 8 },
  statusRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  statusValue: { flexDirection: "row", alignItems: "center", gap: 5 },
  primaryButton: { minHeight: 48, borderRadius: 12, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8, paddingHorizontal: 14 },
  primaryButtonText: { fontSize: 14, fontWeight: "800" },
  outlineButton: { minHeight: 48, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8, paddingHorizontal: 14 },
  outlineButtonText: { fontSize: 14, fontWeight: "800" },
  compactButton: { alignSelf: "flex-start", borderRadius: 8, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 7, marginTop: 4 },
  compactButtonText: { fontSize: 12, fontWeight: "800" },
  financialCard: { padding: 15, borderRadius: 14, borderWidth: 1, gap: 10 },
  windowLabel: { fontSize: 11, fontWeight: "700" },
  summaryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  metric: { width: "47%", padding: 10, borderRadius: 10, backgroundColor: "transparent" },
  metricValue: { fontSize: 19, fontWeight: "800", marginTop: 2 },
  subsectionTitle: { fontSize: 14, fontWeight: "800", marginTop: 7 },
  bucketGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  bucket: { width: "31%", minWidth: 88, padding: 9, borderRadius: 10, borderWidth: 1 },
  bucketLabel: { fontSize: 11, textTransform: "capitalize" },
  bucketValue: { fontSize: 15, fontWeight: "800", marginTop: 3 },
  bucketTotal: { fontSize: 11, marginTop: 1 },
  activityCard: { padding: 15, borderRadius: 14, borderWidth: 1 },
  activityRow: { flexDirection: "row", alignItems: "center", gap: 9, paddingVertical: 11, borderBottomWidth: 1 },
  activityTitle: { fontSize: 13, fontWeight: "700" },
  activityAmount: { fontSize: 13, fontWeight: "800" },
  emptyIcon: { width: 56, height: 56, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  emptyTitle: { fontSize: 18, fontWeight: "800", textAlign: "center" },
  emptyText: { fontSize: 13, lineHeight: 19, textAlign: "center" },
});