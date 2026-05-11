import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable, TextInput, RefreshControl } from "react-native";
import { useColors } from "@/hooks/useColors";
import { Feather } from "@expo/vector-icons";
import { useState, useEffect, useCallback } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { confirm, alertMessage } from "@/utils/confirm";
import { growthGet, growthSend, PLATFORMS, STATUS_LABELS, TOPIC_LABELS } from "@/lib/growthApi";

interface Post {
  id: number; platform: string; status: string; topicKind: string; topicTitle: string;
  region: string | null; caption: string; hashtags: string[]; mediaIdeas: string[];
  hookText: string | null; callToAction: string | null;
  engagement: { likes?: number; shares?: number; comments?: number; saves?: number; clicks?: number; impressions?: number; signupConversions?: number; bookingConversions?: number };
  generationModel: string | null;
  reviewedAt: string | null; reviewNote: string | null;
  scheduledFor: string | null; publishedAt: string | null;
  externalUrl: string | null; createdAt: string;
}

export default function ContentDetail() {
  const colors = useColors();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [post, setPost] = useState<Post | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftCaption, setDraftCaption] = useState("");
  const [draftHashtags, setDraftHashtags] = useState("");
  const [draftCta, setDraftCta] = useState("");
  const [busy, setBusy] = useState(false);

  // Engagement form
  const [engForm, setEngForm] = useState({ likes: "", shares: "", comments: "", saves: "", clicks: "", impressions: "" });

  const load = useCallback(async () => {
    try {
      const p = await growthGet<Post>(`/admin/growth/content/${id}`);
      setPost(p);
      setDraftCaption(p.caption);
      setDraftHashtags(p.hashtags.join(" "));
      setDraftCta(p.callToAction ?? "");
    } catch (e) {
      await alertMessage("Failed to load", e instanceof Error ? e.message : "Unknown");
    } finally { setLoading(false); setRefreshing(false); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const saveEdits = async () => {
    setBusy(true);
    try {
      const hashtags = draftHashtags.split(/\s+/).map((h) => h.trim()).filter(Boolean);
      await growthSend("PATCH", `/admin/growth/content/${id}`, {
        caption: draftCaption.trim(),
        hashtags,
        callToAction: draftCta.trim(),
      });
      setEditing(false); await load();
    } catch (e) {
      await alertMessage("Save failed", e instanceof Error ? e.message : "Unknown");
    } finally { setBusy(false); }
  };

  const transition = async (action: "approve" | "reject" | "publish", body?: object) => {
    setBusy(true);
    try {
      await growthSend("POST", `/admin/growth/content/${id}/${action}`, body);
      await load();
    } catch (e) {
      await alertMessage(`${action} failed`, e instanceof Error ? e.message : "Unknown");
    } finally { setBusy(false); }
  };

  const recommendAndSchedule = async () => {
    setBusy(true);
    try {
      const rec = await growthSend<{ suggestedAt: string; rationale: string }>(
        "POST", `/admin/growth/content/${id}/recommend-time`,
      );
      if (!rec) return;
      const ok = await confirm({
        title: "Schedule post?",
        message: `Schedule for ${new Date(rec.suggestedAt).toLocaleString()}?\n\n${rec.rationale}`,
        confirmText: "Schedule",
      });
      if (!ok) return;
      await growthSend("POST", `/admin/growth/content/${id}/schedule`, { scheduledFor: rec.suggestedAt });
      await load();
    } catch (e) {
      await alertMessage("Scheduling failed", e instanceof Error ? e.message : "Unknown");
    } finally { setBusy(false); }
  };

  const publishWithUrl = async () => {
    const ok = await confirm({
      title: "Mark as published?",
      message: "Confirm you have manually posted this on the external platform. The system will record the engagement going forward.",
      confirmText: "Mark published",
    });
    if (!ok) return;
    await transition("publish");
  };

  const recordEngagement = async () => {
    const numeric = (s: string) => {
      const n = Number(s);
      return Number.isFinite(n) && n >= 0 ? n : undefined;
    };
    const body: Record<string, number> = {};
    for (const [k, v] of Object.entries(engForm)) {
      const n = numeric(v);
      if (n != null) body[k] = n;
    }
    if (Object.keys(body).length === 0) {
      await alertMessage("Enter at least one metric");
      return;
    }
    setBusy(true);
    try {
      await growthSend("POST", `/admin/growth/content/${id}/engagement`, body);
      await load();
    } catch (e) {
      await alertMessage("Failed", e instanceof Error ? e.message : "Unknown");
    } finally { setBusy(false); }
  };

  const removePost = async () => {
    const ok = await confirm({
      title: "Delete this post?",
      message: "This permanently removes the draft from the queue.",
      confirmText: "Delete", destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await growthSend("DELETE", `/admin/growth/content/${id}`);
      router.back();
    } catch (e) {
      await alertMessage("Delete failed", e instanceof Error ? e.message : "Unknown");
    } finally { setBusy(false); }
  };

  if (loading || !post) {
    return (
      <View style={[s.container, s.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const platformMeta = PLATFORMS.find((p) => p.value === post.platform);
  const statusMeta = STATUS_LABELS[post.status];

  return (
    <ScrollView
      style={[s.container, { backgroundColor: colors.background }]}
      contentContainerStyle={{ padding: 16, paddingBottom: 200 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
    >
      <View style={s.headerRow}>
        <View style={[s.platformBadge, { backgroundColor: (platformMeta?.color ?? "#888") + "22" }]}>
          <Feather name={(platformMeta?.icon ?? "globe") as keyof typeof Feather.glyphMap} size={12} color={platformMeta?.color ?? "#888"} />
          <Text style={{ color: platformMeta?.color ?? "#888", fontSize: 11, fontWeight: "700" }}>{platformMeta?.label ?? post.platform}</Text>
        </View>
        <View style={[s.statusBadge, { backgroundColor: statusMeta.color + "22" }]}>
          <Text style={{ color: statusMeta.color, fontSize: 11, fontWeight: "700" }}>{statusMeta.label}</Text>
        </View>
      </View>

      <Text style={[s.title, { color: colors.foreground }]}>{post.topicTitle}</Text>
      <Text style={[s.subtitle, { color: colors.mutedForeground }]}>
        {TOPIC_LABELS[post.topicKind] ?? post.topicKind}{post.region ? ` · ${post.region}` : ""}
      </Text>

      {post.hookText && (
        <View style={[s.hookCard, { backgroundColor: colors.primary + "12", borderColor: colors.primary + "30" }]}>
          <Text style={[s.hookLabel, { color: colors.primary }]}>HOOK</Text>
          <Text style={{ color: colors.foreground, fontWeight: "700", fontSize: 14 }}>{post.hookText}</Text>
        </View>
      )}

      <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={s.cardHead}>
          <Text style={[s.cardLabel, { color: colors.mutedForeground }]}>Caption</Text>
          {post.status !== "published" && (
            <Pressable onPress={() => setEditing((v) => !v)}>
              <Text style={{ color: colors.primary, fontSize: 12, fontWeight: "700" }}>{editing ? "Cancel" : "Edit"}</Text>
            </Pressable>
          )}
        </View>
        {editing ? (
          <>
            <TextInput value={draftCaption} onChangeText={setDraftCaption} multiline
              style={[s.editInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background, minHeight: 120 }]} />
            <Text style={[s.cardLabel, { color: colors.mutedForeground, marginTop: 10 }]}>Hashtags (space-separated)</Text>
            <TextInput value={draftHashtags} onChangeText={setDraftHashtags}
              style={[s.editInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]} />
            <Text style={[s.cardLabel, { color: colors.mutedForeground, marginTop: 10 }]}>Call to action</Text>
            <TextInput value={draftCta} onChangeText={setDraftCta}
              style={[s.editInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]} />
            <Pressable
              style={[s.btn, { backgroundColor: colors.primary, opacity: busy ? 0.6 : 1, marginTop: 10 }]}
              onPress={saveEdits} disabled={busy}
            >
              {busy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.btnText}>Save edits</Text>}
            </Pressable>
          </>
        ) : (
          <>
            <Text style={{ color: colors.foreground, fontSize: 14, lineHeight: 20 }}>{post.caption}</Text>
            {post.hashtags.length > 0 && (
              <Text style={[s.hashtags, { color: colors.primary }]}>{post.hashtags.join(" ")}</Text>
            )}
            {post.callToAction && (
              <Text style={[s.cta, { color: colors.foreground }]}>→ {post.callToAction}</Text>
            )}
          </>
        )}
      </View>

      {post.mediaIdeas.length > 0 && (
        <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[s.cardLabel, { color: colors.mutedForeground }]}>Media ideas</Text>
          {post.mediaIdeas.map((m, i) => (
            <View key={i} style={s.mediaRow}>
              <Feather name="image" size={12} color={colors.mutedForeground} />
              <Text style={{ color: colors.foreground, flex: 1, fontSize: 13 }}>{m}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Workflow actions */}
      <Text style={[s.section, { color: colors.foreground }]}>Workflow</Text>
      <View style={s.actionsGrid}>
        {post.status === "pending_review" && (
          <>
            <ActionBtn icon="check" label="Approve" color="#22C55E" busy={busy} onPress={() => transition("approve")} />
            <ActionBtn icon="x" label="Reject" color="#EF4444" busy={busy} onPress={() => transition("reject")} />
          </>
        )}
        {post.status === "approved" && (
          <>
            <ActionBtn icon="clock" label="Auto-schedule" color="#6366F1" busy={busy} onPress={recommendAndSchedule} />
            <ActionBtn icon="upload" label="Mark published" color="#0EA5E9" busy={busy} onPress={publishWithUrl} />
            <ActionBtn icon="x" label="Reject" color="#EF4444" busy={busy} onPress={() => transition("reject")} />
          </>
        )}
        {post.status === "scheduled" && (
          <>
            <ActionBtn icon="upload" label="Mark published" color="#0EA5E9" busy={busy} onPress={publishWithUrl} />
            <ActionBtn icon="x" label="Reject" color="#EF4444" busy={busy} onPress={() => transition("reject")} />
          </>
        )}
        {post.status === "rejected" && (
          <ActionBtn icon="check" label="Re-approve" color="#22C55E" busy={busy} onPress={() => transition("approve")} />
        )}
        {post.status !== "published" && (
          <ActionBtn icon="trash-2" label="Delete" color="#9CA3AF" busy={busy} onPress={removePost} />
        )}
      </View>

      {post.scheduledFor && (
        <Text style={[s.metaLine, { color: colors.mutedForeground }]}>
          Scheduled for {new Date(post.scheduledFor).toLocaleString()}
        </Text>
      )}
      {post.publishedAt && (
        <Text style={[s.metaLine, { color: colors.mutedForeground }]}>
          Published {new Date(post.publishedAt).toLocaleString()}{post.externalUrl ? ` · ${post.externalUrl}` : ""}
        </Text>
      )}

      {post.status === "published" && (
        <>
          <Text style={[s.section, { color: colors.foreground }]}>Record engagement</Text>
          <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[s.cardLabel, { color: colors.mutedForeground }]}>Current</Text>
            <Text style={{ color: colors.foreground, fontSize: 12, marginBottom: 12 }}>
              ❤ {post.engagement.likes ?? 0} · ↻ {post.engagement.shares ?? 0} · 💬 {post.engagement.comments ?? 0} · 🔖 {post.engagement.saves ?? 0} · ↗ {post.engagement.clicks ?? 0}
            </Text>
            <View style={s.metricsForm}>
              {(["likes", "shares", "comments", "saves", "clicks", "impressions"] as const).map((k) => (
                <View key={k} style={s.metricInputBox}>
                  <Text style={[s.metricInputLabel, { color: colors.mutedForeground }]}>{k}</Text>
                  <TextInput
                    value={engForm[k]}
                    onChangeText={(v) => setEngForm((cur) => ({ ...cur, [k]: v }))}
                    keyboardType="number-pad"
                    placeholder="0"
                    placeholderTextColor={colors.mutedForeground}
                    style={[s.metricInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
                  />
                </View>
              ))}
            </View>
            <Pressable style={[s.btn, { backgroundColor: colors.primary, marginTop: 10, opacity: busy ? 0.6 : 1 }]}
              onPress={recordEngagement} disabled={busy}>
              {busy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.btnText}>Save metrics</Text>}
            </Pressable>
          </View>
        </>
      )}

      <Text style={[s.footnote, { color: colors.mutedForeground }]}>
        Generated by {post.generationModel ?? "unknown model"} · {new Date(post.createdAt).toLocaleString()}
      </Text>
    </ScrollView>
  );
}

function ActionBtn({ icon, label, color, busy, onPress }: {
  icon: string; label: string; color: string; busy: boolean; onPress: () => void;
}) {
  return (
    <Pressable
      style={[s.actionPill, { backgroundColor: color + "22", borderColor: color + "55", opacity: busy ? 0.6 : 1 }]}
      onPress={onPress} disabled={busy}
    >
      <Feather name={icon as keyof typeof Feather.glyphMap} size={14} color={color} />
      <Text style={{ color, fontWeight: "700", fontSize: 12 }}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  center: { paddingVertical: 60, alignItems: "center", justifyContent: "center" },
  headerRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 12 },
  platformBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10 },
  title: { fontSize: 18, fontWeight: "800" },
  subtitle: { fontSize: 12, marginTop: 4, marginBottom: 14 },
  hookCard: { padding: 12, borderRadius: 12, borderWidth: 1, marginBottom: 12 },
  hookLabel: { fontSize: 10, fontWeight: "800", letterSpacing: 1, marginBottom: 4 },
  card: { padding: 14, borderRadius: 14, borderWidth: 1, marginBottom: 12 },
  cardHead: { flexDirection: "row", justifyContent: "space-between", marginBottom: 8 },
  cardLabel: { fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  hashtags: { fontSize: 12, fontWeight: "600", marginTop: 10 },
  cta: { fontSize: 12, fontWeight: "700", marginTop: 10, fontStyle: "italic" },
  editInput: { borderWidth: 1, borderRadius: 10, padding: 10, fontSize: 13 },
  mediaRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6 },
  section: { fontSize: 13, fontWeight: "700", marginTop: 8, marginBottom: 10 },
  actionsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  actionPill: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1 },
  metaLine: { fontSize: 11, marginBottom: 4 },
  metricsForm: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  metricInputBox: { width: "31%" },
  metricInputLabel: { fontSize: 10, fontWeight: "700", textTransform: "capitalize", marginBottom: 4 },
  metricInput: { borderWidth: 1, borderRadius: 8, padding: 8, fontSize: 13 },
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 11, borderRadius: 10 },
  btnText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  footnote: { fontSize: 10, marginTop: 16, textAlign: "center" },
});
