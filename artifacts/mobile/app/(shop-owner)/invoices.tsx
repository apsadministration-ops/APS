import React, { useMemo } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, RefreshControl, ScrollView } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { useListJobs, getListJobsQueryKey } from "@workspace/api-client-react";

function money(dollars: number | null | undefined) {
  if (dollars == null) return "—";
  return `$${Number(dollars).toFixed(2)}`;
}
function fmtDate(d: string | Date | null | undefined) {
  if (!d) return "";
  const x = new Date(d);
  return x.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function PartnerInvoicesScreen() {
  const colors = useColors();
  const router = useRouter();
  const { user } = useAuth();
  const enabled = !!user && user.role === "shop_owner";

  const { data: jobs, isLoading, refetch, isRefetching } = useListJobs(
    {},
    { query: { enabled, queryKey: getListJobsQueryKey() } },
  );

  const invoiceable = useMemo(
    () => (jobs ?? [])
      .filter((j: any) => j.status === "PAID" || j.status === "COMPLETED")
      .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [jobs],
  );

  // `Job.estimatedPrice` is in USD (not cents) per the OpenAPI contract.
  // For PAID jobs this is the canonical booked total; for COMPLETED-but-not-
  // yet-captured rows it's the customer-facing estimate that will be charged.
  const totalPaid = useMemo(
    () => invoiceable.filter((j: any) => j.status === "PAID").reduce((sum: number, j: any) => sum + (Number(j.estimatedPrice) || 0), 0),
    [invoiceable],
  );

  if (isLoading) {
    return <View style={[styles.center, { backgroundColor: colors.background }]}><ActivityIndicator color={colors.primary} /></View>;
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
    >
      <Text style={[styles.heading, { color: colors.foreground }]}>Invoices</Text>
      <Text style={[styles.sub, { color: colors.mutedForeground }]}>
        Receipts for jobs your partner accounts have paid. Tap any row for the full breakdown.
      </Text>

      <View style={[styles.kpi, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.kpiLabel, { color: colors.mutedForeground }]}>TOTAL PAID</Text>
          <Text style={[styles.kpiValue, { color: colors.foreground }]}>{money(totalPaid)}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.kpiLabel, { color: colors.mutedForeground }]}>INVOICES</Text>
          <Text style={[styles.kpiValue, { color: colors.foreground }]}>{invoiceable.length}</Text>
        </View>
      </View>

      {invoiceable.length === 0 ? (
        <View style={[styles.empty, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="file-text" size={36} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No invoices yet</Text>
          <Text style={[styles.emptyDesc, { color: colors.mutedForeground }]}>
            Completed and paid jobs will appear here. Post a job to get started.
          </Text>
        </View>
      ) : (
        <View style={{ gap: 10, marginTop: 12 }}>
          {invoiceable.map((j: any) => (
            <Pressable
              key={j.id}
              style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={() => router.push(`/job/${j.id}/invoice` as any)}
            >
              <View style={[styles.pill, { backgroundColor: (j.status === "PAID" ? "#22C55E" : "#3B82F6") + "1A" }]}>
                <Text style={[styles.pillText, { color: j.status === "PAID" ? "#15803D" : "#1D4ED8" }]}>{j.status}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowTitle, { color: colors.foreground }]} numberOfLines={1}>
                  Job #{j.id} · {j.jobType}
                </Text>
                <Text style={[styles.rowSub, { color: colors.mutedForeground }]} numberOfLines={1}>
                  {j.vin} · {fmtDate(j.createdAt)}
                </Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={[styles.rowAmount, { color: colors.foreground }]}>{money(j.estimatedPrice)}</Text>
                <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
              </View>
            </Pressable>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  heading: { fontSize: 22, fontWeight: "800" },
  sub: { fontSize: 13, marginTop: 4, marginBottom: 12, lineHeight: 18 },
  kpi: { flexDirection: "row", padding: 16, borderRadius: 14, borderWidth: 1, gap: 12, marginTop: 8 },
  kpiLabel: { fontSize: 10, fontWeight: "700", letterSpacing: 1 },
  kpiValue: { fontSize: 20, fontWeight: "800", marginTop: 4 },
  empty: { padding: 28, alignItems: "center", borderWidth: 1, borderStyle: "dashed", borderRadius: 14, marginTop: 16 },
  emptyTitle: { fontSize: 16, fontWeight: "700", marginTop: 10 },
  emptyDesc: { fontSize: 13, marginTop: 4, textAlign: "center", lineHeight: 18 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 12, borderWidth: 1 },
  pill: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  pillText: { fontSize: 10, fontWeight: "800", letterSpacing: 0.8 },
  rowTitle: { fontSize: 14, fontWeight: "700" },
  rowSub: { fontSize: 12, marginTop: 2 },
  rowAmount: { fontSize: 14, fontWeight: "800" },
});
