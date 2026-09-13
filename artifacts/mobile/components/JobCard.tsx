import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { Job } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { Feather } from "@expo/vector-icons";
import { Link } from "expo-router";
import { StatusBadge } from "./StatusBadge";
import { CommercialJobContext } from "@/components/partner/CommercialJobIntegration";

interface JobCardProps {
  job: Job;
  showCustomer?: boolean;
}

export function JobCard({ job, showCustomer = false }: JobCardProps) {
  const colors = useColors();

  return (
    <Link href={`/job/${job.id}`} asChild>
      <Pressable style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.header}>
          <View style={styles.titleRow}>
            <Text style={[styles.title, { color: colors.foreground }]} numberOfLines={1}>
              {job.vehicle?.make} {job.vehicle?.model}
            </Text>
            <StatusBadge status={job.status} />
          </View>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            {job.jobType.toUpperCase()}
          </Text>
          <CommercialJobContext job={job} compact />
        </View>

        <View style={styles.details}>
          <Text style={[styles.description, { color: colors.foreground }]} numberOfLines={2}>
            {job.description}
          </Text>
          
          <View style={styles.metaRow}>
            {showCustomer ? (
              <View style={styles.metaItem}>
                <Feather name="user" size={14} color={colors.mutedForeground} />
                <Text style={[styles.metaText, { color: colors.mutedForeground }]}>{job.customerName}</Text>
              </View>
            ) : (
              <View style={styles.metaItem}>
                <Feather name="tool" size={14} color={colors.mutedForeground} />
                <Text style={[styles.metaText, { color: colors.mutedForeground }]}>{job.mechanicName || "No mechanic yet"}</Text>
              </View>
            )}
            
            <View style={styles.metaItem}>
              <Feather name="calendar" size={14} color={colors.mutedForeground} />
              <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
                {new Date(job.createdAt).toLocaleDateString()}
              </Text>
            </View>
          </View>
        </View>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  header: {
    marginBottom: 12,
  },
  titleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  title: {
    fontSize: 16,
    fontWeight: "600",
    flex: 1,
    marginRight: 8,
  },
  subtitle: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.5,
  },
  details: {
    gap: 12,
  },
  description: {
    fontSize: 14,
    lineHeight: 20,
  },
  metaRow: {
    flexDirection: "row",
    gap: 16,
  },
  metaItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  metaText: {
    fontSize: 12,
    fontWeight: "500",
  },
});
