import { Feather } from "@expo/vector-icons";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";

export function CapabilityNotice({
  message,
  canOpenSettings,
  onOpenSettings,
}: {
  message: string;
  canOpenSettings?: boolean;
  onOpenSettings?: () => void;
}) {
  const colors = useColors();

  return (
    <View
      accessibilityRole="alert"
      style={[
        styles.container,
        { backgroundColor: colors.destructive + "12", borderColor: colors.destructive + "55" },
      ]}
    >
      <Feather name="alert-circle" size={16} color={colors.destructive} />
      <Text style={[styles.message, { color: colors.foreground }]}>{message}</Text>
      {Platform.OS !== "web" && canOpenSettings && onOpenSettings ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open device settings"
          onPress={onOpenSettings}
          style={[styles.settingsButton, { borderColor: colors.destructive }]}
        >
          <Text style={[styles.settingsText, { color: colors.destructive }]}>
            Settings
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "flex-start",
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    marginTop: 8,
    padding: 10,
  },
  message: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
  },
  settingsButton: {
    borderRadius: 7,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  settingsText: {
    fontSize: 11,
    fontWeight: "700",
  },
});