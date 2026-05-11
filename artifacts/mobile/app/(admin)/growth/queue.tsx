import { View, Text, StyleSheet, ScrollView, ActivityIndicator, RefreshControl, Pressable, TextInput } from "react-native";
import { useColors } from "@/hooks/useColors";
import { Feather } from "@expo/vector-icons";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "expo-router";
import { confirm, alertMessage } from "@/utils/confirm";
import { growthGet, growthSend, PLATFORMS, STATUS_LABELS, TOPIC_LABELS, type PlatformValue } from "./_api";

interface Post {
  id: number; platform: string; status: string; topicKind: string; topicTitle: string;
  region: string | null; caption: string; hashtags: string[]; mediaIdeas: string[];
  hookText: string | null; callToAction: string | null;
  scheduledFor: string | null; publishedAt: string | null;
  createdAt: string;
}

const STATUS_FILTERS = ["pending_review", "approved", "scheduled", "published", "rejected", "draft"] as const;

export default function ApprovalQueue() {
  const colors = useColors();
  const router = useRouter();
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string | "all">("pending_review");
  const [platformFilter, setPlatformFilter] = useState<PlatformValue | "all">("all");
  const [error, setError] = useState<string | null>(null);

  // Manual generate form
  const [showForm, setShowForm] = useState(false);
  const [topicKind, setTopicKind] = useState<keyof typeof TOPIC_LABELS>("maintenance_reminder");
  const [topicTitle, setTopicTitle] = useState("");
  const [region, setRegion] = useState("");
  const [briefing, setBriefing] = useState("");
  const [platforms, setPlatforms] = useState<PlatformValue[]>(["instagram"]);
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (platformFilter !== "all") params.set("platform", platformFilter);
      const qs = params.toString();
      const data = await growthGet<Post[]>(`/admin/growth/content${qs ? `?${qs}` : ""}`);
      setPosts(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally { setLoading(false); setRefreshing(false); }
  }, [statusFilter, platformFilter]);
  useEffect(() => { load(); }, [load]);

  const togglePlatform = (p: PlatformValue) =>
    setPlatforms((cur) => cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]);

  const generateManual = async () => {
    if (!topicTitle.trim()) { await alertMessage("Topic title required"); return; }
    if (platforms.length === 0) { await alertMessage("Pick at least one platform"); return; }
    setGenerating(true);
    try {
      await growthSend<unknown>("POST", "/admin/growth/content/generate-batch", {
        topicKind, topicTitle: topicTitle.trim(),
        region: region.trim() || null,
        briefingContext: briefing.trim() || null,
        platforms,
      });
      setShowForm(false); setTopicTitle(""); setBriefing(""); setRegion("");
      await load();
    } catch (e) {
      await alertMessage("Generation failed", e instanceof Error ? e.message : "Unknown");
    } finally { setGenerating(false); }
  };

  const quickAction = async (post: Post, action: "approve" | "reject") => {
    const ok = await confirm({
      title: action === "approve" ? "Approve post?" : "Reject post?",
      message: action === "approve" ? "Mark this draft as approved (still won't publish without your manual publish)." : "Mark this draft as rejected.",
      confirmText: action === "approve" ? "Approve" : "Reject",
      destructive: action === "reject",
    });
    if (!ok) return;
    try {
      await growthSend("POST", `/admin/growth/content/${post.id}/${action}`, action === "reject" ? { reviewNote: null } : undefined);
      await load();
    } catch (e) {
      await alertMessage("Action failed", e instanceof Error ? e.message : "Unknown");
    }
  };

  return (
    <ScrollView
      style={[s.container, { backgroundColor: colors.background }]}
      contentContainerStyle={{ padding: 16, paddingBottom: 140 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
    >
      <View style={[s.safetyBanner, { backgroundColor: "#F59E0B22", borderColor: "#F59E0B55" }]}>
        <Feather name="shield" size={14} color="#F59E0B" />
        <Text style={{ color: colors.foreground, flex: 1, fontSize: 11, lineHeight: 15 }}>
          Nothing publishes automatically. Approve, schedule, then manually publish — recording the external URL when posted.
        </Text>
      </View>

      <Pressable
        style={[s.generateBtn, { backgroundColor: colors.primary + "18", borderColor: colors.primary + "44" }]}
        onPress={() => setShowForm((v) => !v)}
      >
        <Feather name={showForm ? "chevron-up" : "plus"} size={16} color={colors.primary} />
        <Text style={{ color: colors.primary, fontWeight: "700" }}>{showForm ? "Hide generator" : "Generate new content"}</Text>
      </Pressable>

      {showForm && (
        <View style={[s.formCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[s.formLabel, { color: colors.mutedForeground }]}>Topic kind</Text>
          <View style={s.kindGrid}>
            {Object.entries(TOPIC_LABELS).map(([k, label]) => (
              <Pressable
                key={k}
                onPress={() => setTopicKind(k as keyof typeof TOPIC_LABELS)}
                style={[s.kindChip, { borderColor: topicKind === k ? colors.primary : colors.border, backgroundColor: topicKind === k ? colors.primary + "18" : "transparent" }]}
              >
                <Text style={{ color: topicKind === k ? colors.primary : colors.foreground, fontSize: 11, fontWeight: "600" }}>{label}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={[s.formLabel, { color: colors.mutedForeground }]}>Topic title</Text>
          <TextInput value={topicTitle} onChangeText={setTopicTitle}
            placeholder="e.g. Spring brake check reminder"
            placeholderTextColor={colors.mutedForeground}
            style={[s.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]} />

          <Text style={[s.formLabel, { color: colors.mutedForeground }]}>Region (optional)</Text>
          <TextInput value={region} onChangeText={setRegion}
            placeholder="e.g. Long Island"
            placeholderTextColor={colors.mutedForeground}
            style={[s.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]} />

          <Text style={[s.formLabel, { color: colors.mutedForeground }]}>Briefing (optional)</Text>
          <TextInput value={briefing} onChangeText={setBriefing}
            placeholder="Specific angle, mechanic name, season detail..."
            placeholderTextColor={colors.mutedForeground}
            style={[s.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background, height: 60 }]}
            multiline />

          <Text style={[s.formLabel, { color: colors.mutedForeground }]}>Platforms</Text>
          <View style={s.platformsRow}>
            {PLATFORMS.map((p) => {
              const on = platforms.includes(p.value);
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

          <Pressable
            style={[s.btn, { backgroundColor: colors.primary, opacity: generating ? 0.6 : 1, marginTop: 12 }]}
            disabled={generating}
            onPress={generateManual}
          >
            {generating ? <ActivityIndicator color="#fff" size="small" /> : (
              <>
                <Feather name="zap" size={14} color="#fff" />
                <Text style={s.btnText}>Generate drafts</Text>
              </>
            )}
          </Pressable>
        </View>
      )}

      <Text style={[s.sectionTitle, { color: colors.foreground }]}>Filter</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
        <View style={{ flexDirection: "row", gap: 6 }}>
          <FilterPill label="All" active={statusFilter === "all"} onPress={() => setStatusFilter("all")} accent={colors.primary} colorsPalette={colors} />
          {STATUS_FILTERS.map((st) => (
            <FilterPill
              key={st}
              label={STATUS_LABELS[st].label}
              active={statusFilter === st}
              onPress={() => setStatusFilter(st)}
              accent={STATUS_LABELS[st].color}
              colorsPalette={colors}
            />
          ))}
        </View>
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
        <View style={{ flexDirection: "row", gap: 6 }}>
          <FilterPill label="All platforms" active={platformFilter === "all"} onPress={() => setPlatformFilter("all")} accent={colors.primary} colorsPalette={colors} />
          {PLATFORMS.map((p) => (
            <FilterPill key={p.value} label={p.label} active={platformFilter === p.value} onPress={() => setPlatformFilter(p.value)} accent={p.color} colorsPalette={colors} />
          ))}
        </View>
      </ScrollView>

      {loading ? (
        <View style={s.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : error ? (
        <Text style={{ color: colors.destructive }}>{error}</Text>
      ) : posts && posts.length === 0 ? (
        <View style={[s.empty, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={{ color: colors.mutedForeground }}>No posts in this filter.</Text>
        </View>
      ) : posts?.map((p) => {
        const platformMeta = PLATFORMS.find((x) => x.value === p.platform);
        const statusMeta = STATUS_LABELS[p.status];
        return (
          <Pressable
            key={p.id}
            onPress={() => router.push(`/(admin)/growth/content/${p.id}`)}
            style={({ pressed }) => [s.postCard, { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.85 : 1 }]}
          >
            <View style={s.postHead}>
              <View style={[s.platformBadge, { backgroundColor: (platformMeta?.color ?? "#888") + "22" }]}>
                <Feather name={(platformMeta?.icon ?? "globe") as keyof typeof Feather.glyphMap} size={12} color={platformMeta?.color ?? "#888"} />
                <Text style={{ color: platformMeta?.color ?? "#888", fontSize: 10, fontWeight: "700" }}>{platformMeta?.label ?? p.platform}</Text>
              </View>
              <View style={[s.statusBadge, { backgroundColor: statusMeta.color + "22" }]}>
                <Text style={{ color: statusMeta.color, fontSize: 10, fontWeight: "700" }}>{statusMeta.label}</Text>
              </View>
            </View>
            <Text style={[s.topicTitle, { color: colors.foreground }]} numberOfLines={1}>{p.topicTitle}</Text>
            <Text style={[s.topicMeta, { color: colors.mutedForeground }]}>
              {TOPIC_LABELS[p.topicKind] ?? p.topicKind}{p.region ? ` · ${p.region}` : ""}
            </Text>
            <Text style={[s.caption, { color: colors.foreground }]} numberOfLines={3}>{p.caption}</Text>
            {p.hashtags.length > 0 && (
              <Text style={[s.tags, { color: colors.primary }]} numberOfLines={1}>{p.hashtags.join(" ")}</Text>
            )}
            {p.status === "pending_review" && (
              <View style={s.actionsRow}>
                <Pressable style={[s.actionBtn, { backgroundColor: "#22C55E" }]} onPress={() => quickAction(p, "approve")}>
                  <Feather name="check" size={14} color="#fff" />
                  <Text style={s.actionText}>Approve</Text>
                </Pressable>
                <Pressable style={[s.actionBtn, { backgroundColor: "#EF4444" }]} onPress={() => quickAction(p, "reject")}>
                  <Feather name="x" size={14} color="#fff" />
                  <Text style={s.actionText}>Reject</Text>
                </Pressable>
              </View>
            )}
            {p.scheduledFor && (
              <Text style={[s.scheduledNote, { color: "#6366F1" }]}>
                <Feather name="clock" size={11} color="#6366F1" /> Scheduled for {new Date(p.scheduledFor).toLocaleString()}
              </Text>
            )}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function FilterPill({ label, active, onPress, accent, colorsPalette }: {
  label: string; active: boolean; onPress: () => void; accent: string;
  colorsPalette: ReturnType<typeof useColors>;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[s.filterPill, { borderColor: active ? accent : colorsPalette.border, backgroundColor: active ? accent + "22" : "transparent" }]}
    >
      <Text style={{ color: active ? accent : colorsPalette.mutedForeground, fontSize: 11, fontWeight: "700" }}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  safetyBanner: { flexDirection: "row", gap: 8, padding: 10, borderRadius: 10, borderWidth: 1, alignItems: "center", marginBottom: 12 },
  generateBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 12, borderRadius: 12, borderWidth: 1, marginBottom: 10 },
  formCard: { padding: 14, borderRadius: 14, borderWidth: 1, marginBottom: 14 },
  formLabel: { fontSize: 11, fontWeight: "700", marginTop: 10, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 },
  kindGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  kindChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1 },
  input: { borderWidth: 1, borderRadius: 10, padding: 10, fontSize: 13 },
  platformsRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  platformPill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1 },
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 11, borderRadius: 10 },
  btnText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  sectionTitle: { fontSize: 13, fontWeight: "700", marginBottom: 8 },
  filterPill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, borderWidth: 1 },
  center: { paddingVertical: 60, alignItems: "center" },
  empty: { padding: 16, borderRadius: 14, borderWidth: 1 },
  postCard: { padding: 14, borderRadius: 14, borderWidth: 1, marginBottom: 10, gap: 6 },
  postHead: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  platformBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  topicTitle: { fontSize: 14, fontWeight: "700" },
  topicMeta: { fontSize: 11 },
  caption: { fontSize: 12, lineHeight: 17, marginTop: 4 },
  tags: { fontSize: 11, fontWeight: "600", marginTop: 4 },
  actionsRow: { flexDirection: "row", gap: 8, marginTop: 10 },
  actionBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 10 },
  actionText: { color: "#fff", fontWeight: "700", fontSize: 12 },
  scheduledNote: { fontSize: 11, fontWeight: "700", marginTop: 6 },
});
