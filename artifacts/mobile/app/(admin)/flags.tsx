import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator } from "react-native";
import { useColors } from "@/hooks/useColors";
import { Feather } from "@expo/vector-icons";
import { useListFlags, useResolveFlag, getListFlagsQueryKey, Flag } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

const TYPE_COLOR: Record<string, string> = {
  scam: "#EF4444", rude: "#F59E0B", no_show: "#8B5CF6", unsafe: "#DC2626", other: "#6B7280",
};

export default function AdminFlagsScreen() {
  const colors = useColors();
  const qc = useQueryClient();
  const { data: flags, isLoading, refetch, isRefetching } = useListFlags();
  const resolveMutation = useResolveFlag();

  const handleResolve = (id: number) => {
    resolveMutation.mutate({ flagId: id }, {
      onSuccess: () => qc.invalidateQueries({ queryKey: getListFlagsQueryKey() }),
    });
  };

  const renderItem = ({ item }: { item: Flag }) => {
    const color = TYPE_COLOR[item.type] ?? colors.mutedForeground;
    return (
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: item.resolved ? colors.border : color }]}>
        <View style={styles.headerRow}>
          <View style={[styles.typePill, { backgroundColor: color + "20", borderColor: color }]}>
            <Feather name="flag" size={11} color={color} />
            <Text style={[styles.typeText, { color }]}>{item.type.replace("_", " ").toUpperCase()}</Text>
          </View>
          {item.resolved ? (
            <View style={[styles.resolvedPill, { backgroundColor: "#10B98120" }]}>
              <Feather name="check" size={11} color="#10B981" />
              <Text style={styles.resolvedText}>RESOLVED</Text>
            </View>
          ) : null}
        </View>
        <Text style={[styles.line, { color: colors.foreground }]}>
          <Text style={{ fontWeight: "700" }}>{item.reporterName}</Text>
          {" reported "}
          <Text style={{ fontWeight: "700" }}>{item.targetName}</Text>
          {" ("}{item.targetRole}{")"}
        </Text>
        {item.reason ? <Text style={[styles.reason, { color: colors.mutedForeground }]}>"{item.reason}"</Text> : null}
        {item.jobId ? <Text style={[styles.meta, { color: colors.mutedForeground }]}>Job #{item.jobId}</Text> : null}
        <Text style={[styles.meta, { color: colors.mutedForeground }]}>{new Date(item.createdAt).toLocaleString()}</Text>
        {!item.resolved ? (
          <Pressable
            style={[styles.resolveBtn, { backgroundColor: colors.primary }]}
            onPress={() => handleResolve(item.id)}
            disabled={resolveMutation.isPending}
          >
            <Text style={styles.resolveText}>Mark Resolved</Text>
          </Pressable>
        ) : null}
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={flags ?? []}
          keyExtractor={(f) => String(f.id)}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
          onRefresh={refetch}
          refreshing={isRefetching}
          ListEmptyComponent={
            <View style={[styles.empty, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Feather name="shield" size={40} color={colors.mutedForeground} />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No reports</Text>
              <Text style={[styles.emptyDesc, { color: colors.mutedForeground }]}>All clear — no user reports right now.</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  card: { padding: 14, borderWidth: 1, borderRadius: 12, marginBottom: 10, gap: 6 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  typePill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1 },
  typeText: { fontSize: 11, fontWeight: "700" },
  resolvedPill: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  resolvedText: { fontSize: 10, fontWeight: "700", color: "#10B981" },
  line: { fontSize: 14, marginTop: 4 },
  reason: { fontSize: 13, fontStyle: "italic" },
  meta: { fontSize: 11 },
  resolveBtn: { marginTop: 8, paddingVertical: 10, borderRadius: 8, alignItems: "center" },
  resolveText: { color: "white", fontWeight: "700", fontSize: 13 },
  empty: { padding: 40, alignItems: "center", borderWidth: 1, borderRadius: 14, borderStyle: "dashed", gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: "700" },
  emptyDesc: { fontSize: 13, textAlign: "center" },
});
