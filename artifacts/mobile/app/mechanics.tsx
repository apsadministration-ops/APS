import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator } from "react-native";
import { useColors } from "@/hooks/useColors";
import { Feather } from "@expo/vector-icons";
import { Stack, useRouter, useLocalSearchParams } from "expo-router";
import {
  useListMechanics, useAddFavorite, useRemoveFavorite,
  getListMechanicsQueryKey, MechanicSummary,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";

export default function MechanicsScreen() {
  const colors = useColors();
  const router = useRouter();
  const qc = useQueryClient();
  const params = useLocalSearchParams<{ select?: string; jobType?: string }>();
  const selectMode = params.select === "1";

  const queryParams = params.jobType ? { jobType: params.jobType as any } : undefined;
  const { data: mechanics, isLoading, refetch, isRefetching } = useListMechanics(queryParams);
  const addFav = useAddFavorite();
  const removeFav = useRemoveFavorite();

  const toggleFav = (m: MechanicSummary) => {
    try { Haptics.selectionAsync(); } catch { /* web */ }
    if (m.isFavorite) {
      removeFav.mutate({ mechanicId: m.id }, { onSuccess: () => qc.invalidateQueries({ queryKey: getListMechanicsQueryKey(queryParams) }) });
    } else {
      addFav.mutate({ data: { mechanicId: m.id } }, { onSuccess: () => qc.invalidateQueries({ queryKey: getListMechanicsQueryKey(queryParams) }) });
    }
  };

  const handlePick = (m: MechanicSummary) => {
    if (selectMode) {
      router.replace({ pathname: "/request-service", params: { mechanicId: String(m.id), mechanicName: m.name } });
    } else {
      router.push(`/mechanic/${m.id}`);
    }
  };

  const renderItem = ({ item }: { item: MechanicSummary }) => {
    const tierColor = item.mechanicTier === "master" ? "#F472B6"
      : item.mechanicTier === "senior" ? "#FBBF24"
      : item.mechanicTier === "technician" ? "#34D399"
      : "#60A5FA";
    return (
      <Pressable
        style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
        onPress={() => handlePick(item)}
      >
        <View style={[styles.avatar, { backgroundColor: tierColor + "30" }]}>
          <Text style={[styles.avatarText, { color: tierColor }]}>{item.name.charAt(0).toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <View style={styles.titleRow}>
            <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>{item.name}</Text>
            <Pressable onPress={() => toggleFav(item)} hitSlop={8}>
              <Feather
                name={item.isFavorite ? "heart" : "heart"}
                size={20}
                color={item.isFavorite ? "#EF4444" : colors.mutedForeground}
                style={item.isFavorite ? undefined : { opacity: 0.5 }}
              />
            </Pressable>
          </View>
          <View style={styles.metaRow}>
            {item.mechanicTier ? (
              <View style={[styles.tierPill, { backgroundColor: tierColor + "20", borderColor: tierColor }]}>
                <Text style={[styles.tierText, { color: tierColor }]}>{item.mechanicTier.toUpperCase()}</Text>
              </View>
            ) : null}
            {item.averageRating != null ? (
              <View style={styles.ratingRow}>
                <Feather name="star" size={12} color={colors.primary} />
                <Text style={[styles.ratingText, { color: colors.foreground }]}>
                  {item.averageRating.toFixed(1)} ({item.reviewCount})
                </Text>
              </View>
            ) : (
              <Text style={[styles.muted, { color: colors.mutedForeground }]}>No reviews yet</Text>
            )}
            <Text style={[styles.muted, { color: colors.mutedForeground }]}>· {item.completedJobs} jobs</Text>
            {item.flagCount > 0 ? (
              <View style={styles.flagPill}>
                <Feather name="flag" size={10} color="#EF4444" />
                <Text style={styles.flagText}>{item.flagCount}</Text>
              </View>
            ) : null}
          </View>
          {item.city ? (
            <Text style={[styles.muted, { color: colors.mutedForeground }]} numberOfLines={1}>
              <Feather name="map-pin" size={11} /> {item.city}{item.region ? `, ${item.region}` : ""}
            </Text>
          ) : null}
          {selectMode ? (
            <View style={[styles.pickBtn, { backgroundColor: colors.primary }]}>
              <Text style={styles.pickBtnText}>Pick this mechanic</Text>
            </View>
          ) : null}
        </View>
      </Pressable>
    );
  };

  return (
    <>
      <Stack.Screen options={{
        title: selectMode ? "Pick a Mechanic" : "Browse Mechanics",
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.foreground,
      }} />
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {isLoading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
        ) : (
          <FlatList
            data={mechanics ?? []}
            keyExtractor={(m) => String(m.id)}
            renderItem={renderItem}
            contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
            onRefresh={refetch}
            refreshing={isRefetching}
            ListEmptyComponent={
              <View style={[styles.empty, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Feather name="users" size={40} color={colors.mutedForeground} />
                <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No mechanics found</Text>
                <Text style={[styles.emptyDesc, { color: colors.mutedForeground }]}>
                  {params.jobType
                    ? `No mechanics available for ${params.jobType} right now.`
                    : "Check back later — mechanics are joining all the time."}
                </Text>
              </View>
            }
          />
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  card: { flexDirection: "row", gap: 12, padding: 14, borderWidth: 1, borderRadius: 14, marginBottom: 10 },
  avatar: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 20, fontWeight: "700" },
  titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  name: { fontSize: 16, fontWeight: "700", flex: 1 },
  metaRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 4 },
  tierPill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, borderWidth: 1 },
  tierText: { fontSize: 10, fontWeight: "700", letterSpacing: 0.5 },
  ratingRow: { flexDirection: "row", alignItems: "center", gap: 3 },
  ratingText: { fontSize: 12, fontWeight: "600" },
  muted: { fontSize: 12 },
  flagPill: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: "#EF444420" },
  flagText: { fontSize: 10, color: "#EF4444", fontWeight: "700" },
  pickBtn: { marginTop: 10, alignSelf: "flex-start", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  pickBtnText: { color: "white", fontWeight: "700", fontSize: 13 },
  empty: { padding: 40, alignItems: "center", borderWidth: 1, borderRadius: 14, borderStyle: "dashed", gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: "700" },
  emptyDesc: { fontSize: 13, textAlign: "center" },
});
