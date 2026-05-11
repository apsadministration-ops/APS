import { View, Text, StyleSheet, ScrollView, ActivityIndicator, RefreshControl, Pressable, TextInput } from "react-native";
import { useColors } from "@/hooks/useColors";
import { Feather } from "@expo/vector-icons";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "expo-router";
import { confirm, alertMessage } from "@/utils/confirm";
import { growthGet, growthSend, PLATFORMS, TOPIC_LABELS, type PlatformValue } from "@/lib/growthApi";

interface Idea {
  topicKind: string;
  title: string;
  rationale: string;
  suggestedRegions?: string[];
}
interface SocialPost { id: number; status: string; platform: string }

export default function TrendsScreen() {
  const colors = useColors();
  const router = useRouter();
  const [ideas, setIdeas] = useState<Idea[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Per-idea generation form state
  const [activeIdeaIdx, setActiveIdeaIdx] = useState<number | null>(null);
  const [region, setRegion] = useState("");
  const [briefing, setBriefing] = useState("");
  const [selectedPlatforms, setSelectedPlatforms] = useState<PlatformValue[]>(["instagram", "facebook"]);
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const r = await growthGet<{ ideas: Idea[] }>("/admin/growth/trends");
      setIdeas(r.ideas);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally { setLoading(false); setRefreshing(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const togglePlatform = (p: PlatformValue) => {
    setSelectedPlatforms((cur) => cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]);
  };

  const generate = async (idea: Idea) => {
    if (selectedPlatforms.length === 0) {
      await alertMessage("Pick at least one platform", "Select where this content should be drafted for.");
      return;
    }
    const ok = await confirm({
      title: "Generate drafts?",
      message: `Generate ${selectedPlatforms.length} draft${selectedPlatforms.length === 1 ? "" : "s"} for "${idea.title}". Each draft enters the approval queue — nothing publishes automatically.`,
      confirmText: "Generate",
    });
    if (!ok) return;
    setGenerating(true);
    try {
      const result = await growthSend<{ posts: SocialPost[]; errors: { platform: string; error: string }[] }>(
        "POST",
        "/admin/growth/content/generate-batch",
        {
          topicKind: idea.topicKind,
          topicTitle: idea.title,
          region: region.trim() || idea.suggestedRegions?.[0] || null,
          briefingContext: briefing.trim() || idea.rationale,
          platforms: selectedPlatforms,
        },
      );
      const posts = result?.posts ?? [];
      const errs = result?.errors ?? [];
      setActiveIdeaIdx(null);
      await alertMessage(
        `${posts.length} draft${posts.length === 1 ? "" : "s"} queued`,
        errs.length > 0 ? `Some platforms failed: ${errs.map((e) => `${e.platform}`).join(", ")}` : "Open the approval queue to review.",
      );
      router.push("/(admin)/growth/queue");
    } catch (e) {
      await alertMessage("Generation failed", e instanceof Error ? e.message : "Unknown error");
    } finally { setGenerating(false); }
  };

  return (
    <ScrollView
      style={[s.container, { backgroundColor: colors.background }]}
      contentContainerStyle={{ padding: 16, paddingBottom: 140 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
    >
      <View style={[s.hero, { backgroundColor: colors.primary + "12", borderColor: colors.primary + "30" }]}>
        <Feather name="zap" size={18} color={colors.primary} />
        <Text style={{ color: colors.foreground, flex: 1, fontSize: 12, lineHeight: 17 }}>
          Timely content opportunities scored by Claude using regional density and seasonal context. Tap an idea to draft posts across platforms — every draft lands in the approval queue.
        </Text>
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : error ? (
        <View style={[s.errBox, { backgroundColor: colors.destructive + "18", borderColor: colors.destructive + "30" }]}>
          <Feather name="alert-triangle" size={14} color={colors.destructive} />
          <Text style={{ color: colors.destructive, flex: 1, fontSize: 12 }}>{error}</Text>
        </View>
      ) : ideas?.length === 0 ? (
        <View style={[s.empty, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={{ color: colors.mutedForeground }}>No suggestions returned.</Text>
        </View>
      ) : ideas?.map((idea, idx) => {
        const active = activeIdeaIdx === idx;
        return (
          <View key={idx} style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={s.head}>
              <View style={[s.kindPill, { backgroundColor: colors.primary + "18" }]}>
                <Text style={{ color: colors.primary, fontSize: 10, fontWeight: "700" }}>
                  {TOPIC_LABELS[idea.topicKind] ?? idea.topicKind}
                </Text>
              </View>
              {idea.suggestedRegions && idea.suggestedRegions.length > 0 && (
                <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>{idea.suggestedRegions[0]}</Text>
              )}
            </View>
            <Text style={[s.title, { color: colors.foreground }]}>{idea.title}</Text>
            <Text style={[s.rationale, { color: colors.mutedForeground }]}>{idea.rationale}</Text>

            {!active ? (
              <Pressable
                style={[s.btn, { backgroundColor: colors.primary }]}
                onPress={() => {
                  setActiveIdeaIdx(idx);
                  setRegion(idea.suggestedRegions?.[0] ?? "");
                  setBriefing("");
                }}
              >
                <Feather name="edit-2" size={14} color="#fff" />
                <Text style={s.btnText}>Draft posts</Text>
              </Pressable>
            ) : (
              <>
                <Text style={[s.formLabel, { color: colors.mutedForeground }]}>Platforms</Text>
                <View style={s.platformsRow}>
                  {PLATFORMS.map((p) => {
                    const on = selectedPlatforms.includes(p.value);
                    return (
                      <Pressable
                        key={p.value}
                        onPress={() => togglePlatform(p.value)}
                        style={[s.platformPill, { borderColor: on ? p.color : colors.border, backgroundColor: on ? p.color + "22" : "transparent" }]}
                      >
                        <Feather name={p.icon as keyof typeof Feather.glyphMap} size={12} color={on ? p.color : colors.mutedForeground} />
                        <Text style={{ color: on ? p.color : colors.mutedForeground, fontSize: 11, fontWeight: "700" }}>{p.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>

                <Text style={[s.formLabel, { color: colors.mutedForeground }]}>Region focus (optional)</Text>
                <TextInput
                  value={region} onChangeText={setRegion}
                  placeholder="e.g. Long Island"
                  placeholderTextColor={colors.mutedForeground}
                  style={[s.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
                />

                <Text style={[s.formLabel, { color: colors.mutedForeground }]}>Extra briefing (optional)</Text>
                <TextInput
                  value={briefing} onChangeText={setBriefing}
                  placeholder="e.g. mention winter tire swap"
                  placeholderTextColor={colors.mutedForeground}
                  style={[s.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background, height: 60 }]}
                  multiline
                />

                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Pressable
                    style={[s.btnSecondary, { borderColor: colors.border }]}
                    onPress={() => setActiveIdeaIdx(null)}
                    disabled={generating}
                  >
                    <Text style={{ color: colors.mutedForeground, fontWeight: "600" }}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    style={[s.btn, { backgroundColor: colors.primary, flex: 1, opacity: generating ? 0.6 : 1 }]}
                    onPress={() => generate(idea)}
                    disabled={generating}
                  >
                    {generating ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <>
                        <Feather name="zap" size={14} color="#fff" />
                        <Text style={s.btnText}>Generate {selectedPlatforms.length} draft{selectedPlatforms.length === 1 ? "" : "s"}</Text>
                      </>
                    )}
                  </Pressable>
                </View>
              </>
            )}
          </View>
        );
      })}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  hero: { flexDirection: "row", gap: 10, padding: 12, borderRadius: 12, borderWidth: 1, marginBottom: 14, alignItems: "center" },
  center: { paddingVertical: 60, alignItems: "center" },
  empty: { padding: 16, borderRadius: 14, borderWidth: 1 },
  errBox: { flexDirection: "row", gap: 8, padding: 12, borderRadius: 12, borderWidth: 1, alignItems: "center" },
  card: { padding: 14, borderRadius: 14, borderWidth: 1, marginBottom: 10, gap: 8 },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  kindPill: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  title: { fontSize: 14, fontWeight: "700", marginTop: 4 },
  rationale: { fontSize: 12, lineHeight: 16 },
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, marginTop: 8 },
  btnSecondary: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, alignItems: "center", justifyContent: "center", marginTop: 8 },
  btnText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  formLabel: { fontSize: 11, fontWeight: "700", marginTop: 8, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 },
  platformsRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  platformPill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1 },
  input: { borderWidth: 1, borderRadius: 10, padding: 10, fontSize: 13 },
});
