import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator,
  TextInput, Modal, Linking, Platform,
} from "react-native";
import { useEffect, useState, useCallback } from "react";
import { Stack, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { customFetch } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { alertMessage } from "@/utils/confirm";

type Tier = "detailer" | "technician" | "senior" | "advanced" | "master";
const TIER_ORDER: Tier[] = ["detailer", "technician", "senior", "advanced", "master"];
const TIER_LABELS: Record<Tier, string> = {
  detailer: "Detailer",
  technician: "Basic Mechanic",
  senior: "Intermediate Mechanic",
  advanced: "Advanced Mechanic",
  master: "Master Mechanic",
};
const TIER_COLORS: Record<Tier, string> = {
  detailer: "#60A5FA",
  technician: "#34D399",
  senior: "#FBBF24",
  advanced: "#FB923C",
  master: "#F472B6",
};

interface Metrics {
  completedJobs: number;
  averageRating: number | null;
  ratingCount: number;
  unresolvedFlags: number;
  verifiedCertifications: number;
  verifiedAdvancedCertifications: number;
  pendingCertifications: number;
}
interface NextEval {
  from: Tier; to: Tier; summary: string;
  blockers: string[] | null; autoApply: boolean;
  thresholds: Record<string, number | undefined>;
}
interface Progression {
  currentTier: Tier;
  currentTierLabel: string;
  nextTierLabel: string | null;
  metrics: Metrics;
  next: NextEval | null;
  atMaxTier: boolean;
}
interface Cert {
  id: number;
  certificationType: string;
  issuingInstitution: string;
  issueDate: string;
  expirationDate: string | null;
  documentUrl: string;
  documentKind: "pdf" | "image" | "other";
  skillLevel: "basic" | "advanced";
  status: "pending" | "verified" | "rejected";
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
}
interface Promotion {
  id: number;
  previousTier: Tier;
  newTier: Tier;
  reason: string;
  trigger: "system" | "system_flagged" | "admin";
  createdAt: string;
}

export default function ProgressionScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [data, setData] = useState<Progression | null>(null);
  const [certs, setCerts] = useState<Cert[]>([]);
  const [history, setHistory] = useState<Promotion[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [p, c, h] = await Promise.all([
        customFetch<Progression>("/api/mechanic/me/progression"),
        customFetch<Cert[]>("/api/mechanic/me/certifications"),
        customFetch<Promotion[]>("/api/mechanic/me/promotion-history"),
      ]);
      setData(p); setCerts(c); setHistory(h);
    } catch (e) {
      alertMessage("Could not load progression", e instanceof Error ? e.message : "Unknown error");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void fetchAll(); }, [fetchAll]);

  const handleDeleteCert = async (id: number) => {
    try {
      await customFetch(`/api/mechanic/me/certifications/${id}`, { method: "DELETE" });
      await fetchAll();
    } catch (e) {
      alertMessage("Cannot remove", e instanceof Error ? e.message : "Failed");
    }
  };

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (!data) return null;

  const tierIdx = TIER_ORDER.indexOf(data.currentTier);
  const tierColor = TIER_COLORS[data.currentTier];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: "Tier Progression" }} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 120 }}>
        {/* Current tier card */}
        <View style={[styles.tierCard, { backgroundColor: tierColor + "18", borderColor: tierColor + "55" }]}>
          <View style={styles.tierHeader}>
            <View style={[styles.tierBadge, { backgroundColor: tierColor }]}>
              <Text style={styles.tierBadgeText}>TIER {tierIdx + 1}</Text>
            </View>
            <Text style={[styles.tierName, { color: colors.foreground }]}>{data.currentTierLabel}</Text>
          </View>
          {/* Tier ladder */}
          <View style={styles.ladder}>
            {TIER_ORDER.map((t, i) => (
              <View key={t} style={styles.ladderStep}>
                <View style={[
                  styles.ladderDot,
                  {
                    backgroundColor: i <= tierIdx ? TIER_COLORS[t] : colors.border,
                    borderColor: i === tierIdx ? colors.foreground : "transparent",
                    borderWidth: i === tierIdx ? 2 : 0,
                  },
                ]} />
                <Text style={[styles.ladderLabel, {
                  color: i <= tierIdx ? colors.foreground : colors.mutedForeground,
                  fontWeight: i === tierIdx ? "700" : "500",
                }]} numberOfLines={1}>{TIER_LABELS[t].split(" ")[0]}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Next tier requirements */}
        {data.next ? (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.cardHeader}>
              <Feather name="trending-up" size={18} color={colors.primary} />
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>
                Next: {data.nextTierLabel}
              </Text>
            </View>
            <Text style={[styles.cardSubtitle, { color: colors.mutedForeground }]}>{data.next.summary}</Text>
            {data.next.blockers === null ? (
              <View style={[styles.banner, { backgroundColor: data.next.autoApply ? "#10b98122" : "#f59e0b22", borderColor: data.next.autoApply ? "#10b981" : "#f59e0b" }]}>
                <Feather name={data.next.autoApply ? "check-circle" : "clock"} size={16} color={data.next.autoApply ? "#10b981" : "#f59e0b"} />
                <Text style={[styles.bannerText, { color: colors.foreground }]}>
                  {data.next.autoApply
                    ? "Eligible — promotion will trigger automatically on next evaluation."
                    : "Eligible — pending admin verification for master promotion."}
                </Text>
              </View>
            ) : (
              <View style={styles.blockersList}>
                {data.next.blockers.map((b, i) => (
                  <View key={i} style={styles.blockerRow}>
                    <Feather name="circle" size={10} color={colors.mutedForeground} style={{ marginTop: 5 }} />
                    <Text style={[styles.blockerText, { color: colors.foreground }]}>{b}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        ) : (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="award" size={28} color={tierColor} />
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Top tier reached</Text>
            <Text style={[styles.cardSubtitle, { color: colors.mutedForeground }]}>
              You're at the highest mechanic tier on the platform.
            </Text>
          </View>
        )}

        {/* Performance metrics */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.cardHeader}>
            <Feather name="bar-chart-2" size={18} color={colors.primary} />
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Performance</Text>
          </View>
          <View style={styles.metricsGrid}>
            <Metric label="Paid jobs" value={String(data.metrics.completedJobs)} colors={colors} />
            <Metric label="Avg rating" value={data.metrics.averageRating != null ? data.metrics.averageRating.toFixed(2) : "—"} colors={colors} />
            <Metric label="Reviews" value={String(data.metrics.ratingCount)} colors={colors} />
            <Metric label="Active flags" value={String(data.metrics.unresolvedFlags)} colors={colors} danger={data.metrics.unresolvedFlags > 0} />
            <Metric label="Verified certs" value={String(data.metrics.verifiedCertifications)} colors={colors} />
            <Metric label="Advanced certs" value={String(data.metrics.verifiedAdvancedCertifications)} colors={colors} />
          </View>
        </View>

        {/* Certifications */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.cardHeader}>
            <Feather name="file-text" size={18} color={colors.primary} />
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Certifications</Text>
            <View style={{ flex: 1 }} />
            <Pressable onPress={() => setShowAdd(true)} style={[styles.addBtn, { backgroundColor: colors.primary }]}>
              <Feather name="plus" size={14} color="white" />
              <Text style={styles.addBtnText}>Upload</Text>
            </Pressable>
          </View>
          {certs.length === 0 ? (
            <Text style={[styles.cardSubtitle, { color: colors.mutedForeground }]}>
              Upload your first certification to begin progression past Detailer.
            </Text>
          ) : certs.map((c) => (
            <View key={c.id} style={[styles.certRow, { borderColor: colors.border }]}>
              <View style={[styles.certStatusDot, { backgroundColor: c.status === "verified" ? "#10b981" : c.status === "rejected" ? "#ef4444" : "#f59e0b" }]} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.certTitle, { color: colors.foreground }]}>{c.certificationType}</Text>
                <Text style={[styles.certMeta, { color: colors.mutedForeground }]}>
                  {c.issuingInstitution} · {new Date(c.issueDate).toLocaleDateString()} · {c.skillLevel === "advanced" ? "Advanced" : "Basic"}
                </Text>
                <View style={styles.certActions}>
                  <Text style={[styles.certStatus, { color: c.status === "verified" ? "#10b981" : c.status === "rejected" ? "#ef4444" : "#f59e0b" }]}>
                    {c.status.toUpperCase()}
                  </Text>
                  <Pressable onPress={() => Linking.openURL(c.documentUrl).catch(() => {})}>
                    <Text style={[styles.linkText, { color: colors.primary }]}>View document</Text>
                  </Pressable>
                  {c.status === "pending" && (
                    <Pressable onPress={() => handleDeleteCert(c.id)}>
                      <Text style={[styles.linkText, { color: colors.destructive }]}>Remove</Text>
                    </Pressable>
                  )}
                </View>
                {c.reviewNote ? (
                  <Text style={[styles.reviewNote, { color: colors.mutedForeground }]}>“{c.reviewNote}”</Text>
                ) : null}
              </View>
            </View>
          ))}
        </View>

        {/* Promotion history */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.cardHeader}>
            <Feather name="clock" size={18} color={colors.primary} />
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Promotion history</Text>
          </View>
          {history.length === 0 ? (
            <Text style={[styles.cardSubtitle, { color: colors.mutedForeground }]}>No promotions yet.</Text>
          ) : history.map((h) => (
            <View key={h.id} style={[styles.historyRow, { borderColor: colors.border }]}>
              <Feather name="arrow-up-right" size={16} color="#10b981" />
              <View style={{ flex: 1 }}>
                <Text style={[styles.historyTitle, { color: colors.foreground }]}>
                  {TIER_LABELS[h.previousTier]} → {TIER_LABELS[h.newTier]}
                </Text>
                <Text style={[styles.historyMeta, { color: colors.mutedForeground }]}>
                  {h.reason}
                </Text>
                <Text style={[styles.historyMeta, { color: colors.mutedForeground }]}>
                  {new Date(h.createdAt).toLocaleString()} · {h.trigger.replace("_", " ")}
                </Text>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>

      {showAdd && (
        <CertUploadModal
          onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); void fetchAll(); }}
        />
      )}
    </View>
  );
}

function Metric({ label, value, colors, danger }: { label: string; value: string; colors: ReturnType<typeof useColors>; danger?: boolean }) {
  return (
    <View style={[styles.metric, { backgroundColor: colors.background, borderColor: colors.border }]}>
      <Text style={[styles.metricValue, { color: danger ? colors.destructive : colors.foreground }]}>{value}</Text>
      <Text style={[styles.metricLabel, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  );
}

function CertUploadModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const colors = useColors();
  const [certificationType, setType] = useState("");
  const [issuingInstitution, setInstitution] = useState("");
  const [issueDate, setIssueDate] = useState("");
  const [expirationDate, setExpiration] = useState("");
  const [documentUrl, setDocUrl] = useState("");
  const [documentKind, setDocKind] = useState<"pdf" | "image" | "other">("pdf");
  const [skillLevel, setSkill] = useState<"basic" | "advanced">("basic");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!certificationType.trim() || !issuingInstitution.trim() || !issueDate.trim() || !documentUrl.trim()) {
      alertMessage("Missing fields", "Type, institution, issue date, and document URL are required.");
      return;
    }
    setSaving(true);
    try {
      await customFetch("/api/mechanic/me/certifications", {
        method: "POST",
        body: JSON.stringify({
          certificationType: certificationType.trim(),
          issuingInstitution: issuingInstitution.trim(),
          issueDate,
          expirationDate: expirationDate.trim() || null,
          documentUrl: documentUrl.trim(),
          documentKind,
          skillLevel,
        }),
      });
      onSaved();
    } catch (e) {
      alertMessage("Upload failed", e instanceof Error ? e.message : "Unknown");
    } finally { setSaving(false); }
  };

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Upload certification</Text>
            <Pressable onPress={onClose}><Feather name="x" size={22} color={colors.foreground} /></Pressable>
          </View>
          <ScrollView style={{ maxHeight: 480 }}>
            <Field label="Certification type (e.g. ASE A1 Engine Repair)" value={certificationType} onChange={setType} colors={colors} />
            <Field label="Issuing institution (e.g. ASE, Toyota)" value={issuingInstitution} onChange={setInstitution} colors={colors} />
            <Field label="Issue date (YYYY-MM-DD)" value={issueDate} onChange={setIssueDate} colors={colors} placeholder="2024-01-15" />
            <Field label="Expiration date (optional)" value={expirationDate} onChange={setExpiration} colors={colors} placeholder="2029-01-15" />
            <Field label="Document URL (PDF or image link)" value={documentUrl} onChange={setDocUrl} colors={colors} placeholder="https://..." />
            <Text style={[styles.label, { color: colors.foreground }]}>Document type</Text>
            <View style={styles.chipRow}>
              {(["pdf", "image", "other"] as const).map((k) => (
                <Pressable key={k} onPress={() => setDocKind(k)}
                  style={[styles.chip, { borderColor: documentKind === k ? colors.primary : colors.border, backgroundColor: documentKind === k ? colors.primary + "22" : "transparent" }]}>
                  <Text style={{ color: colors.foreground, fontSize: 13 }}>{k.toUpperCase()}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={[styles.label, { color: colors.foreground }]}>Skill level</Text>
            <Text style={[styles.help, { color: colors.mutedForeground }]}>
              Advanced certs (ASE A1–A8, master tech, OEM advanced) count toward the Master tier requirement.
            </Text>
            <View style={styles.chipRow}>
              {(["basic", "advanced"] as const).map((s) => (
                <Pressable key={s} onPress={() => setSkill(s)}
                  style={[styles.chip, { borderColor: skillLevel === s ? colors.primary : colors.border, backgroundColor: skillLevel === s ? colors.primary + "22" : "transparent" }]}>
                  <Text style={{ color: colors.foreground, fontSize: 13 }}>{s === "basic" ? "Basic / foundational" : "Advanced / master class"}</Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>
          <Pressable onPress={handleSave} disabled={saving}
            style={[styles.saveBtn, { backgroundColor: colors.primary, opacity: saving ? 0.6 : 1 }]}>
            <Text style={styles.saveBtnText}>{saving ? "Saving…" : "Submit for review"}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function Field({ label, value, onChange, colors, placeholder }: {
  label: string; value: string; onChange: (s: string) => void;
  colors: ReturnType<typeof useColors>; placeholder?: string;
}) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={[styles.label, { color: colors.foreground }]}>{label}</Text>
      <TextInput
        value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={colors.mutedForeground}
        style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
        autoCapitalize="none"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  tierCard: { borderWidth: 1, borderRadius: 16, padding: 16, marginBottom: 16 },
  tierHeader: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 14 },
  tierBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  tierBadgeText: { color: "white", fontWeight: "800", fontSize: 11, letterSpacing: 0.5 },
  tierName: { fontSize: 20, fontWeight: "700" },
  ladder: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 4 },
  ladderStep: { alignItems: "center", flex: 1 },
  ladderDot: { width: 18, height: 18, borderRadius: 9, marginBottom: 6 },
  ladderLabel: { fontSize: 10, textAlign: "center" },
  card: { borderWidth: 1, borderRadius: 14, padding: 16, marginBottom: 16, gap: 8 },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardTitle: { fontSize: 16, fontWeight: "700" },
  cardSubtitle: { fontSize: 13, lineHeight: 18 },
  banner: { flexDirection: "row", gap: 8, padding: 10, borderRadius: 8, borderWidth: 1, alignItems: "flex-start", marginTop: 8 },
  bannerText: { flex: 1, fontSize: 13, fontWeight: "500" },
  blockersList: { marginTop: 6, gap: 6 },
  blockerRow: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  blockerText: { flex: 1, fontSize: 13, lineHeight: 18 },
  metricsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  metric: { flexBasis: "30%", flexGrow: 1, padding: 12, borderRadius: 10, borderWidth: 1, alignItems: "center" },
  metricValue: { fontSize: 20, fontWeight: "700" },
  metricLabel: { fontSize: 11, marginTop: 2 },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  addBtnText: { color: "white", fontWeight: "600", fontSize: 12 },
  certRow: { flexDirection: "row", gap: 10, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, marginTop: 6 },
  certStatusDot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  certTitle: { fontSize: 14, fontWeight: "600" },
  certMeta: { fontSize: 12, marginTop: 2 },
  certActions: { flexDirection: "row", gap: 12, marginTop: 6, alignItems: "center", flexWrap: "wrap" },
  certStatus: { fontSize: 11, fontWeight: "700", letterSpacing: 0.5 },
  linkText: { fontSize: 12, fontWeight: "500" },
  reviewNote: { fontSize: 12, fontStyle: "italic", marginTop: 4 },
  historyRow: { flexDirection: "row", gap: 10, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, marginTop: 6 },
  historyTitle: { fontSize: 14, fontWeight: "600" },
  historyMeta: { fontSize: 12, marginTop: 2 },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalCard: { padding: 16, borderTopLeftRadius: 16, borderTopRightRadius: 16, borderTopWidth: 1, gap: 8 },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  modalTitle: { fontSize: 18, fontWeight: "700" },
  label: { fontSize: 12, fontWeight: "600", marginBottom: 6, marginTop: 6 },
  help: { fontSize: 11, marginBottom: 6 },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: Platform.OS === "ios" ? 10 : 8, fontSize: 14 },
  chipRow: { flexDirection: "row", gap: 8, flexWrap: "wrap", marginBottom: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1 },
  saveBtn: { padding: 14, borderRadius: 10, alignItems: "center", marginTop: 12 },
  saveBtnText: { color: "white", fontWeight: "700", fontSize: 15 },
});
