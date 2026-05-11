/**
 * Simple, mobile-first vehicle diagram with clickable hot zones.
 *
 * Intentionally NOT photorealistic — we want fast, clean, and instantly
 * recognizable. Each hot zone fires `onComponentTap(componentKey)` which the
 * parent uses to fetch quick-lookup specs from
 * /api/mechanic/vehicles/:id/diagram-lookup.
 */

import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";

export type DiagramComponent =
  | "windshield"
  | "headlights"
  | "oil"
  | "battery"
  | "brakes_front"
  | "brakes_rear"
  | "tires_front"
  | "tires_rear";

interface ZoneProps {
  label: string;
  icon: keyof typeof Feather.glyphMap;
  componentKey: DiagramComponent;
  onPress: (k: DiagramComponent) => void;
  active: boolean;
}

function Zone({ label, icon, componentKey, onPress, active }: ZoneProps) {
  const colors = useColors();
  return (
    <Pressable
      onPress={() => onPress(componentKey)}
      style={[styles.zone, {
        backgroundColor: active ? colors.primary : colors.card,
        borderColor: active ? colors.primary : colors.border,
      }]}
    >
      <Feather name={icon} size={16} color={active ? "white" : colors.foreground} />
      <Text style={[styles.zoneLabel, { color: active ? "white" : colors.foreground }]}>{label}</Text>
    </Pressable>
  );
}

interface Props {
  active: DiagramComponent | null;
  onComponentTap: (k: DiagramComponent) => void;
}

export function VehicleDiagram({ active, onComponentTap }: Props) {
  const colors = useColors();
  return (
    <View style={[styles.frame, { backgroundColor: colors.background, borderColor: colors.border }]}>
      <Text style={[styles.heading, { color: colors.mutedForeground }]}>FRONT</Text>
      <View style={styles.row}>
        <Zone label="Headlights" icon="sun" componentKey="headlights" onPress={onComponentTap} active={active === "headlights"} />
        <Zone label="Windshield" icon="square" componentKey="windshield" onPress={onComponentTap} active={active === "windshield"} />
      </View>
      <View style={styles.row}>
        <Zone label="Front Tire" icon="disc" componentKey="tires_front" onPress={onComponentTap} active={active === "tires_front"} />
        <Zone label="Front Brakes" icon="octagon" componentKey="brakes_front" onPress={onComponentTap} active={active === "brakes_front"} />
        <Zone label="Front Tire" icon="disc" componentKey="tires_front" onPress={onComponentTap} active={active === "tires_front"} />
      </View>
      <View style={styles.row}>
        <Zone label="Battery" icon="battery-charging" componentKey="battery" onPress={onComponentTap} active={active === "battery"} />
        <Zone label="Engine / Oil" icon="droplet" componentKey="oil" onPress={onComponentTap} active={active === "oil"} />
      </View>
      <View style={styles.row}>
        <Zone label="Rear Tire" icon="disc" componentKey="tires_rear" onPress={onComponentTap} active={active === "tires_rear"} />
        <Zone label="Rear Brakes" icon="octagon" componentKey="brakes_rear" onPress={onComponentTap} active={active === "brakes_rear"} />
        <Zone label="Rear Tire" icon="disc" componentKey="tires_rear" onPress={onComponentTap} active={active === "tires_rear"} />
      </View>
      <Text style={[styles.heading, { color: colors.mutedForeground }]}>REAR</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { padding: 12, borderRadius: 12, borderWidth: 1, gap: 8 },
  heading: { fontSize: 10, fontWeight: "600", letterSpacing: 1, textAlign: "center" },
  row: { flexDirection: "row", gap: 8, justifyContent: "center" },
  zone: {
    flex: 1, paddingVertical: 12, paddingHorizontal: 8, borderRadius: 10, borderWidth: 1.5,
    alignItems: "center", gap: 4, minWidth: 70,
  },
  zoneLabel: { fontSize: 11, fontWeight: "600", textAlign: "center" },
});
