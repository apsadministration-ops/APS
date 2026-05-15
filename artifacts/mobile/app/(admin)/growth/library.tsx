import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable, RefreshControl, Image } from "react-native";
import { useColors } from "@/hooks/useColors";
import { Feather } from "@expo/vector-icons";
import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "expo-router";
import { alertMessage } from "@/utils/confirm";
import { growthGet, PLATFORMS, STATUS_LABELS } from "@/lib/growthApi";

const ASSET_ORIGIN = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;

interface LibraryThumb { id: number; kind: "image" | "video"; url: string | null; aspectRatio: string }
interface LibraryPost {
  id: number;
  platform: string;
  status: string;
  topicKind: string;
  topicTitle: string;
  caption: string;
  engagementScore: number;
  engagement: { likes?: number; shares?: number; comments?: number; saves?: number; clicks?: number; impressions?: number };
  publishedAt: string | null;
  scheduledFor: string | null;
  createdAt: string;
  reuseCount: number;
  parentPostId: number | null;
  reusedFromId: number | null;
  thumb: LibraryThumb | null;
}
interface LibraryResponse { total: number; limit: number; offset: number; posts: LibraryPost[] }
interface LibraryStats { byStatus: Record<string, number>; topPost: { id: number; topicTitle: string; platform: string; engagementScore: number } | null }

type SortKey = "recent" | "engagement" | "published";

export default function LibraryScreen() {
  const colors = useColors();
  const router = useRouter();
  const [data, setData] = useState<LibraryResponse | null>(null);
  const [stats, setStats] = useState<LibraryStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Filters
  const [platform, setPlatform] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>("recent");

  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    if (platform) p.set("platform", platform);
    if (status) p.set("status", status);
    p.set("sort", sort);
    p.set("limit", "60");
    return p.toString();
  }, [platform, status, sort]);

  const load = useCallback(async () => {
    try {
      const [d, st] = await Promise.all([
        growthGet<LibraryResponse>(`/admin/growth/library?${queryString}`),
        growthGet<LibraryStats>(`/admin/growth/library/stats`).catch(() => null),
      ]);
      setData(d);
      if (st) setStats(st);
    } catch (e) {
      await alertMessage("Load failed", e instanceof Error ? e.message : "Unknown");
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, [queryString]);
  useEffect(() => { load(); }, [load]);

  return (
    <ScrollView
      style={[s.container, { backgroundColor: colors.background }]}
      contentContainerStyle={{ padding: 16, paddingBottom: 140 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
    >
      <View style={[s.heroCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={[s.heroBadge, { backgroundColor: colors.primary + "18" }]}>
          <Feather name="archive" size={22} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[s.heroTitle, { color: colors.foreground }]}>Content Asset Library</Text>
          <Text style={[s.heroSub, { color: colors.mutedForeground }]}>
            Every piece of generated content with its engagement performance — sort by winners, drill into details, decide what to iterate or reuse.
          </Text>
        </View>
      </View>

      {stats && (
        <View style={s.statRow}>
          {(["pending_review", "approved", "scheduled", "published", "rejected"] as const).map((k) => {
            const meta = STATUS_LABELS[k];
            const n = stats.byStatus[k] ?? 0;
            return (
              <Pressable
                key={k}
                onPress={() => setStatus(status === k ? null : k)}
                style={[s.statCard, {
                  backgroundColor: colors.card,
                  borderColor: status === k ? meta.color : colors.border,
                  borderWidth: status === k ? 2 : 1,
                }]}
              >
                <Text style={{ color: meta.color, fontSize: 10, fontWeight: "800" }}>{meta.label.toUpperCase()}</Text>
                <Text style={{ color: colors.foreground, fontSize: 18, fontWeight: "800", marginTop: 2 }}>{n}</Text>
              </Pressable>
            );
          })}
        </View>
      )}

      {stats?.topPost && (
        <Pressable
          onPress={() => router.push(`/(admin)/growth/content/${stats.topPost!.id}`)}
          style={[s.topCard, { backgroundColor: "#F59E0B11", borderColor: "#F59E0B55" }]}
        >
          <Feather name="award" size={18} color="#F59E0B" />
          <View style={{ flex: 1 }}>
            <Text style={{ color: "#92400E", fontSize: 10, fontWeight: "800" }}>TOP PERFORMER</Text>
            <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: "700" }} numberOfLines={1}>
              {stats.topPost.topicTitle}
            </Text>
            <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>
              {stats.topPost.platform} · engagement score {stats.topPost.engagementScore}
            </Text>
          </View>
          <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
        </Pressable>
      )}

      <Text style={[s.section, { color: colors.foreground }]}>Filters</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
        <View style={{ flexDirection: "row", gap: 6 }}>
          <Chip label="All platforms" active={!platform} onPress={() => setPlatform(null)} />
          {PLATFORMS.map((p) => (
            <Chip key={p.value} label={p.label} active={platform === p.value}
              onPress={() => setPlatform(platform === p.value ? null : p.value)} color={p.color} />
          ))}
        </View>
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
        <View style={{ flexDirection: "row", gap: 6 }}>
          <Chip label="Newest" active={sort === "recent"} onPress={() => setSort("recent")} />
          <Chip label="Engagement" active={sort === "engagement"} onPress={() => setSort("engagement")} />
          <Chip label="Most recent post" active={sort === "published"} onPress={() => setSort("published")} />
        </View>
      </ScrollView>

      {loading ? (
        <View style={s.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : !data || data.posts.length === 0 ? (
        <View style={[s.empty, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="inbox" size={28} color={colors.mutedForeground} />
          <Text style={{ color: colors.mutedForeground, marginTop: 8 }}>No content matches these filters.</Text>
        </View>
      ) : (
        <>
          <Text style={[s.resultsCount, { color: colors.mutedForeground }]}>
            Showing {data.posts.length} of {data.total}
          </Text>
          <View style={s.grid}>
            {data.posts.map((post) => {
              const statusMeta = STATUS_LABELS[post.status];
              const platformMeta = PLATFORMS.find((p) => p.value === post.platform);
              const thumbUri = post.thumb?.url ? `${ASSET_ORIGIN}${post.thumb.url}` : null;
              return (
                <Pressable
                  key={post.id}
                  onPress={() => router.push(`/(admin)/growth/content/${post.id}`)}
                  style={({ pressed }) => [s.cardWrap, { opacity: pressed ? 0.8 : 1 }]}
                >
                  <View style={[s.thumb, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    {thumbUri && post.thumb?.kind === "image" ? (
                      <Image source={{ uri: thumbUri }} style={s.thumbImg} resizeMode="cover" />
                    ) : thumbUri && post.thumb?.kind === "video" ? (
                      <View style={[s.thumbImg, s.center, { backgroundColor: "#1F2937" }]}>
                        <Feather name="film" size={28} color="#fff" />
                      </View>
                    ) : (
                      <View style={[s.thumbImg, s.center]}>
                        <Feather name="image" size={22} color={colors.mutedForeground} />
                      </View>
                    )}
                    <View style={[s.thumbStatus, { backgroundColor: statusMeta.color + "EE" }]}>
                      <Text style={{ color: "#fff", fontSize: 9, fontWeight: "800" }}>{statusMeta.label}</Text>
                    </View>
                    {post.engagementScore > 0 && (
                      <View style={s.thumbScore}>
                        <Feather name="trending-up" size={9} color="#fff" />
                        <Text style={{ color: "#fff", fontSize: 10, fontWeight: "800" }}>{post.engagementScore}</Text>
                      </View>
                    )}
                  </View>
                  <View style={{ paddingHorizontal: 4, paddingTop: 6 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                      <Feather name={(platformMeta?.icon ?? "globe") as keyof typeof Feather.glyphMap}
                        size={10} color={platformMeta?.color ?? colors.mutedForeground} />
                      <Text style={{ color: platformMeta?.color ?? colors.mutedForeground, fontSize: 10, fontWeight: "700" }}>
                        {platformMeta?.label ?? post.platform}
                      </Text>
                      {post.reuseCount > 0 && (
                        <Text style={{ color: "#10B981", fontSize: 10, fontWeight: "700" }}>· {post.reuseCount}× reused</Text>
                      )}
                    </View>
                    <Text style={{ color: colors.foreground, fontSize: 12, fontWeight: "700", marginTop: 2 }} numberOfLines={2}>
                      {post.topicTitle}
                    </Text>
                    {(post.engagement.likes != null || post.engagement.shares != null || post.engagement.comments != null) && (
                      <Text style={{ color: colors.mutedForeground, fontSize: 10, marginTop: 4 }}>
                        {[
                          post.engagement.likes != null ? `${post.engagement.likes}♥` : null,
                          post.engagement.shares != null ? `${post.engagement.shares}↗` : null,
                          post.engagement.comments != null ? `${post.engagement.comments}💬` : null,
                        ].filter(Boolean).join("  ")}
                      </Text>
                    )}
                  </View>
                </Pressable>
              );
            })}
          </View>
        </>
      )}
    </ScrollView>
  );
}

function Chip({ label, active, onPress, color }: { label: string; active: boolean; onPress: () => void; color?: string }) {
  const colors = useColors();
  const c = color ?? colors.primary;
  return (
    <Pressable
      onPress={onPress}
      style={[s.chip, {
        backgroundColor: active ? c : colors.card,
        borderColor: active ? c : colors.border,
      }]}
    >
      <Text style={{ color: active ? "#fff" : colors.foreground, fontSize: 12, fontWeight: "600" }}>
        {label}
      </Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  center: { alignItems: "center", justifyContent: "center", paddingVertical: 60 },
  heroCard: { flexDirection: "row", alignItems: "center", gap: 14, padding: 16, borderRadius: 16, borderWidth: 1, marginBottom: 14 },
  heroBadge: { width: 48, height: 48, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  heroTitle: { fontSize: 17, fontWeight: "800" },
  heroSub: { fontSize: 12, marginTop: 4, lineHeight: 16 },
  statRow: { flexDirection: "row", gap: 6, marginBottom: 12, flexWrap: "wrap" },
  statCard: { flex: 1, minWidth: 80, padding: 10, borderRadius: 10, borderWidth: 1 },
  topCard: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 12, borderWidth: 1, marginBottom: 12 },
  section: { fontSize: 13, fontWeight: "700", marginBottom: 6, marginTop: 4 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1 },
  resultsCount: { fontSize: 11, marginBottom: 8 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  cardWrap: { width: "47%" },
  thumb: { aspectRatio: 1, borderRadius: 10, borderWidth: 1, overflow: "hidden", position: "relative" },
  thumbImg: { width: "100%", height: "100%" },
  thumbStatus: { position: "absolute", top: 6, left: 6, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  thumbScore: { position: "absolute", top: 6, right: 6, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: "#000A", flexDirection: "row", alignItems: "center", gap: 3 },
  empty: { alignItems: "center", padding: 32, borderRadius: 14, borderWidth: 1 },
});
