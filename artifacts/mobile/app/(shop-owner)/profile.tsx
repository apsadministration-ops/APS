import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { useColors } from "@/hooks/useColors";
import { PARTNER_LAYER_LABEL } from "@/lib/partnerIdentity";
import { useAuth } from "@/context/AuthContext";
import { Feather } from "@expo/vector-icons";
import { confirm } from "@/utils/confirm";
import { useRouter } from "expo-router";

export default function ShopOwnerProfileScreen() {
  const colors = useColors();
  const { user, logout } = useAuth();
  const router = useRouter();

  const handleLogout = async () => {
    const ok = await confirm({
      title: "Log out?",
      message: "You'll need to sign in again to access your shops.",
      confirmText: "Log Out",
      destructive: true,
    });
    if (ok) await logout();
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
        contentInsetAdjustmentBehavior="automatic"
      >
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
            <Text style={styles.avatarText}>{user?.name?.charAt(0).toUpperCase() ?? "?"}</Text>
          </View>
          <Text style={[styles.name, { color: colors.foreground }]}>{user?.name}</Text>
          <Text style={[styles.email, { color: colors.mutedForeground }]}>{user?.email}</Text>
          <View style={[styles.roleBadge, { backgroundColor: colors.primary + "20" }]}>
            <Text style={[styles.roleBadgeText, { color: colors.primary }]}>{PARTNER_LAYER_LABEL}</Text>
          </View>
        </View>

        <Pressable
          testID="link-manage-organizations"
          accessibilityRole="button"
          onPress={() => router.push("/(shop-owner)/organizations" as any)}
          style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
          <View style={[styles.rowIcon, { backgroundColor: colors.primary + "20" }]}>
            <Feather name="briefcase" size={18} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.rowLabel, { color: colors.foreground }]}>
              Manage organizations
            </Text>
            <Text style={[styles.rowHint, { color: colors.mutedForeground }]}>
              Create, edit, and explicitly link locations
            </Text>
          </View>
          <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
        </Pressable>

        <Pressable
          testID="button-logout"
          accessibilityRole="button"
          style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={handleLogout}
        >
          <View style={[styles.rowIcon, { backgroundColor: colors.destructive + "20" }]}>
            <Feather name="log-out" size={18} color={colors.destructive} />
          </View>
          <Text style={[styles.rowLabel, { color: colors.destructive }]}>Log Out</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  card: { padding: 24, borderRadius: 16, borderWidth: 1, alignItems: "center", marginBottom: 16 },
  avatar: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  avatarText: { color: "white", fontWeight: "800", fontSize: 28 },
  name: { fontSize: 18, fontWeight: "700" },
  email: { fontSize: 14, marginTop: 4 },
  roleBadge: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12, marginTop: 10 },
  roleBadgeText: { fontSize: 12, fontWeight: "700" },
  row: {
    flexDirection: "row", alignItems: "center", gap: 12,
    padding: 14, borderRadius: 12, borderWidth: 1, marginBottom: 8,
  },
  rowIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  rowLabel: { fontSize: 15, fontWeight: "600", flex: 1 },
  rowHint: { fontSize: 12, marginTop: 3 },
});
