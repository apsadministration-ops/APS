import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator,
  RefreshControl, TextInput,
} from "react-native";
import { confirm, alertMessage } from "@/utils/confirm";
import { useColors } from "@/hooks/useColors";
import { Feather } from "@expo/vector-icons";
import { useState, useEffect, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getApiUrl } from "@/lib/apiConfig";

interface AppUser {
  id: number;
  name: string;
  email: string;
  role: string;
  status: string;
  mechanicTier?: string;
  createdAt: string;
}

type TabKey = "mechanic" | "customer";

const TIER_ORDER = ["detailer", "technician", "senior", "advanced", "master"];
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
        {user.role !== "admin" && (
          <Pressable
            style={[styles.actionBtn, { backgroundColor: "#EF444418", borderColor: "#EF444444" }]}
            onPress={() => onAction("remove", user.id)}
          >
            <Feather name="trash-2" size={14} color="#EF4444" />
            <Text style={[styles.actionBtnText, { color: "#EF4444" }]}>Remove</Text>
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
  const [tab, setTab] = useState<TabKey>("mechanic");

  const fetchUsers = useCallback(async () => {
    try {
      const token = await AsyncStorage.getItem("auth_token");
      const res = await fetch(getApiUrl("/users"), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) setUsers(await res.json());
    } catch { /* non-fatal */ }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const handleAction = async (action: string, userId: number, extra?: string) => {
    if (action === "promote" && extra) {
      const tierLabels: Record<string, string> = { technician: "Technician", senior: "Senior Tech", master: "Master Tech" };
      const ok = await confirm({
        title: "Promote Mechanic",
        message: `Promote this mechanic to ${tierLabels[extra] ?? extra}?`,
        confirmText: "Promote",
      });
      if (!ok) return;
      try {
        const token = await AsyncStorage.getItem("auth_token");
        const res = await fetch(getApiUrl(`/users/${userId}`), {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ mechanicTier: extra }),
        });
        if (res.ok) fetchUsers();
      } catch { /* non-fatal */ }
      return;
    }

    if (action === "remove") {
      const target = users.find((u) => u.id === userId);
      const ok = await confirm({
        title: "Remove User",
        message: `Permanently remove ${target?.name ?? "this user"}? This cannot be undone. Users with service history cannot be removed — suspend them instead.`,
        confirmText: "Remove",
        destructive: true,
      });
      if (!ok) return;
      try {
        const token = await AsyncStorage.getItem("auth_token");
        const res = await fetch(getApiUrl(`/users/${userId}`), {
          method: "DELETE",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (res.ok) {
          fetchUsers();
        } else {
          const body = await res.json().catch(() => ({}));
          await alertMessage("Could not remove user", body?.error ?? `Server returned ${res.status}.`);
        }
      } catch { /* non-fatal */ }
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
    const ok = await confirm({
      title: `${label.charAt(0).toUpperCase() + label.slice(1)} User`,
      message: `Are you sure you want to ${label} this user?`,
      confirmText: "Confirm",
      destructive: action === "suspend",
    });
    if (!ok) return;
    try {
      const token = await AsyncStorage.getItem("auth_token");
        const res = await fetch(getApiUrl(`/users/${userId}`), {
        method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) fetchUsers();
    } catch { /* non-fatal */ }
  };

  const onRefresh = () => { setRefreshing(true); fetchUsers(); };

  const mechanicCount = users.filter((u) => u.role === "mechanic").length;
  const customerCount = users.filter((u) => u.role === "customer").length;

  const filtered = users.filter((u) => {
    if (u.role !== tab) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
  });

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.toolbar, { backgroundColor: colors.background, borderBottomColor: colors.border }]}>
        <View style={[styles.tabRow, { borderColor: colors.border }]}>
          <Pressable
            style={[styles.tab, tab === "mechanic" && { backgroundColor: colors.primary }]}
            onPress={() => setTab("mechanic")}
          >
            <Feather name="tool" size={14} color={tab === "mechanic" ? "white" : colors.foreground} />
            <Text style={[styles.tabText, { color: tab === "mechanic" ? "white" : colors.foreground }]}>
              Mechanics ({mechanicCount})
            </Text>
          </Pressable>
          <Pressable
            style={[styles.tab, tab === "customer" && { backgroundColor: colors.primary }]}
            onPress={() => setTab("customer")}
          >
            <Feather name="users" size={14} color={tab === "customer" ? "white" : colors.foreground} />
            <Text style={[styles.tabText, { color: tab === "customer" ? "white" : colors.foreground }]}>
              Customers ({customerCount})
            </Text>
          </Pressable>
        </View>
        <View style={[styles.searchBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="search" size={16} color={colors.mutedForeground} />
          <TextInput
            style={[styles.searchInput, { color: colors.foreground }]}
            placeholder={`Search ${tab === "mechanic" ? "mechanics" : "customers"}…`}
            placeholderTextColor={colors.mutedForeground}
            value={search}
            onChangeText={setSearch}
          />
        </View>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} size="large" /></View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 120, gap: 10 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        >
          <Text style={[styles.count, { color: colors.mutedForeground }]}>
            {filtered.length} {tab}{filtered.length !== 1 ? "s" : ""}
          </Text>
          {filtered.length === 0 ? (
            <View style={[styles.empty, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Feather name="inbox" size={32} color={colors.mutedForeground} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                No {tab}s {search ? "match your search." : "yet."}
              </Text>
            </View>
          ) : (
            filtered.map((u) => <UserRow key={u.id} user={u} onAction={handleAction} />)
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  toolbar: { padding: 12, gap: 10, borderBottomWidth: 1 },
  tabRow: { flexDirection: "row", gap: 8 },
  tab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "transparent",
  },
  tabText: { fontSize: 13, fontWeight: "700" },
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
  count: { fontSize: 13, marginBottom: 4 },
  empty: {
    alignItems: "center",
    gap: 10,
    padding: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: "dashed",
  },
  emptyText: { fontSize: 13, textAlign: "center" },
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
  userPills: { flexDirection: "row", gap: 6, marginTop: 2, flexWrap: "wrap" },
  pill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  pillText: { fontSize: 10, fontWeight: "700", letterSpacing: 0.3 },
  userActions: { gap: 6, alignItems: "flex-end" },
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
