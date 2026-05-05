import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useColors } from "@/hooks/useColors";
import { JobStatus } from "@workspace/api-client-react";

export function StatusBadge({ status }: { status: JobStatus }) {
  const colors = useColors();
  
  let bgColor = colors.muted;
  let textColor = colors.mutedForeground;

  switch (status) {
    case "REQUESTED":
      bgColor = colors.secondary;
      textColor = colors.secondaryForeground;
      break;
    case "OFFERED":
      bgColor = "#DBEAFE"; // light blue
      textColor = "#1E40AF"; // dark blue
      break;
    case "ACCEPTED":
    case "EN_ROUTE":
    case "IN_PROGRESS":
      bgColor = "#FEF3C7"; // light amber
      textColor = "#9A3412"; // dark amber
      if (colors.background !== "#ffffff") {
        bgColor = "#78350F"; 
        textColor = "#FEF3C7";
      }
      break;
    case "COMPLETED":
    case "PAID":
      bgColor = "#DCFCE7"; // light green
      textColor = "#166534"; // dark green
      if (colors.background !== "#ffffff") {
        bgColor = "#064E3B";
        textColor = "#DCFCE7";
      }
      break;
    case "CANCELLED":
      bgColor = colors.destructive;
      textColor = colors.destructiveForeground;
      break;
  }

  return (
    <View style={[styles.badge, { backgroundColor: bgColor }]}>
      <Text style={[styles.text, { color: textColor }]}>
        {status.replace("_", " ")}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    alignSelf: "flex-start",
  },
  text: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
});
