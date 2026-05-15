import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable, TextInput, RefreshControl, Image } from "react-native";
import { useColors } from "@/hooks/useColors";
import { Feather } from "@expo/vector-icons";
import { useState, useEffect, useCallback } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { confirm, alertMessage } from "@/utils/confirm";
import { growthGet, growthSend, PLATFORMS, STATUS_LABELS, TOPIC_LABELS } from "@/lib/growthApi";

// Asset URLs returned by the server already include the `/api` prefix
// (e.g. `/api/media/files/<uuid>.png`), so we concat against the bare domain.
const ASSET_ORIGIN = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;

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

interface MediaAsset {
  id: number;
  kind: "image" | "video";
  status: "generating" | "ready" | "failed" | "approved" | "rejected";
  aspectRatio: string;
  intent: string;
  width: number | null;
  height: number | null;
  url: string | null;
  providerKey: string;
  providerModel: string | null;
  failureReason: string | null;
  createdAt: string;
}

type IntentKind = "square_feed" | "vertical_reel" | "landscape_header";
const INTENT_OPTIONS: { value: IntentKind; label: string; aspect: string }[] = [
  { value: "square_feed",      label: "Square (1:1)",    aspect: "1:1"  },
  { value: "vertical_reel",    label: "Reel (9:16)",     aspect: "9:16" },
  { value: "landscape_header", label: "Header (16:9)",   aspect: "16:9" },
];
const ASSET_STATUS_LABEL: Record<MediaAsset["status"], { label: string; color: string }> = {
  generating: { label: "Generating", color: "#6366F1" },
  ready:      { label: "Ready",      color: "#0EA5E9" },
  failed:     { label: "Failed",     color: "#EF4444" },
  approved:   { label: "Approved",   color: "#22C55E" },
  rejected:   { label: "Rejected",   color: "#9CA3AF" },
};

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

  // Media assets state
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [selectedIntents, setSelectedIntents] = useState<Set<IntentKind>>(
    () => new Set<IntentKind>(["square_feed"]),
  );
  const [promptOverride, setPromptOverride] = useState("");
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async () => {
    try {
      const [p, a] = await Promise.all([
        growthGet<Post>(`/admin/growth/content/${id}`),
        growthGet<MediaAsset[]>(`/admin/growth/content/${id}/media`).catch(() => [] as MediaAsset[]),
      ]);
      setPost(p);
      setDraftCaption(p.caption);
      setDraftHashtags(p.hashtags.join(" "));
      setDraftCta(p.callToAction ?? "");
      setAssets(a);
    } catch (e) {
      await alertMessage("Failed to load", e instanceof Error ? e.message : "Unknown");
    } finally { setLoading(false); setRefreshing(false); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const toggleIntent = (k: IntentKind) => {
    setSelectedIntents((cur) => {
      const next = new Set(cur);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  };

  const generateImages = async () => {
    if (selectedIntents.size === 0) {
      await alertMessage("Select at least one image size");
      return;
    }
    setGenerating(true);
    try {
      const body: Record<string, unknown> = { intents: Array.from(selectedIntents) };
      if (promptOverride.trim()) body.promptOverride = promptOverride.trim();
      const result = await growthSend<{ assets: MediaAsset[]; errors: { intent: string; error: string }[] }>(
        "POST", `/admin/growth/content/${id}/media/generate`, body,
      );
      await load();
      if (result?.errors?.length) {
        await alertMessage(
          "Some images failed",
          result.errors.map((e) => `${e.intent}: ${e.error}`).join("\n"),
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown";
      if (msg.includes("image_provider_not_configured") || msg.includes("not connected")) {
        await alertMessage(
          "Image generation not configured",
          "Connect the Replit OpenAI integration to enable AI image generation, then try again.",
        );
      } else {
        await alertMessage("Generation failed", msg);
      }
    } finally { setGenerating(false); }
  };

  const reviewAsset = async (assetId: number, status: "approved" | "rejected") => {
    try {
      await growthSend("PATCH", `/admin/growth/media/${assetId}`, { status });
      await load();
    } catch (e) {
      await alertMessage("Update failed", e instanceof Error ? e.message : "Unknown");
    }
  };

  const deleteAsset = async (assetId: number) => {
    const ok = await confirm({
      title: "Delete image?",
      message: "This permanently deletes the generated image.",
      confirmText: "Delete", destructive: true,
    });
    if (!ok) return;
    try {
      await growthSend("DELETE", `/admin/growth/media/${assetId}`);
      await load();
    } catch (e) {
      await alertMessage("Delete failed", e instanceof Error ? e.message : "Unknown");
    }
  };

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

      {/* AI Image Generation */}
      <Text style={[s.section, { color: colors.foreground }]}>AI Images</Text>
      <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[s.cardLabel, { color: colors.mutedForeground }]}>
          Generate visuals from this post
        </Text>
        <Text style={{ color: colors.mutedForeground, fontSize: 11, marginTop: 4, marginBottom: 12 }}>
          Uses the post's caption + media ideas. All images land in this review queue — nothing publishes automatically.
        </Text>

        {/* Intent chips */}
        <View style={s.chipRow}>
          {INTENT_OPTIONS.map((opt) => {
            const active = selectedIntents.has(opt.value);
            return (
              <Pressable
                key={opt.value}
                onPress={() => toggleIntent(opt.value)}
                style={[
                  s.intentChip,
                  {
                    backgroundColor: active ? colors.primary : colors.background,
                    borderColor: active ? colors.primary : colors.border,
                  },
                ]}
              >
                <Text style={{ color: active ? "#fff" : colors.foreground, fontSize: 12, fontWeight: "600" }}>
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={[s.cardLabel, { color: colors.mutedForeground, marginTop: 12 }]}>
          Prompt override (optional)
        </Text>
        <TextInput
          value={promptOverride}
          onChangeText={setPromptOverride}
          multiline
          placeholder="Leave blank to auto-build from caption + media ideas."
          placeholderTextColor={colors.mutedForeground}
          style={[s.editInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background, minHeight: 80 }]}
        />

        <Pressable
          style={[s.btn, { backgroundColor: colors.primary, marginTop: 12, opacity: generating ? 0.6 : 1 }]}
          onPress={generateImages}
          disabled={generating || post.status === "published"}
        >
          {generating ? <ActivityIndicator color="#fff" size="small" /> : (
            <>
              <Feather name="image" size={14} color="#fff" />
              <Text style={s.btnText}>Generate images</Text>
            </>
          )}
        </Pressable>
      </View>

      {assets.length > 0 && (
        <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[s.cardLabel, { color: colors.mutedForeground, marginBottom: 10 }]}>
            Generated assets ({assets.length})
          </Text>
          {assets.map((a) => {
            const meta = ASSET_STATUS_LABEL[a.status];
            const showImage = a.status !== "generating" && a.status !== "failed" && a.url;
            const imageUri = showImage ? `${ASSET_ORIGIN}${a.url}` : null;
            return (
              <View key={a.id} style={[s.assetRow, { borderColor: colors.border }]}>
                <View style={[s.assetThumb, { backgroundColor: colors.background, borderColor: colors.border }]}>
                  {imageUri ? (
                    <Image source={{ uri: imageUri }} style={s.assetImg} resizeMode="cover" />
                  ) : a.status === "generating" ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <Feather name="alert-triangle" size={20} color="#EF4444" />
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <View style={[s.miniBadge, { backgroundColor: meta.color + "22" }]}>
                      <Text style={{ color: meta.color, fontSize: 10, fontWeight: "700" }}>
                        {meta.label}
                      </Text>
                    </View>
                    <Text style={{ color: colors.mutedForeground, fontSize: 10 }}>
                      {a.aspectRatio} · {a.intent.replace(/_/g, " ")}
                    </Text>
                  </View>
                  {a.providerModel && (
                    <Text style={{ color: colors.mutedForeground, fontSize: 10, marginTop: 2 }}>
                      {a.providerModel}
                    </Text>
                  )}
                  {a.failureReason && (
                    <Text style={{ color: "#EF4444", fontSize: 10, marginTop: 4 }} numberOfLines={3}>
                      {a.failureReason}
                    </Text>
                  )}
                  <View style={{ flexDirection: "row", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                    {a.status === "ready" && (
                      <>
                        <Pressable
                          style={[s.miniBtn, { backgroundColor: "#22C55E22", borderColor: "#22C55E55" }]}
                          onPress={() => reviewAsset(a.id, "approved")}
                        >
                          <Text style={{ color: "#22C55E", fontSize: 11, fontWeight: "700" }}>Approve</Text>
                        </Pressable>
                        <Pressable
                          style={[s.miniBtn, { backgroundColor: "#EF444422", borderColor: "#EF444455" }]}
                          onPress={() => reviewAsset(a.id, "rejected")}
                        >
                          <Text style={{ color: "#EF4444", fontSize: 11, fontWeight: "700" }}>Reject</Text>
                        </Pressable>
                      </>
                    )}
                    {a.status === "approved" && (
                      <Pressable
                        style={[s.miniBtn, { backgroundColor: "#EF444422", borderColor: "#EF444455" }]}
                        onPress={() => reviewAsset(a.id, "rejected")}
                      >
                        <Text style={{ color: "#EF4444", fontSize: 11, fontWeight: "700" }}>Reject</Text>
                      </Pressable>
                    )}
                    {a.status === "rejected" && (
                      <Pressable
                        style={[s.miniBtn, { backgroundColor: "#22C55E22", borderColor: "#22C55E55" }]}
                        onPress={() => reviewAsset(a.id, "approved")}
                      >
                        <Text style={{ color: "#22C55E", fontSize: 11, fontWeight: "700" }}>Approve</Text>
                      </Pressable>
                    )}
                    <Pressable
                      style={[s.miniBtn, { backgroundColor: "#9CA3AF22", borderColor: "#9CA3AF55" }]}
                      onPress={() => deleteAsset(a.id)}
                    >
                      <Feather name="trash-2" size={11} color="#9CA3AF" />
                    </Pressable>
                  </View>
                </View>
              </View>
            );
          })}
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
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  intentChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, borderWidth: 1 },
  assetRow: { flexDirection: "row", gap: 10, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth },
  assetThumb: { width: 72, height: 72, borderRadius: 8, borderWidth: 1, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  assetImg: { width: "100%", height: "100%" },
  miniBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  miniBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, borderWidth: 1, flexDirection: "row", alignItems: "center", gap: 4 },
});
