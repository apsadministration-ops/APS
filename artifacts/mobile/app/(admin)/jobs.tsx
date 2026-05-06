import {
  View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator, RefreshControl, TextInput,
} from "react-native";
import { useColors } from "@/hooks/useColors";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { StatusBadge } from "@/components/StatusBadge";
import type { JobStatus } from "@workspace/api-client-react";
import { useState, useEffect, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { confirm, alertMessage } from "@/utils/confirm";

interface AdminJob {
  id: number;
  jobType: string;
  description: string;
  status: string;
  vin: string;
  customerName: string;
  mechanicName?: string;
  vehicle?: { year: number; make: string; model: string };
  createdAt: string;
  finalPrice?: number;
}

const STATUS_FILTERS = ["ALL", "REQUESTED", "ACCEPTED", "EN_ROUTE", "IN_PROGRESS", "COMPLETED", "PAID", "CANCELLED"];

export default function AdminJobsScreen() {
  const colors = useColors();
  const router = useRouter();
  const [jobs, setJobs] = useState<AdminJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const domain = process.env.EXPO_PUBLIC_DOMAIN;

  const fetchJobs = useCallback(async () => {
    try {
      const token = await AsyncStorage.getItem("auth_token");
      const res = await fetch(`https://${domain}/api/jobs`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setJobs(await res.json());
    } catch { /* non-fatal */ }
    finally { setLoading(false); setRefreshing(false); }
  }, [domain]);

  useEffect(() => { fetchJobs(); }, [fetchJobs]);

  const onRefresh = () => { setRefreshing(true); fetchJobs(); };

  const deleteJob = async (job: AdminJob) => {
    const ok = await confirm({
      title: "Delete job?",
      message: `Permanently remove job #${job.id} for ${job.customerName}? This cannot be undone and will also delete its messages, payments, and work logs.`,
      confirmText: "Delete",
      cancelText: "Cancel",
      destructive: true,
    });
    if (!ok) return;
    try {
      const token = await AsyncStorage.getItem("auth_token");
      const res = await fetch(`https://${domain}/api/jobs/${job.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alertMessage("Couldn't delete", body.error || `Server returned ${res.status}.`);
        return;
      }
      setJobs((prev) => prev.filter((j) => j.id !== job.id));
    } catch (e: any) {
      alertMessage("Couldn't delete", e?.message || "Network error");
    }
  };

  const filtered = jobs.filter((j) => {
    const matchStatus = statusFilter === "ALL" || j.status === statusFilter;
    const q = search.toLowerCase();
    const matchSearch = !search ||
      j.customerName?.toLowerCase().includes(q) ||
      j.mechanicName?.toLowerCase().includes(q) ||
      j.vin?.toLowerCase().includes(q) ||
      j.description?.toLowerCase().includes(q);
    return matchStatus && matchSearch;
  });

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Search */}
      <View style={[styles.searchWrap, { borderBottomColor: colors.border }]}>
        <View style={[styles.searchBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="search" size={16} color={colors.mutedForeground} />
          <TextInput
            style={[styles.searchInput, { color: colors.foreground }]}
            placeholder="Search by VIN, customer, mechanic…"
            placeholderTextColor={colors.mutedForeground}
            value={search}
            onChangeText={setSearch}
          />
        </View>
      </View>

      {/* Status filter scroll */}
      <FlatList
        horizontal
        data={STATUS_FILTERS}
        keyExtractor={(s) => s}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 10, gap: 8 }}
        style={[styles.filterList, { borderBottomColor: colors.border }]}
        renderItem={({ item }) => (
          <Pressable
            style={[
              styles.filterChip,
              {
                backgroundColor: statusFilter === item ? colors.primary : colors.card,
                borderColor: statusFilter === item ? colors.primary : colors.border,
              },
            ]}
            onPress={() => setStatusFilter(item)}
          >
            <Text style={[styles.filterChipText, { color: statusFilter === item ? "white" : colors.foreground }]}>
              {item}
            </Text>
          </Pressable>
        )}
      />

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} size="large" /></View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(j) => String(j.id)}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          contentContainerStyle={{ padding: 16, paddingBottom: 120, gap: 10 }}
          ListHeaderComponent={
            <Text style={[styles.count, { color: colors.mutedForeground }]}>
              {filtered.length} job{filtered.length !== 1 ? "s" : ""}
            </Text>
          }
          ListEmptyComponent={
            <View style={[styles.empty, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Feather name="briefcase" size={36} color={colors.mutedForeground} />
              <Text style={[styles.emptyText, { color: colors.foreground }]}>No jobs found</Text>
            </View>
          }
          renderItem={({ item: job }) => (
            <Pressable
              style={[styles.jobCard, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={() => router.push(`/job/${job.id}`)}
            >
              <View style={styles.jobHeader}>
                <View style={styles.jobMeta}>
                  <Text style={[styles.jobType, { color: colors.primary }]}>{job.jobType?.toUpperCase()}</Text>
                  <Text style={[styles.jobVehicle, { color: colors.foreground }]}>
                    {job.vehicle ? `${job.vehicle.year} ${job.vehicle.make} ${job.vehicle.model}` : job.vin}
                  </Text>
                </View>
                <View style={styles.headerRight}>
                  <StatusBadge status={job.status as JobStatus} />
                  <Pressable
                    onPress={(e) => { e.stopPropagation?.(); void deleteJob(job); }}
                    hitSlop={10}
                    style={[styles.deleteBtn, { backgroundColor: colors.destructive + "18", borderColor: colors.destructive + "55" }]}
                  >
                    <Feather name="trash-2" size={14} color={colors.destructive} />
                    <Text style={[styles.deleteBtnText, { color: colors.destructive }]}>Remove</Text>
                  </Pressable>
                </View>
              </View>
              <Text style={[styles.jobDesc, { color: colors.mutedForeground }]} numberOfLines={2}>
                {job.description}
              </Text>
              <View style={styles.jobFooter}>
                <View style={styles.footerItem}>
                  <Feather name="user" size={12} color={colors.mutedForeground} />
                  <Text style={[styles.footerText, { color: colors.mutedForeground }]}>{job.customerName}</Text>
                </View>
                {job.mechanicName && (
                  <View style={styles.footerItem}>
                    <Feather name="tool" size={12} color={colors.mutedForeground} />
                    <Text style={[styles.footerText, { color: colors.mutedForeground }]}>{job.mechanicName}</Text>
                  </View>
                )}
                {job.finalPrice != null && (
                  <View style={styles.footerItem}>
                    <Feather name="dollar-sign" size={12} color={colors.mutedForeground} />
                    <Text style={[styles.footerText, { color: colors.mutedForeground }]}>{job.finalPrice.toFixed(2)}</Text>
                  </View>
                )}
              </View>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  searchWrap: { padding: 12, borderBottomWidth: 1 },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
  },
  searchInput: { flex: 1, fontSize: 15 },
  filterList: { flexGrow: 0, borderBottomWidth: 1 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  filterChipText: { fontSize: 12, fontWeight: "600" },
  count: { fontSize: 13, marginBottom: 4 },
  jobCard: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 8 },
  jobHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  jobMeta: { flex: 1, gap: 2 },
  headerRight: { alignItems: "flex-end", gap: 6 },
  deleteBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 8, borderWidth: 1,
  },
  deleteBtnText: { fontSize: 12, fontWeight: "700" },
  jobType: { fontSize: 11, fontWeight: "700", letterSpacing: 0.5 },
  jobVehicle: { fontSize: 15, fontWeight: "700" },
  jobDesc: { fontSize: 13, lineHeight: 20 },
  jobFooter: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  footerItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  footerText: { fontSize: 12 },
  empty: { padding: 40, borderRadius: 16, borderWidth: 1, alignItems: "center", gap: 10 },
  emptyText: { fontSize: 16, fontWeight: "600" },
});
