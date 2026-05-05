import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable, Image } from "react-native";
import { WorkLog } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { Feather } from "@expo/vector-icons";

export function WorkLogCard({ log }: { log: WorkLog }) {
  const colors = useColors();
  const [expanded, setExpanded] = useState(false);

  return (
    <Pressable
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
      onPress={() => setExpanded(!expanded)}
    >
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, { color: colors.foreground }]}>
            {log.serviceCategory.charAt(0).toUpperCase() + log.serviceCategory.slice(1)}
          </Text>
          <Text style={[styles.date, { color: colors.mutedForeground }]}>
            {new Date(log.createdAt).toLocaleDateString()}
          </Text>
        </View>
        <View style={styles.metaRow}>
          <Feather name="tool" size={12} color={colors.mutedForeground} />
          <Text style={[styles.mechanic, { color: colors.mutedForeground }]}>
            {log.mechanicName}
          </Text>
          <Text style={[styles.totalCost, { color: colors.primary }]}>
            ${log.totalCost.toFixed(2)}
          </Text>
        </View>
      </View>

      <Text style={[styles.description, { color: colors.foreground }]} numberOfLines={expanded ? undefined : 2}>
        {log.serviceDescription}
      </Text>

      {expanded && (
        <View style={styles.expandedContent}>
          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          <View style={styles.costRow}>
            <View style={styles.costItem}>
              <Text style={[styles.costLabel, { color: colors.mutedForeground }]}>Labor</Text>
              <Text style={[styles.costValue, { color: colors.foreground }]}>${log.laborCost.toFixed(2)}</Text>
            </View>
            <View style={styles.costItem}>
              <Text style={[styles.costLabel, { color: colors.mutedForeground }]}>Parts</Text>
              <Text style={[styles.costValue, { color: colors.foreground }]}>${log.partsCost.toFixed(2)}</Text>
            </View>
            <View style={styles.costItem}>
              <Text style={[styles.costLabel, { color: colors.primary }]}>Total</Text>
              <Text style={[styles.costValue, { color: colors.primary }]}>${log.totalCost.toFixed(2)}</Text>
            </View>
          </View>

          {log.partsUsed && log.partsUsed.length > 0 && (
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Parts Used</Text>
              <View style={styles.partsList}>
                {log.partsUsed.map((part: string, i: number) => (
                  <View key={i} style={[styles.partBadge, { backgroundColor: colors.secondary }]}>
                    <Text style={[styles.partText, { color: colors.secondaryForeground }]}>{part}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {log.notes ? (
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Notes</Text>
              <Text style={[styles.notesText, { color: colors.foreground }]}>{log.notes}</Text>
            </View>
          ) : null}

          {(log.beforeImages?.length > 0 || log.afterImages?.length > 0) ? (
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Photos</Text>
              <View style={styles.photosGrid}>
                {log.beforeImages?.map((url: string, i: number) => (
                  <View key={`b-${i}`} style={styles.photoContainer}>
                    <Image source={{ uri: url }} style={styles.photo} />
                    <View style={styles.photoLabel}>
                      <Text style={styles.photoLabelText}>Before</Text>
                    </View>
                  </View>
                ))}
                {log.afterImages?.map((url: string, i: number) => (
                  <View key={`a-${i}`} style={styles.photoContainer}>
                    <Image source={{ uri: url }} style={styles.photo} />
                    <View style={styles.photoLabel}>
                      <Text style={styles.photoLabelText}>After</Text>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          ) : null}
        </View>
      )}

      <View style={styles.expandHint}>
        <Feather name={expanded ? "chevron-up" : "chevron-down"} size={16} color={colors.mutedForeground} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  header: { marginBottom: 10 },
  titleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  title: { fontSize: 16, fontWeight: "700" },
  date: { fontSize: 12, fontWeight: "500" },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  mechanic: { fontSize: 12, fontWeight: "500", flex: 1 },
  totalCost: { fontSize: 15, fontWeight: "700" },
  description: { fontSize: 14, lineHeight: 20 },
  expandedContent: { marginTop: 14, gap: 14 },
  divider: { height: 1, width: "100%" },
  costRow: { flexDirection: "row", justifyContent: "space-around" },
  costItem: { alignItems: "center" },
  costLabel: { fontSize: 12, fontWeight: "600", marginBottom: 4 },
  costValue: { fontSize: 16, fontWeight: "700" },
  section: { gap: 8 },
  sectionTitle: { fontSize: 13, fontWeight: "700" },
  partsList: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  partBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  partText: { fontSize: 12, fontWeight: "500" },
  notesText: { fontSize: 14, lineHeight: 20, fontStyle: "italic" },
  photosGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  photoContainer: { width: 80, height: 80, borderRadius: 8, overflow: "hidden" },
  photo: { width: "100%", height: "100%" },
  photoLabel: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(0,0,0,0.6)",
    paddingVertical: 2,
    alignItems: "center",
  },
  photoLabelText: { color: "white", fontSize: 10, fontWeight: "600" },
  expandHint: { alignItems: "center", marginTop: 8 },
});
