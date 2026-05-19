import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useColors } from "@/hooks/useColors";

type Source = "consumer" | "fleet" | "commercial" | null | undefined;
type Priority = "standard" | "priority" | "urgent" | null | undefined;

interface Props {
  sourceType?: Source;
  priority?: Priority;
}

/**
 * Tiny pill set the mechanic sees on each job card / detail header.
 * Intentionally minimal — never renders for consumer jobs, so the
 * customer-only flow is visually identical to before.
 */
export function SourceBadge({ sourceType, priority }: Props) {
  const colors = useColors();
  if (!sourceType || sourceType === "consumer") return null;

  const isCommercial = sourceType === "commercial";
  const label = isCommercial ? "COMMERCIAL" : "FLEET";
  const sourceBg = isCommercial ? "#7C3AED" : "#0EA5E9";

  const priorityColor =
    priority === "urgent" ? "#DC2626" :
    priority === "priority" ? "#F59E0B" :
    null;

  return (
    <View style={styles.row}>
      <View style={[styles.pill, { backgroundColor: sourceBg }]}>
        <Text style={styles.pillText}>{label}</Text>
      </View>
      {priorityColor ? (
        <View style={[styles.pill, { backgroundColor: priorityColor, marginLeft: 6 }]}>
          <Text style={styles.pillText}>{(priority ?? "").toUpperCase()}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  pillText: { color: "#FFFFFF", fontSize: 10, fontWeight: "700", letterSpacing: 0.6 },
});
