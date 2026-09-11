/**
 * Mechanic Amplification Kit — per-mechanic growth-node screen.
 *
 * Tabs:
 *   1. Kit          — QR, booking link, vCard download, business card download
 *   2. Page         — customize tagline / bio / brand color / handles
 *   3. AI content   — request spotlight / book-with-me / referral push drafts
 *                     (queue for admin approval); list approved posts to repost
 *
 * Sharing uses React Native's Share API + downloadable file URLs — never
 * autonomous publishing.
 */

import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator,
  Pressable, TextInput, Image, Share, Platform, RefreshControl,
} from "react-native";
import { useColors } from "@/hooks/useColors";
import { Feather } from "@expo/vector-icons";
import { useState, useEffect, useCallback, useMemo } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Clipboard from "expo-clipboard";
import * as WebBrowser from "expo-web-browser";
import { getApiUrl } from "@/lib/apiConfig";

async function authedFetch(path: string, init?: RequestInit) {
  const token = await AsyncStorage.getItem("auth_token");
  return fetch(getApiUrl(path), {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
  });
}

interface Kit {
  mechanic: { id: number; name: string; region: string | null; city: string | null; referralCode: string | null };
  page: {
    displayName: string | null; tagline: string | null; bio: string | null; specialty: string | null;
    brandColor: string | null;
    instagramHandle: string | null; facebookHandle: string | null; tiktokHandle: string | null; twitterHandle: string | null;
    pageEnabled: boolean;
  } | null;
  links: { personalRefLink: string; personalBookingLink: string; appStoreLink: string; playStoreLink: string };
  qrPngDataUrl: string;
  vCard: string;
  businessCardSvg: string;
  socialPostStarters: { platform: string; text: string }[];
}

interface ContentPost {
  id: number; platform: string; status: string; topicTitle: string | null;
  caption: string; hashtags: string[]; callToAction: string | null;
  hookText: string | null; createdAt: string;
}

const PLATFORM_META: Record<string, { label: string; color: string; icon: string }> = {
  facebook: { label: "Facebook", color: "#1877F2", icon: "facebook" },
  instagram: { label: "Instagram", color: "#E1306C", icon: "instagram" },
  tiktok: { label: "TikTok", color: "#000000", icon: "music" },
  twitter: { label: "X / Twitter", color: "#1DA1F2", icon: "twitter" },
};

const STATUS_META: Record<string, { label: string; color: string }> = {
  draft: { label: "Draft", color: "#9CA3AF" },
  pending_review: { label: "Pending admin review", color: "#F59E0B" },
  approved: { label: "Approved — ready to share", color: "#22C55E" },
  rejected: { label: "Rejected", color: "#EF4444" },
  scheduled: { label: "Scheduled", color: "#6366F1" },
  published: { label: "Published", color: "#0EA5E9" },
};

export default function AmplificationScreen() {
  const colors = useColors();
  const [tab, setTab] = useState<"kit" | "page" | "content">("kit");
  const [kit, setKit] = useState<Kit | null>(null);
  const [posts, setPosts] = useState<ContentPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // page form state
  const [tagline, setTagline] = useState("");
  const [bio, setBio] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [brandColor, setBrandColor] = useState("");
  const [igHandle, setIgHandle] = useState("");
  const [fbHandle, setFbHandle] = useState("");
  const [ttHandle, setTtHandle] = useState("");
  const [twHandle, setTwHandle] = useState("");
  const [savingPage, setSavingPage] = useState(false);

  // content form
  const [variant, setVariant] = useState<"spotlight" | "book_with_me" | "referral_push">("book_with_me");
  const [contentPlatform, setContentPlatform] = useState<keyof typeof PLATFORM_META>("instagram");
  const [briefing, setBriefing] = useState("");
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [kitRes, contentRes] = await Promise.all([
        authedFetch("/mechanics/me/amplification"),
        authedFetch("/mechanics/me/amplification/content"),
      ]);
      if (!kitRes.ok) throw new Error(await kitRes.text() || "Failed to load kit");
      const k: Kit = await kitRes.json();
      setKit(k);
      setTagline(k.page?.tagline ?? "");
      setBio(k.page?.bio ?? "");
      setSpecialty(k.page?.specialty ?? "");
      setBrandColor(k.page?.brandColor ?? "");
      setIgHandle(k.page?.instagramHandle ?? "");
      setFbHandle(k.page?.facebookHandle ?? "");
      setTtHandle(k.page?.tiktokHandle ?? "");
      setTwHandle(k.page?.twitterHandle ?? "");
      if (contentRes.ok) {
        const c = await contentRes.json();
        setPosts(c.posts ?? []);
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to load"); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const savePage = useCallback(async () => {
    setSavingPage(true);
    try {
      const body: Record<string, unknown> = {
        tagline: tagline.trim() || null,
        bio: bio.trim() || null,
        specialty: specialty.trim() || null,
        instagramHandle: igHandle.trim() || null,
        facebookHandle: fbHandle.trim() || null,
        tiktokHandle: ttHandle.trim() || null,
        twitterHandle: twHandle.trim() || null,
      };
      const c = brandColor.trim();
      if (c) {
        if (!/^#[0-9A-Fa-f]{6}$/.test(c)) throw new Error("Brand color must be a hex like #F97316");
        body.brandColor = c;
      } else {
        body.brandColor = null;
      }
      const r = await authedFetch("/mechanics/me/amplification", { method: "PATCH", body: JSON.stringify(body) });
      if (!r.ok) throw new Error(await r.text() || "Save failed");
      setInfo("Page updated.");
      load();
    } catch (e) { setError(e instanceof Error ? e.message : "Save failed"); }
    finally { setSavingPage(false); }
  }, [tagline, bio, specialty, brandColor, igHandle, fbHandle, ttHandle, twHandle, load]);

  const generate = useCallback(async () => {
    setGenerating(true); setError(null); setInfo(null);
    try {
      const r = await authedFetch("/mechanics/me/amplification/content", {
        method: "POST",
        body: JSON.stringify({ variant, platform: contentPlatform, briefingContext: briefing.trim() || null }),
      });
      if (!r.ok) throw new Error(await r.text() || "Generation failed");
      setInfo("Submitted to admin for approval. You can repost once approved.");
      setBriefing("");
      load();
    } catch (e) { setError(e instanceof Error ? e.message : "Generation failed"); }
    finally { setGenerating(false); }
  }, [variant, contentPlatform, briefing, load]);

  const copy = useCallback(async (text: string, label: string) => {
    await Clipboard.setStringAsync(text);
    setInfo(`${label} copied.`);
  }, []);

  const share = useCallback(async (text: string) => {
    try { await Share.share({ message: text }); }
    catch { /* user cancelled */ }
  }, []);

  if (loading) return <View style={[styles.center, { backgroundColor: colors.background }]}><ActivityIndicator size="large" color={colors.primary} /></View>;

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: 16, paddingBottom: 140 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
    >
      <View style={[styles.hero, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={[styles.heroIcon, { backgroundColor: "#F97316" + "20" }]}>
          <Feather name="zap" size={22} color="#F97316" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.heroTitle, { color: colors.foreground }]}>Amplification Kit</Text>
          <Text style={[styles.heroSub, { color: colors.mutedForeground }]}>
            Become your neighborhood's APS growth node. Your QR, booking link, and AI content in one place.
          </Text>
        </View>
      </View>

      {info ? <View style={[styles.banner, { backgroundColor: "#22C55E" + "18", borderColor: "#22C55E40" }]}><Feather name="check-circle" size={14} color="#22C55E" /><Text style={{ color: "#16A34A", flex: 1, fontSize: 12 }}>{info}</Text></View> : null}
      {error ? <View style={[styles.banner, { backgroundColor: colors.destructive + "18", borderColor: colors.destructive + "30" }]}><Feather name="alert-triangle" size={14} color={colors.destructive} /><Text style={{ color: colors.destructive, flex: 1, fontSize: 12 }}>{error}</Text></View> : null}

      <View style={[styles.tabs, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {(["kit", "page", "content"] as const).map((t) => (
          <Pressable key={t} onPress={() => setTab(t)} style={[styles.tab, tab === t && { backgroundColor: colors.primary + "20" }]}>
            <Text style={{ color: tab === t ? colors.primary : colors.mutedForeground, fontWeight: "700", fontSize: 12, textTransform: "capitalize" }}>{t === "content" ? "AI content" : t}</Text>
          </Pressable>
        ))}
      </View>

      {tab === "kit" && kit && (
        <KitTab kit={kit} onCopy={copy} onShare={share} />
      )}

      {tab === "page" && kit && (
        <View>
          <Text style={[styles.section, { color: colors.foreground }]}>Public page customization</Text>
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Field label="Tagline" max={120} value={tagline} onChange={setTagline} placeholder="e.g. 30 years under the hood — same-day diagnostics" colors={colors} />
            <Field label="Bio" max={600} value={bio} onChange={setBio} placeholder="Tell drivers about your shop, training, and what you specialize in." multiline colors={colors} />
            <Field label="Specialty" max={80} value={specialty} onChange={setSpecialty} placeholder="e.g. European diagnostics" colors={colors} />
            <Field label="Brand color (hex)" max={7} value={brandColor} onChange={setBrandColor} placeholder="#F97316" colors={colors} />
            <Field label="Instagram handle" max={40} value={igHandle} onChange={setIgHandle} placeholder="without @" colors={colors} />
            <Field label="Facebook page" max={80} value={fbHandle} onChange={setFbHandle} placeholder="page name or URL" colors={colors} />
            <Field label="TikTok handle" max={40} value={ttHandle} onChange={setTtHandle} placeholder="without @" colors={colors} />
            <Field label="X / Twitter handle" max={40} value={twHandle} onChange={setTwHandle} placeholder="without @" colors={colors} />
            <Pressable onPress={savePage} disabled={savingPage} style={({ pressed }) => [styles.btn, { backgroundColor: colors.primary, opacity: savingPage || pressed ? 0.7 : 1 }]}>
              <Text style={{ color: "#fff", fontWeight: "700" }}>{savingPage ? "Saving…" : "Save page"}</Text>
            </Pressable>
          </View>
        </View>
      )}

      {tab === "content" && (
        <View>
          <Text style={[styles.section, { color: colors.foreground }]}>Request AI content</Text>
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.fieldLabel, { color: colors.foreground }]}>Variant</Text>
            <View style={styles.chipRow}>
              {([
                { v: "book_with_me", l: "Book with me" },
                { v: "spotlight", l: "Spotlight" },
                { v: "referral_push", l: "Referral push" },
              ] as const).map((o) => (
                <Pressable key={o.v} onPress={() => setVariant(o.v)} style={[styles.chip, { borderColor: colors.border }, variant === o.v && { backgroundColor: colors.primary, borderColor: colors.primary }]}>
                  <Text style={{ color: variant === o.v ? "#fff" : colors.foreground, fontSize: 12, fontWeight: "700" }}>{o.l}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={[styles.fieldLabel, { color: colors.foreground, marginTop: 14 }]}>Platform</Text>
            <View style={styles.chipRow}>
              {(Object.keys(PLATFORM_META) as (keyof typeof PLATFORM_META)[]).map((p) => (
                <Pressable key={p} onPress={() => setContentPlatform(p)} style={[styles.chip, { borderColor: colors.border }, contentPlatform === p && { backgroundColor: PLATFORM_META[p].color, borderColor: PLATFORM_META[p].color }]}>
                  <Feather name={PLATFORM_META[p].icon as keyof typeof Feather.glyphMap} size={12} color={contentPlatform === p ? "#fff" : colors.foreground} />
                  <Text style={{ color: contentPlatform === p ? "#fff" : colors.foreground, fontSize: 12, fontWeight: "700", marginLeft: 4 }}>{PLATFORM_META[p].label}</Text>
                </Pressable>
              ))}
            </View>
            <Field label="Briefing (optional)" max={1000} value={briefing} onChange={setBriefing} placeholder="Anything specific to mention this week?" multiline colors={colors} />
            <Pressable onPress={generate} disabled={generating} style={({ pressed }) => [styles.btn, { backgroundColor: colors.primary, opacity: generating || pressed ? 0.7 : 1 }]}>
              <Text style={{ color: "#fff", fontWeight: "700" }}>{generating ? "Generating…" : "Submit for admin approval"}</Text>
            </Pressable>
            <Text style={{ color: colors.mutedForeground, fontSize: 11, marginTop: 8, textAlign: "center" }}>
              All AI content is reviewed by an admin before you can repost it.
            </Text>
          </View>

          <Text style={[styles.section, { color: colors.foreground, marginTop: 18 }]}>Your content ({posts.length})</Text>
          {posts.length === 0 ? (
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>No content yet. Generate your first draft above.</Text>
            </View>
          ) : posts.map((p) => {
            const meta = PLATFORM_META[p.platform] ?? PLATFORM_META.facebook;
            const status = STATUS_META[p.status] ?? STATUS_META.draft;
            const fullText = `${p.caption}\n\n${(p.hashtags ?? []).join(" ")}`;
            const canShare = p.status === "approved" || p.status === "published" || p.status === "scheduled";
            return (
              <View key={p.id} style={[styles.postCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.postHead}>
                  <View style={[styles.platformDot, { backgroundColor: meta.color + "20" }]}>
                    <Feather name={meta.icon as keyof typeof Feather.glyphMap} size={12} color={meta.color} />
                  </View>
                  <Text style={{ color: colors.foreground, fontSize: 12, fontWeight: "700" }}>{meta.label}</Text>
                  <View style={{ flex: 1 }} />
                  <View style={[styles.statusPill, { backgroundColor: status.color + "20" }]}>
                    <Text style={{ color: status.color, fontSize: 10, fontWeight: "700" }}>{status.label}</Text>
                  </View>
                </View>
                {p.topicTitle && <Text style={{ color: colors.mutedForeground, fontSize: 11, marginBottom: 6 }}>{p.topicTitle}</Text>}
                <Text style={{ color: colors.foreground, fontSize: 13, lineHeight: 18 }} numberOfLines={6}>{p.caption}</Text>
                {p.hashtags?.length > 0 && <Text style={{ color: meta.color, fontSize: 11, marginTop: 6 }}>{p.hashtags.join(" ")}</Text>}
                <View style={styles.postActions}>
                  <Pressable onPress={() => copy(fullText, "Post")} style={[styles.smallBtn, { borderColor: colors.border }]}>
                    <Feather name="copy" size={12} color={colors.foreground} />
                    <Text style={{ color: colors.foreground, fontSize: 11, fontWeight: "700" }}>Copy</Text>
                  </Pressable>
                  {canShare && (
                    <Pressable onPress={() => share(fullText)} style={[styles.smallBtn, { backgroundColor: colors.primary, borderColor: colors.primary }]}>
                      <Feather name="share-2" size={12} color="#fff" />
                      <Text style={{ color: "#fff", fontSize: 11, fontWeight: "700" }}>Share</Text>
                    </Pressable>
                  )}
                </View>
              </View>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}

function KitTab({ kit, onCopy, onShare }: {
  kit: Kit;
  onCopy: (s: string, label: string) => void;
  onShare: (s: string) => void;
}) {
  const colors = useColors();
  const code = kit.mechanic.referralCode ?? "—";
  const link = kit.links.personalBookingLink;
  const cardSvgUrl = kit.mechanic.referralCode
    ? getApiUrl(`/p/m/${encodeURIComponent(kit.mechanic.referralCode)}/card.svg`)
    : null;
  const vcardUrl = kit.mechanic.referralCode
    ? getApiUrl(`/p/m/${encodeURIComponent(kit.mechanic.referralCode)}/vcard`)
    : null;

  return (
    <View>
      <Text style={[styles.section, { color: colors.foreground }]}>Your QR + booking link</Text>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, alignItems: "center" }]}>
        <View style={{ backgroundColor: "#fff", padding: 12, borderRadius: 12 }}>
          {kit.qrPngDataUrl ? <Image source={{ uri: kit.qrPngDataUrl }} style={{ width: 200, height: 200 }} /> : null}
        </View>
        <Text style={{ color: colors.mutedForeground, fontSize: 11, marginTop: 10, textAlign: "center" }}>{link}</Text>
        <Text style={{ color: "#F97316", fontSize: 22, fontWeight: "800", letterSpacing: 2, marginTop: 8 }}>{code}</Text>
        <View style={{ flexDirection: "row", gap: 8, marginTop: 14 }}>
          <Pressable onPress={() => onCopy(link, "Link")} style={[styles.smallBtn, { borderColor: colors.border }]}>
            <Feather name="copy" size={12} color={colors.foreground} />
            <Text style={{ color: colors.foreground, fontSize: 11, fontWeight: "700" }}>Copy link</Text>
          </Pressable>
          <Pressable onPress={() => onShare(`Book with me on APS: ${link} — code ${code}`)} style={[styles.smallBtn, { backgroundColor: "#F97316", borderColor: "#F97316" }]}>
            <Feather name="share-2" size={12} color="#fff" />
            <Text style={{ color: "#fff", fontSize: 11, fontWeight: "700" }}>Share</Text>
          </Pressable>
        </View>
      </View>

      <Text style={[styles.section, { color: colors.foreground, marginTop: 18 }]}>Downloadables</Text>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <DownloadRow icon="credit-card" label="Printable business card (SVG)" url={cardSvgUrl} colors={colors} />
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <DownloadRow icon="user" label="Digital business card (vCard / .vcf)" url={vcardUrl} colors={colors} />
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <DownloadRow icon="external-link" label="Preview your public page" url={link} colors={colors} />
      </View>

      <Text style={[styles.section, { color: colors.foreground, marginTop: 18 }]}>Ready-to-share starter posts</Text>
      {kit.socialPostStarters.map((s) => {
        const meta = PLATFORM_META[s.platform] ?? PLATFORM_META.facebook;
        return (
          <View key={s.platform} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, marginBottom: 8 }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <Feather name={meta.icon as keyof typeof Feather.glyphMap} size={14} color={meta.color} />
              <Text style={{ color: colors.foreground, fontWeight: "700", fontSize: 12 }}>{meta.label} starter</Text>
            </View>
            <Text style={{ color: colors.foreground, fontSize: 13, lineHeight: 18 }}>{s.text}</Text>
            <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
              <Pressable onPress={() => onCopy(s.text, meta.label)} style={[styles.smallBtn, { borderColor: colors.border }]}>
                <Feather name="copy" size={12} color={colors.foreground} />
                <Text style={{ color: colors.foreground, fontSize: 11, fontWeight: "700" }}>Copy</Text>
              </Pressable>
              <Pressable onPress={() => onShare(s.text)} style={[styles.smallBtn, { backgroundColor: meta.color, borderColor: meta.color }]}>
                <Feather name="share-2" size={12} color="#fff" />
                <Text style={{ color: "#fff", fontSize: 11, fontWeight: "700" }}>Share</Text>
              </Pressable>
            </View>
          </View>
        );
      })}
    </View>
  );
}

function DownloadRow({ icon, label, url, colors }: {
  icon: string; label: string; url: string | null; colors: ReturnType<typeof useColors>;
}) {
  return (
    <Pressable
      disabled={!url}
      onPress={async () => {
        if (!url) return;
        if (Platform.OS === "web") { window.open(url, "_blank"); return; }
        await WebBrowser.openBrowserAsync(url);
      }}
      style={[styles.row, { opacity: url ? 1 : 0.5 }]}
    >
      <View style={[styles.rowIcon, { backgroundColor: colors.secondary }]}>
        <Feather name={icon as keyof typeof Feather.glyphMap} size={16} color={colors.foreground} />
      </View>
      <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: "600", flex: 1 }}>{label}</Text>
      <Feather name="download" size={16} color={colors.mutedForeground} />
    </Pressable>
  );
}

function Field({
  label, value, onChange, placeholder, multiline, max, colors,
}: {
  label: string; value: string; onChange: (s: string) => void; placeholder: string;
  multiline?: boolean; max: number; colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={{ marginBottom: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 6 }}>
        <Text style={[styles.fieldLabel, { color: colors.foreground, flex: 1 }]}>{label}</Text>
        <Text style={{ color: colors.mutedForeground, fontSize: 10 }}>{value.length}/{max}</Text>
      </View>
      <TextInput
        value={value}
        onChangeText={(s) => s.length <= max && onChange(s)}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        multiline={multiline}
        style={[
          styles.input,
          {
            backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border,
            minHeight: multiline ? 80 : 44, textAlignVertical: multiline ? "top" : "center",
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  hero: { flexDirection: "row", alignItems: "center", gap: 14, padding: 16, borderRadius: 16, borderWidth: 1, marginBottom: 14 },
  heroIcon: { width: 48, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  heroTitle: { fontSize: 17, fontWeight: "800" },
  heroSub: { fontSize: 12, marginTop: 4, lineHeight: 16 },
  banner: { flexDirection: "row", gap: 8, padding: 10, borderRadius: 10, borderWidth: 1, alignItems: "center", marginBottom: 10 },
  tabs: { flexDirection: "row", padding: 4, borderRadius: 12, borderWidth: 1, marginBottom: 14 },
  tab: { flex: 1, paddingVertical: 10, alignItems: "center", borderRadius: 10 },
  section: { fontSize: 14, fontWeight: "700", marginBottom: 8, marginTop: 4 },
  card: { padding: 14, borderRadius: 14, borderWidth: 1 },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 10 },
  fieldLabel: { fontSize: 12, fontWeight: "700" },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  btn: { paddingVertical: 12, alignItems: "center", borderRadius: 10, marginTop: 6 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 },
  rowIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, flexDirection: "row", alignItems: "center" },
  postCard: { padding: 14, borderRadius: 14, borderWidth: 1, marginBottom: 8 },
  postHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  platformDot: { width: 24, height: 24, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  statusPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  postActions: { flexDirection: "row", gap: 8, marginTop: 10 },
  smallBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1 },
});
