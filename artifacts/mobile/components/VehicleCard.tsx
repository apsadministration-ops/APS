import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { VehicleWithOwnership } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { Feather } from "@expo/vector-icons";
import { Link } from "expo-router";

export function VehicleCard({ vehicle }: { vehicle: VehicleWithOwnership }) {
  const colors = useColors();

  return (
    <Link href={`/vehicle/${vehicle.id}`} asChild>
      <Pressable style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.iconContainer}>
          <View style={[styles.iconBox, { backgroundColor: colors.secondary }]}>
            <Feather name="truck" size={24} color={colors.foreground} />
          </View>
        </View>
        
        <View style={styles.info}>
          <Text style={[styles.title, { color: colors.foreground }]}>
            {vehicle.year} {vehicle.make} {vehicle.model}
          </Text>
          <Text style={[styles.vin, { color: colors.mutedForeground }]}>
            VIN: {vehicle.vin}
          </Text>
          
          <View style={styles.metaRow}>
            {vehicle.serviceCount !== undefined && (
              <View style={[styles.badge, { backgroundColor: colors.secondary }]}>
                <Feather name="tool" size={12} color={colors.secondaryForeground} />
                <Text style={[styles.badgeText, { color: colors.secondaryForeground }]}>
                  {vehicle.serviceCount} Services
                </Text>
              </View>
            )}
            {!vehicle.isCurrentUserOwner && (
              <View style={[styles.badge, { backgroundColor: colors.destructive + '20' }]}>
                <Text style={[styles.badgeText, { color: colors.destructive }]}>
                  Not Owner
                </Text>
              </View>
            )}
          </View>
        </View>
        
        <Feather name="chevron-right" size={20} color={colors.mutedForeground} />
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
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  iconContainer: {
    justifyContent: "center",
  },
  iconBox: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  info: {
    flex: 1,
    gap: 4,
  },
  title: {
    fontSize: 16,
    fontWeight: "600",
  },
  vin: {
    fontSize: 12,
    fontFamily: "monospace",
  },
  metaRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 4,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: "600",
  },
});
