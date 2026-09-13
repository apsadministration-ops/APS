import { Feather } from "@expo/vector-icons";
import type { Job } from "@workspace/api-client-react";
import { StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";

type CommercialJobMetadata = Pick<Job, "partnerKindSnapshot" | "urgency">;

const SOURCE_LABELS = {
  dealership: "Dealership",
  fleet: "Fleet",
} as const;

const URGENCY_LABELS = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
} as const;

function sourceLabel(source: CommercialJobMetadata["partnerKindSnapshot"]) {
  return source === "dealership" || source === "fleet" ? SOURCE_LABELS[source] : null;
}

function urgencyColor(
  urgency: CommercialJobMetadata["urgency"],
  colors: ReturnType<typeof useColors>,
) {
  switch (urgency) {
    case "urgent":
      return colors.destructive;
    case "high":
      return colors.primary;
    default:
      return colors.mutedForeground;
  }
}

export type CommercialJobContextProps = {
  /**
   * The normal APS job (or a structurally compatible linked-job projection).
   * Only the public source snapshot and urgency are rendered here.
   */
  job: CommercialJobMetadata;
  compact?: boolean;
};

/**
 * Shared commercial context for normal APS jobs.
 *
 * This intentionally exposes no organization contact details, inventory
 * identifiers, or internal request notes. A null/consumer source is omitted
 * so existing customer jobs retain their current presentation.
 */
export function CommercialJobContext({ job, compact = false }: CommercialJobContextProps) {
  const colors = useColors();
  const source = sourceLabel(job.partnerKindSnapshot);

  if (!source) return null;

  const priorityColor = urgencyColor(job.urgency, colors);
  const urgencyLabel = URGENCY_LABELS[job.urgency];

  return (
    <View
      accessibilityLabel={`${source} job, ${urgencyLabel} urgency`}
      style={[styles.container, compact && styles.compactContainer]}
    >
      <View
        style={[
          styles.pill,
          { backgroundColor: colors.primary + "14", borderColor: colors.primary + "55" },
        ]}
      >
        <Feather name="briefcase" size={compact ? 11 : 13} color={colors.primary} />
        <Text style={[styles.pillText, { color: colors.primary }]}>{source}</Text>
      </View>
      <View
        style={[
          styles.pill,
          { backgroundColor: priorityColor + "14", borderColor: priorityColor + "55" },
        ]}
      >
        <Feather
          name={job.urgency === "urgent" || job.urgency === "high" ? "alert-circle" : "clock"}
          size={compact ? 11 : 13}
          color={priorityColor}
        />
        <Text style={[styles.pillText, { color: priorityColor }]}>
          {compact ? urgencyLabel : `${urgencyLabel} urgency`}
        </Text>
      </View>
    </View>
  );
}

// Keep a descriptive integration name available to job-detail consumers while
// the context component remains the canonical export.
export const CommercialJobIntegration = CommercialJobContext;

const styles = StyleSheet.create({
  container: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 7 },
  compactContainer: { gap: 5 },
  pill: {
    alignItems: "center",
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  pillText: { fontSize: 11, fontWeight: "700" },
});