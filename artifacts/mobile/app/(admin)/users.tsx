import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator,
  Alert, RefreshControl, TextInput,
} from "react-native";
import { useColors } from "@/hooks/useColors";
import { Feather } from "@expo/vector-icons";
import { useState, useEffect, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

interface AppUser {
  id: number;
  name: string;
  email: string;
  role: string;
  status: string;
  mechanicTier?: string;
  createdAt: string;
}

const TIER_ORDER = ["detailer", "technician", "senior", "master"];
const TIER_COLOR: Record<string, string> = {
  detailer: "#60A5FA",
  technician: "#34D399",
  senior: "#FBBF24",
  master: "#F472B6",
};

const ROLE_COLOR: Record<string, string> = {
  customer: "#0EA5E9",
  mechanic: "#F97316",
  admin: "#8B5CF6",
};
const STATUS_COLOR: Record<string, string> = {
  active: "#22C55E",
  pending: "#F59E0B",
  suspended: "#EF4444",
};

function UserRow({ user, onAction }: { user: AppUser; onAction: (action: string, userId: number, extra?: string) => void }) {
  const colors = useColors();
  const roleColor = ROLE_COLOR[user.role] ?? colors.mutedForeground;
  const statusColor = STATUS_COLOR[user.status] ?? colors.mutedForeground;
  const tierColor = user.mechanicTier ? (TIER_COLOR[user.mechanicTier] ?? colors.mutedForeground) : colors.mutedForeground;
  const nextTier = user.role === "mechanic" && user.mechanicTier
    ? TIER_ORDER[TIER_ORDER.indexOf(user.mechanicTier) + 1]
    : null;

  return (
    <View style={[styles.userRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={[styles.userAvatar, { backgroundColor: roleColor + "20" }]}>
        <Text style={[styles.userAvatarText, { color: roleColor }]}>
          {user.name.charAt(0).toUpperCase()}
        </Text>
      </View>
      <View style={styles.userInfo}>
        <Text style={[styles.userName, { color: colors.foreground }]}>{user.name}</Text>
        <Text style={[styles.userEmail, { color: colors.mutedForeground }]}>{user.email}</Text>
        <View style={styles.userPills}>
          <View style={[styles.pill, { backgroundColor: roleColor + "18" }]}>
            <Text style={[styles.pillText, { color: roleColor }]}>{user.role.toUpperCase()}</Text>
          </View>
          <View style={[styles.pill, { backgroundColor: statusColor + "18" }]}>
            <Text style={[styles.pillText, { color: statusColor }]}>{user.status.toUpperCase()}</Text>
          </View>
          {user.role === "mechanic" && user.mechanicTier && (
            <View style={[styles.pill, { backgroundColor: tierColor + "18" }]}>
              <Text style={[styles.pillText, { color: tierColor }]}>{user.mechanicTier.toUpperCase()}</Text>
            </View>
          )}
        </View>
      </View>
      <View style={styles.userActions}>
        {user.status === "pending" && (
          <Pressable
            style={[styles.actionBtn, { backgroundColor: "#22C55E18", borderColor: "#22C55E44" }]}
            onPress={() => onAction("activate", user.id)}
          >
            <Feather name="check" size={14} color="#22C55E" />
            <Text style={[styles.actionBtnText, { color: "#22C55E" }]}>Approve</Text>
          </Pressable>
        )}
        {user.status === "active" && user.role !== "admin" && (
          <Pressable
            style={[styles.actionBtn, { backgroundColor: "#EF444418", borderColor: "#EF444444" }]}
            onPress={() => onAction("suspend", user.id)}
          >
            <Feather name="slash" size={14} color="#EF4444" />
            <Text style={[styles.actionBtnText, { color: "#EF4444" }]}>Suspend</Text>
          </Pressable>
        )}
        {user.status === "suspended" && (
          <Pressable
            style={[styles.actionBtn, { backgroundColor: "#22C55E18", borderColor: "#22C55E44" }]}
            onPress={() => onAction("unsuspend", user.id)}
          >
            <Feather name="refresh-cw" size={14} color="#22C55E" />
            <Text style={[styles.actionBtnText, { color: "#22C55E" }]}>Restore</Text>
          </Pressable>
        )}
        {nextTier && (
          <Pressable
            style={[styles.actionBtn, { backgroundColor: tierColor + "18", borderColor: tierColor + "44" }]}
            onPress={() => onAction("promote", user.id, nextTier)}
          >
            <Feather name="arrow-up-circle" size={14} color={tierColor} />
            <Text style={[styles.actionBtnText, { color: tierColor }]}>→ {nextTier}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

export default function AdminUsersScreen() {
  const colors = useColors();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const domain = process.env.EXPO_PUBLIC_DOMAIN;

  const fetchUsers = useCallback(async () => {
    try {
      const token = await AsyncStorage.getItem("auth_token");
      const res = await fetch(`https://${domain}/api/users`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setUsers(await res.json());
    } catch { /* non-fatal */ }
    finally { setLoading(false); setRefreshing(false); }
  }, [domain]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const handleAction = async (action: string, userId: number, extra?: string) => {
    if (action === "promote" && extra) {
      const tierLabels: Record<string, string> = { technician: "Technician", senior: "Senior Tech", master: "Master Tech" };
      Alert.alert(
        "Promote Mechanic",
        `Promote this mechanic to ${tierLabels[extra] ?? extra}?`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Promote",
            onPress: async () => {
              try {
                const token = await AsyncStorage.getItem("auth_token");
                const res = await fetch(`https://${domain}/api/users/${userId}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                  body: JSON.stringify({ mechanicTier: extra }),
                });
                if (res.ok) fetchUsers();
              } catch { /* non-fatal */ }
            },
          },
        ],
      );
      return;
    }

    const statusMap: Record<string, string> = {
      activate: "active",
      suspend: "suspended",
      unsuspend: "active",
    };
    const newStatus = statusMap[action];
    if (!newStatus) return;

    const label = action === "activate" ? "approve" : action === "suspend" ? "suspend" : "restore";
    Alert.alert(
      `${label.charAt(0).toUpperCase() + label.slice(1)} User`,
      `Are you sure you want to ${label} this user?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Confirm",
          style: action === "suspend" ? "destructive" : "default",
          onPress: async () => {
            try {
              const token = await AsyncStorage.getItem("auth_token");
              const res = await fetch(`https://${domain}/api/users/${userId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({ status: newStatus }),
              });
              if (res.ok) fetchUsers();
            } catch { /* non-fatal */ }
          },
        },
      ],
    );
  };

  const onRefresh = () => { setRefreshing(true); fetchUsers(); };

  const filtered = users.filter((u) => {
    const matchRole = roleFilter === "all" || u.role === roleFilter;
    const matchSearch = !search || u.name.toLowerCase().includes(search.toLowerCase()) || u.email.toLowerCase().includes(search.toLowerCase());
    return matchRole && matchSearch;
  });

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.toolbar, { backgroundColor: colors.background, borderBottomColor: colors.border }]}>
        <View style={[styles.searchBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="search" size={16} color={colors.mutedForeground} />
          <TextInput
            style={[styles.searchInput, { color: colors.foreground }]}
            placeholder="Search users…"
            placeholderTextColor={colors.mutedForeground}
            value={search}
            onChangeText={setSearch}
          />
        </View>
        <View style={styles.filterRow}>
          {["all", "customer", "mechanic", "admin"].map((r) => (
            <Pressable
              key={r}
              style={[styles.filterPill, { backgroundColor: roleFilter === r ? colors.primary : colors.secondary, borderColor: colors.border }]}
              onPress={() => setRoleFilter(r)}
            >
              <Text style={[styles.filterPillText, { color: roleFilter === r ? "white" : colors.foreground }]}>
                {r.charAt(0).toUpperCase() + r.slice(1)}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} size="large" /></View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 120, gap: 10 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        >
          <Text style={[styles.count, { color: colors.mutedForeground }]}>{filtered.length} user{filtered.length !== 1 ? "s" : ""}</Text>
          {filtered.map((u) => <UserRow key={u.id} user={u} onAction={handleAction} />)}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  toolbar: { padding: 12, gap: 10, borderBottomWidth: 1 },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
  },
  searchInput: { flex: 1, fontSize: 15 },
  filterRow: { flexDirection: "row", gap: 8 },
  filterPill: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
  },
  filterPillText: { fontSize: 13, fontWeight: "600" },
  count: { fontSize: 13, marginBottom: 4 },
  userRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  userAvatar: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  userAvatarText: { fontSize: 18, fontWeight: "700" },
  userInfo: { flex: 1, gap: 3 },
  userName: { fontSize: 15, fontWeight: "600" },
  userEmail: { fontSize: 12 },
  userPills: { flexDirection: "row", gap: 6, marginTop: 2 },
  pill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  pillText: { fontSize: 10, fontWeight: "700", letterSpacing: 0.3 },
  userActions: { gap: 6 },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  actionBtnText: { fontSize: 12, fontWeight: "700" },
});
