import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator, RefreshControl, Pressable,
} from "react-native";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import {
  useListMyBookings, getListMyBookingsQueryKey,
  useCancelBayBooking,
  useListMyShops, getListMyShopsQueryKey, getGetShopQueryOptions, getGetShopQueryKey,
  getListAvailableBaysQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient, useQueries } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import { confirm, alertMessage } from "@/utils/confirm";
import { useState } from "react";

const STATUS_COLOR: Record<string, string> = {
  reserved: "#F59E0B",
  active: "#0EA5E9",
  completed: "#22C55E",
  cancelled: "#EF4444",
};

export default function ShopOwnerBookingsScreen() {
  const colors = useColors();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const enabled = !!user && user.role === "shop_owner";
  const { data: bookings, isLoading, refetch, isRefetching } = useListMyBookings({
    query: { enabled, queryKey: getListMyBookingsQueryKey() },
  });
  const { data: shops } = useListMyShops({
    query: { enabled, queryKey: getListMyShopsQueryKey() },
  });
  const shopDetailQueries = useQueries({
    queries: (shops ?? []).map((shop) =>
      getGetShopQueryOptions(shop.id, {
        query: { enabled, queryKey: getGetShopQueryKey(shop.id) },
      }),
    ),
  });
  const cancelMutation = useCancelBayBooking();
  const [selectedLocationId, setSelectedLocationId] = useState<number | null>(null);

  const onCancel = async (bookingId: number) => {
    const ok = await confirm({
      title: "Cancel booking?",
      message: "The mechanic will be notified.",
      confirmText: "Cancel Booking",
      destructive: true,
    });
    if (!ok) return;
    cancelMutation.mutate(
      { bookingId, data: { reason: "Cancelled by shop owner" } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListMyBookingsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListAvailableBaysQueryKey() });
          void alertMessage("Cancelled", "The booking has been cancelled.");
        },
        onError: (e: any) => void alertMessage("Couldn't cancel", e?.message ?? "Try again."),
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

  const sorted = (bookings ?? []).slice().sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
  const shopById = new Map((shops ?? []).map((shop) => [shop.id, shop]));
  const bayById = new Map(
    shopDetailQueries.flatMap((query) => query.data?.bays ?? []).map((bay) => [bay.id, bay]),
  );
  const visibleBookings = selectedLocationId == null
    ? sorted
    : sorted.filter((booking) => booking.shopId === selectedLocationId);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
      >
        <Text style={[styles.heading, { color: colors.foreground }]}>Bay Bookings</Text>
        <Text style={[styles.sub, { color: colors.mutedForeground }]}>
          All reservations across your shops.
        </Text>

        {shops && shops.length > 0 ? (
          <View style={[styles.filterCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.filterLabel, { color: colors.mutedForeground }]}>LOCATION</Text>
            <View style={styles.filterRow}>
              <Pressable
                testID="button-filter-bookings-all"
                accessibilityRole="button"
                onPress={() => setSelectedLocationId(null)}
                style={[
                  styles.filterChip,
                  {
                    backgroundColor: selectedLocationId == null ? colors.primary : colors.background,
                    borderColor: selectedLocationId == null ? colors.primary : colors.border,
                  },
                ]}
              >
                <Text style={{ color: selectedLocationId == null ? "white" : colors.foreground, fontWeight: "700", fontSize: 12 }}>
                  All locations
                </Text>
              </Pressable>
              {shops.map((shop) => {
                const selected = selectedLocationId === shop.id;
                return (
                  <Pressable
                    key={shop.id}
                    testID={`button-filter-bookings-location-${shop.id}`}
                    accessibilityRole="button"
                    accessibilityLabel={`Show bookings for ${shop.name}`}
                    onPress={() => setSelectedLocationId(shop.id)}
                    style={[
                      styles.filterChip,
                      {
                        backgroundColor: selected ? colors.primary : colors.background,
                        borderColor: selected ? colors.primary : colors.border,
                      },
                    ]}
                  >
                    <Text numberOfLines={1} style={{ color: selected ? "white" : colors.foreground, fontWeight: "700", fontSize: 12 }}>
                      {shop.name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={[styles.filterHint, { color: colors.mutedForeground }]}>
              Bookings retain the shop and bay captured by the existing reservation records.
            </Text>
          </View>
        ) : null}

        {visibleBookings.length === 0 ? (
          <View style={[styles.empty, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="calendar" size={42} color={colors.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
              {selectedLocationId == null ? "No bookings yet" : "No bookings for this location"}
            </Text>
            <Text style={[styles.emptyDesc, { color: colors.mutedForeground }]}>
              {selectedLocationId == null
                ? "When mechanics book a bay you'll see it here."
                : "Try All locations or choose another physical location."}
            </Text>
          </View>
        ) : (
          <View style={{ gap: 10, marginTop: 8 }}>
            {visibleBookings.map((b) => {
              const dot = STATUS_COLOR[b.status] ?? colors.mutedForeground;
              const shopName = shopById.get(b.shopId)?.name ?? `Location #${b.shopId}`;
              const bayName = bayById.get(b.bayId)?.name ?? `Bay #${b.bayId}`;
              return (
                <View key={b.id} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View style={styles.row}>
                    <Text style={[styles.cardTitle, { color: colors.foreground }]}>Booking #{b.id}</Text>
                    <View style={[styles.badge, { backgroundColor: dot + "20" }]}>
                      <View style={[styles.badgeDot, { backgroundColor: dot }]} />
                      <Text style={[styles.badgeText, { color: dot }]}>{b.status}</Text>
                    </View>
                  </View>
                  <Text style={[styles.line, { color: colors.mutedForeground }]}>
                    Location: {shopName} · Workspace: {bayName}
                  </Text>
                  <Text style={[styles.line, { color: colors.mutedForeground }]}>
                    Job #{b.jobId}
                  </Text>
                  <Text style={[styles.line, { color: colors.foreground }]}>
                    Booked interval: {new Date(b.startTime).toLocaleString()} → {new Date(b.estimatedEndTime).toLocaleString()}
                  </Text>
                  <Text style={[styles.line, { color: colors.mutedForeground }]}>
                    Rate ${b.hourlyRateSnapshot.toFixed(2)}/hr · est. {b.estimatedHours}h
                    {b.totalCost != null ? ` · billed $${b.totalCost.toFixed(2)}` : ""}
                  </Text>
                  {b.cancellationReason ? (
                    <Text style={[styles.line, { color: colors.destructive }]}>
                      Reason: {b.cancellationReason}
                    </Text>
                  ) : null}

                  {(b.status === "reserved" || b.status === "active") && (
                    <Pressable
                      style={[styles.cancelBtn, { borderColor: colors.destructive }]}
                      onPress={() => onCancel(b.id)}
                      disabled={cancelMutation.isPending}
                    >
                      <Feather name="x-circle" size={14} color={colors.destructive} />
                      <Text style={[styles.cancelBtnText, { color: colors.destructive }]}>Cancel</Text>
                    </Pressable>
                  )}
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  heading: { fontSize: 22, fontWeight: "800" },
  sub: { fontSize: 13, marginTop: 4, lineHeight: 18 },
  filterCard: { padding: 12, borderRadius: 13, borderWidth: 1, marginTop: 14, gap: 7 },
  filterLabel: { fontSize: 10, fontWeight: "800", letterSpacing: 0.8 },
  filterRow: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  filterChip: { maxWidth: 180, borderRadius: 8, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 8 },
  filterHint: { fontSize: 11, lineHeight: 16 },
  empty: { padding: 28, alignItems: "center", borderWidth: 1, borderStyle: "dashed", borderRadius: 14, marginTop: 16 },
  emptyTitle: { fontSize: 16, fontWeight: "700", marginTop: 12 },
  emptyDesc: { fontSize: 13, marginTop: 4, textAlign: "center" },
  card: { padding: 14, borderRadius: 14, borderWidth: 1, gap: 4 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardTitle: { fontSize: 15, fontWeight: "700" },
  line: { fontSize: 13, lineHeight: 18 },
  badge: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  badgeDot: { width: 6, height: 6, borderRadius: 3 },
  badgeText: { fontSize: 11, fontWeight: "700", textTransform: "uppercase" },
  cancelBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 6, height: 36, borderRadius: 8, borderWidth: 1, marginTop: 8, alignSelf: "flex-start",
    paddingHorizontal: 12,
  },
  cancelBtnText: { fontSize: 12, fontWeight: "700" },
});
