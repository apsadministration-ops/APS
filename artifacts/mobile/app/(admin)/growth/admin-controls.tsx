/**
 * Admin Controls — AI policy + permissions surface.
 *
 * Shows the immutable AI restrictions, lists admin permissions, and exposes
 * the only two policy toggles the admin can change at runtime: the global
 * AI generation pause switch and the daily draft cap.
 */

import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator,
  Switch, TextInput, Pressable, RefreshControl,
} from "react-native";
import { useColors } from "@/hooks/useColors";
import { Feather } from "@expo/vector-icons";
import { useState, useEffect, useCallback } from "react";
import { growthGet, growthSend } from "./_api";

interface SettingsResponse {
  settings: { id: number; aiContentGenerationPaused: boolean; maxDailyDrafts: number; updatedAt: string };
  aiRestrictions: string[];
  adminPermissions: string[];
  futureCapabilities: string[];
}

const FUTURE_LABELS: Record<string, string> = {
  paid_advertising: "Paid advertising",
  predictive_growth_analytics: "Predictive growth analytics",
  autonomous_campaign_recommendations: "Autonomous campaign recommendations",
  multi_language_translation: "Multi-language support",
  international_region_expansion: "International expansion",
};

export default function AdminControlsScreen() {
  const colors = useColors();
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftCap, setDraftCap] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const r = await growthGet<SettingsResponse>("/admin/growth/settings");
      setData(r);
      setDraftCap(String(r.settings.maxDailyDrafts));
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to load"); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const togglePause = useCallback(async (next: boolean) => {
    if (!data) return;
    setData({ ...data, settings: { ...data.settings, aiContentGenerationPaused: next } });
    try {
      await growthSend("PATCH", "/admin/growth/settings", { aiContentGenerationPaused: next });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
      load();
    }
  }, [data, load]);

  const saveCap = useCallback(async () => {
    const n = Number(draftCap);
    if (!Number.isInteger(n) || n < 1 || n > 10000) { setError("Cap must be 1–10000"); return; }
    setSaving(true);
    try {
      await growthSend("PATCH", "/admin/growth/settings", { maxDailyDrafts: n });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Update failed"); }
    finally { setSaving(false); }
  }, [draftCap, load]);

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={{ padding: 16, paddingBottom: 140 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
    >
      <View style={[styles.heroCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={[styles.heroBadge, { backgroundColor: "#F97316" + "20" }]}>
          <Feather name="shield" size={24} color="#F97316" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.heroTitle, { color: colors.foreground }]}>Admin Controls & AI Policy</Text>
          <Text style={[styles.heroSub, { color: colors.mutedForeground }]}>
            The Growth AI assists you. It never publishes, prices, ranks, or speaks publicly without your approval.
          </Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : error ? (
        <View style={[styles.errorBox, { backgroundColor: colors.destructive + "18", borderColor: colors.destructive + "30" }]}>
          <Feather name="alert-triangle" size={16} color={colors.destructive} />
          <Text style={{ color: colors.destructive, flex: 1 }}>{error}</Text>
        </View>
      ) : data ? (
        <>
          <Text style={[styles.section, { color: colors.foreground }]}>Live policy toggles</Text>
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.toggleRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.toggleLabel, { color: colors.foreground }]}>Pause AI content generation</Text>
                <Text style={[styles.toggleSub, { color: colors.mutedForeground }]}>
                  When ON, all AI generate endpoints return 423. Existing drafts unchanged.
                </Text>
              </View>
              <Switch
                value={data.settings.aiContentGenerationPaused}
                onValueChange={togglePause}
                trackColor={{ false: colors.border, true: "#F97316" }}
              />
            </View>
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
            <View>
              <Text style={[styles.toggleLabel, { color: colors.foreground }]}>Max AI drafts per day</Text>
              <Text style={[styles.toggleSub, { color: colors.mutedForeground }]}>
                Hard cap across all platforms. Generation returns 429 once reached.
              </Text>
              <View style={styles.capRow}>
                <TextInput
                  value={draftCap}
                  onChangeText={setDraftCap}
                  keyboardType="number-pad"
                  style={[styles.input, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
                />
                <Pressable
                  onPress={saveCap}
                  disabled={saving}
                  style={({ pressed }) => [styles.saveBtn, { backgroundColor: colors.primary, opacity: saving || pressed ? 0.7 : 1 }]}
                >
                  <Text style={{ color: "#fff", fontWeight: "700" }}>{saving ? "Saving…" : "Save cap"}</Text>
                </Pressable>
              </View>
            </View>
          </View>

          <Text style={[styles.section, { color: colors.foreground }]}>AI restrictions (immutable)</Text>
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {data.aiRestrictions.map((r) => (
              <View key={r} style={styles.bulletRow}>
                <Feather name="x-circle" size={16} color={colors.destructive} />
                <Text style={[styles.bulletText, { color: colors.foreground }]}>{r}</Text>
              </View>
            ))}
          </View>

          <Text style={[styles.section, { color: colors.foreground }]}>Admin permissions</Text>
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {data.adminPermissions.map((p) => (
              <View key={p} style={styles.bulletRow}>
                <Feather name="check-circle" size={16} color="#22C55E" />
                <Text style={[styles.bulletText, { color: colors.foreground }]}>{p}</Text>
              </View>
            ))}
          </View>

          <Text style={[styles.section, { color: colors.foreground }]}>Future architecture (not yet wired)</Text>
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={{ color: colors.mutedForeground, fontSize: 12, marginBottom: 10 }}>
              The Growth Center is built modularly. These capability surfaces are reserved as adapter interfaces
              and can be plugged in without disturbing existing organic flows.
            </Text>
            {data.futureCapabilities.map((c) => (
              <View key={c} style={styles.bulletRow}>
                <Feather name="layers" size={16} color={colors.mutedForeground} />
                <Text style={[styles.bulletText, { color: colors.foreground }]}>{FUTURE_LABELS[c] ?? c}</Text>
              </View>
            ))}
          </View>

          <Text style={[styles.footer, { color: colors.mutedForeground }]}>
            Last updated {new Date(data.settings.updatedAt).toLocaleString()}
          </Text>
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { paddingVertical: 60, alignItems: "center" },
  heroCard: { flexDirection: "row", alignItems: "center", gap: 14, padding: 16, borderRadius: 16, borderWidth: 1, marginBottom: 18 },
  heroBadge: { width: 52, height: 52, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  heroTitle: { fontSize: 17, fontWeight: "800" },
  heroSub: { fontSize: 12, marginTop: 4, lineHeight: 16 },
  errorBox: { flexDirection: "row", gap: 8, padding: 12, borderRadius: 12, borderWidth: 1, alignItems: "center" },
  section: { fontSize: 14, fontWeight: "700", marginBottom: 8, marginTop: 14 },
  card: { padding: 14, borderRadius: 14, borderWidth: 1 },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  toggleLabel: { fontSize: 14, fontWeight: "700" },
  toggleSub: { fontSize: 11, marginTop: 4, lineHeight: 14 },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 14 },
  capRow: { flexDirection: "row", gap: 10, marginTop: 10 },
  input: { flex: 1, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  saveBtn: { paddingHorizontal: 16, justifyContent: "center", borderRadius: 10 },
  bulletRow: { flexDirection: "row", gap: 10, alignItems: "flex-start", paddingVertical: 6 },
  bulletText: { fontSize: 13, flex: 1, lineHeight: 18 },
  footer: { fontSize: 11, textAlign: "center", marginTop: 18 },
});
