import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable, TextInput, RefreshControl, Linking } from "react-native";
import { useColors } from "@/hooks/useColors";
import { Feather } from "@expo/vector-icons";
import { useState, useEffect, useCallback } from "react";
import { confirm, alertMessage } from "@/utils/confirm";
import { growthGet, growthSend } from "@/lib/growthApi";

interface CredRow {
  key: string;
  group: string;
  label: string;
  description: string;
  required: boolean;
  secret: boolean;
  configured: boolean;
  source: "db" | "env" | "none";
  updatedAt: string | null;
}
interface GroupStatus {
  key: string;
  label: string;
  description: string;
  docsUrl: string;
  icon: string;
  color: string;
  fullyConfigured: boolean;
  credentials: CredRow[];
}

export default function IntegrationsScreen() {
  const colors = useColors();
  const [groups, setGroups] = useState<GroupStatus[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Per-credential local input + busy state.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    try {
      setLoadError(null);
      const r = await growthGet<{ groups: GroupStatus[] }>("/admin/growth/integrations");
      setGroups(r.groups);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown";
      setLoadError(msg);
      await alertMessage("Load failed", msg);
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async (key: string) => {
    const value = (drafts[key] ?? "").trim();
    if (!value) {
      await alertMessage("Enter a value first");
      return;
    }
    setBusy((b) => ({ ...b, [key]: true }));
    try {
      await growthSend("PUT", `/admin/growth/integrations/${key}`, { value });
      setDrafts((d) => ({ ...d, [key]: "" }));
      await load();
    } catch (e) {
      await alertMessage("Save failed", e instanceof Error ? e.message : "Unknown");
    } finally {
      setBusy((b) => ({ ...b, [key]: false }));
    }
  };

  const clear = async (key: string) => {
    const ok = await confirm({
      title: "Clear stored value?",
      message: "This removes the saved credential from the database. Env-fallback (if configured) will take over.",
      confirmText: "Clear", destructive: true,
    });
    if (!ok) return;
    setBusy((b) => ({ ...b, [key]: true }));
    try {
      await growthSend("DELETE", `/admin/growth/integrations/${key}`);
      await load();
    } catch (e) {
      await alertMessage("Clear failed", e instanceof Error ? e.message : "Unknown");
    } finally {
      setBusy((b) => ({ ...b, [key]: false }));
    }
  };

  if (loading) {
    return (
      <View style={[s.container, s.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }
  if (!groups) {
    return (
      <View style={[s.container, s.center, { backgroundColor: colors.background, padding: 24 }]}>
        <Feather name="alert-triangle" size={36} color={colors.destructive ?? "#dc2626"} />
        <Text style={[s.heroTitle, { color: colors.foreground, marginTop: 12, textAlign: "center" }]}>
          Couldn't load integrations
        </Text>
        <Text style={[s.heroSub, { color: colors.mutedForeground, marginTop: 6, textAlign: "center" }]}>
          {loadError ?? "Something went wrong fetching the credential list."}
        </Text>
        <Pressable
          onPress={() => { setLoading(true); load(); }}
          style={[s.btn, { backgroundColor: colors.primary, marginTop: 16, paddingHorizontal: 24, flexDirection: "row", alignItems: "center", gap: 8 }]}
        >
          <Feather name="refresh-cw" size={16} color="#fff" />
          <Text style={s.btnText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView
      style={[s.container, { backgroundColor: colors.background }]}
      contentContainerStyle={{ padding: 16, paddingBottom: 140 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
    >
      <View style={[s.heroCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={[s.heroBadge, { backgroundColor: colors.primary + "18" }]}>
          <Feather name="key" size={22} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[s.heroTitle, { color: colors.foreground }]}>Integrations</Text>
          <Text style={[s.heroSub, { color: colors.mutedForeground }]}>
            API keys are AES-256-GCM encrypted before they're stored. Plaintext values never leave the server — saved values are not displayed back.
          </Text>
        </View>
      </View>

      {groups.map((g) => (
        <View key={g.key} style={[s.groupCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={s.groupHead}>
            <View style={[s.groupIcon, { backgroundColor: g.color + "22" }]}>
              <Feather name={g.icon as keyof typeof Feather.glyphMap} size={18} color={g.color} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[s.groupTitle, { color: colors.foreground }]}>{g.label}</Text>
              <Text style={[s.groupSub, { color: colors.mutedForeground }]}>{g.description}</Text>
            </View>
            <View style={[s.statusPill, {
              backgroundColor: g.fullyConfigured ? "#22C55E22" : "#9CA3AF22",
            }]}>
              <Text style={{ color: g.fullyConfigured ? "#16A34A" : "#6B7280", fontSize: 10, fontWeight: "800" }}>
                {g.fullyConfigured ? "READY" : "PENDING"}
              </Text>
            </View>
          </View>

          <Pressable onPress={() => Linking.openURL(g.docsUrl).catch(() => {})}>
            <Text style={{ color: g.color, fontSize: 11, marginTop: 4, marginBottom: 8 }}>
              <Feather name="external-link" size={10} color={g.color} /> Documentation
            </Text>
          </Pressable>

          {g.credentials.map((c) => {
            const draft = drafts[c.key] ?? "";
            const isBusy = !!busy[c.key];
            return (
              <View key={c.key} style={[s.credRow, { borderColor: colors.border }]}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4, flexWrap: "wrap" }}>
                  <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: "700" }}>
                    {c.label}
                  </Text>
                  {c.required && (
                    <Text style={{ color: "#EF4444", fontSize: 10, fontWeight: "700" }}>· REQUIRED</Text>
                  )}
                  {c.configured && (
                    <View style={[s.miniPill, { backgroundColor: "#22C55E22" }]}>
                      <Feather name="check" size={9} color="#16A34A" />
                      <Text style={{ color: "#16A34A", fontSize: 9, fontWeight: "800" }}>
                        {c.source === "db" ? "SAVED" : "FROM ENV"}
                      </Text>
                    </View>
                  )}
                </View>
                <Text style={{ color: colors.mutedForeground, fontSize: 11, marginBottom: 6 }}>
                  {c.description}
                </Text>
                {c.updatedAt && (
                  <Text style={{ color: colors.mutedForeground, fontSize: 10, marginBottom: 6 }}>
                    Updated {new Date(c.updatedAt).toLocaleString()}
                  </Text>
                )}
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <TextInput
                    value={draft}
                    onChangeText={(v) => setDrafts((d) => ({ ...d, [c.key]: v }))}
                    placeholder={c.configured ? "•••••• (saved — enter new to replace)" : "Paste value here"}
                    placeholderTextColor={colors.mutedForeground}
                    secureTextEntry={c.secret}
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={[s.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background, flex: 1 }]}
                  />
                  <Pressable
                    style={[s.btn, { backgroundColor: colors.primary, opacity: isBusy ? 0.6 : 1 }]}
                    onPress={() => save(c.key)}
                    disabled={isBusy}
                  >
                    {isBusy ? <ActivityIndicator color="#fff" size="small" /> : (
                      <Text style={s.btnText}>Save</Text>
                    )}
                  </Pressable>
                </View>
                {c.configured && c.source === "db" && (
                  <Pressable onPress={() => clear(c.key)} disabled={isBusy} style={{ marginTop: 6, alignSelf: "flex-start" }}>
                    <Text style={{ color: "#EF4444", fontSize: 11, fontWeight: "700" }}>Clear stored value</Text>
                  </Pressable>
                )}
              </View>
            );
          })}
        </View>
      ))}

      <View style={[s.tipCard, { backgroundColor: colors.primary + "10", borderColor: colors.primary + "30" }]}>
        <Feather name="info" size={14} color={colors.primary} />
        <Text style={{ color: colors.foreground, fontSize: 12, flex: 1, lineHeight: 18 }}>
          Saving credentials here flips the platform status to <Text style={{ fontWeight: "700" }}>READY</Text> in the publishing engine. The live posting adapter for each platform is still a stub — once a real Graph/Marketing API adapter is wired up, posts will start publishing automatically using these saved keys.
        </Text>
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  center: { paddingVertical: 60, alignItems: "center", justifyContent: "center", flex: 1 },
  heroCard: { flexDirection: "row", alignItems: "center", gap: 14, padding: 16, borderRadius: 16, borderWidth: 1, marginBottom: 18 },
  heroBadge: { width: 48, height: 48, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  heroTitle: { fontSize: 17, fontWeight: "800" },
  heroSub: { fontSize: 12, marginTop: 4, lineHeight: 16 },
  groupCard: { padding: 14, borderRadius: 14, borderWidth: 1, marginBottom: 12 },
  groupHead: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  groupIcon: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  groupTitle: { fontSize: 14, fontWeight: "800" },
  groupSub: { fontSize: 11, marginTop: 2, lineHeight: 15 },
  statusPill: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  credRow: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10, marginTop: 10 },
  miniPill: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13 },
  btn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, justifyContent: "center" },
  btnText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  tipCard: { flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 12, borderRadius: 12, borderWidth: 1, marginTop: 8 },
});
