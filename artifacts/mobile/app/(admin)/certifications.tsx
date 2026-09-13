import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator,
  TextInput, Linking, Modal,
} from "react-native";
import { useEffect, useState, useCallback } from "react";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { customFetch } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { alertMessage } from "@/utils/confirm";

interface Cert {
  id: number; mechanicId: number; mechanicName: string | null; mechanicEmail: string | null;
  mechanicTier: string | null;
  certificationType: string; issuingInstitution: string;
  issueDate: string; expirationDate: string | null;
  documentUrl: string; documentKind: "pdf" | "image" | "other";
  skillLevel: "basic" | "advanced";
  status: "pending" | "verified" | "rejected";
  reviewNote: string | null; createdAt: string;
}

interface MasterCandidate {
  mechanicId: number; mechanicName: string; mechanicEmail: string;
  currentTier: string;
  metrics: {
    completedJobs: number; averageRating: number | null; ratingCount: number;
    unresolvedFlags: number; verifiedAdvancedCertifications: number;
  };
  next: { blockers: string[] | null } | null;
  flaggedForAdminReview: boolean;
}

type Tab = "queue" | "promotions";

export default function AdminCertificationsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>("queue");
  const [certs, setCerts] = useState<Cert[]>([]);
  const [candidates, setCandidates] = useState<MasterCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewing, setReviewing] = useState<Cert | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [c, p] = await Promise.all([
        customFetch<Cert[]>("/api/admin/certifications?status=pending"),
        customFetch<MasterCandidate[]>("/api/admin/promotions/pending"),
      ]);
      setCerts(c); setCandidates(p);
    } catch (e) {
      alertMessage("Could not load", e instanceof Error ? e.message : "Failed");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void fetchAll(); }, [fetchAll]);

  const promote = async (mechanicId: number) => {
    try {
      await customFetch(`/api/admin/mechanics/${mechanicId}/promote`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      alertMessage("Promoted", "Mechanic promoted to Master tier.");
      await fetchAll();
    } catch (e) {
      alertMessage("Promotion failed", e instanceof Error ? e.message : "Unknown");
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.tabs, { borderColor: colors.border }]}>
        <Pressable onPress={() => setTab("queue")}
          style={[styles.tab, { borderBottomColor: tab === "queue" ? colors.primary : "transparent" }]}>
          <Text style={[styles.tabText, { color: tab === "queue" ? colors.primary : colors.mutedForeground }]}>
            Cert queue ({certs.length})
          </Text>
        </Pressable>
        <Pressable onPress={() => setTab("promotions")}
          style={[styles.tab, { borderBottomColor: tab === "promotions" ? colors.primary : "transparent" }]}>
          <Text style={[styles.tabText, { color: tab === "promotions" ? colors.primary : colors.mutedForeground }]}>
            Master review ({candidates.filter((c) => c.flaggedForAdminReview).length})
          </Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 120 }}>
          {tab === "queue" && (
            certs.length === 0 ? (
              <Empty colors={colors} text="No pending certifications." />
            ) : certs.map((c) => (
              <View key={c.id} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.cardTitle, { color: colors.foreground }]}>{c.certificationType}</Text>
                <Text style={[styles.cardMeta, { color: colors.mutedForeground }]}>
                  {c.mechanicName ?? "Mechanic"} (#{c.mechanicId}) · current tier: {c.mechanicTier ?? "—"}
                </Text>
                <Text style={[styles.cardMeta, { color: colors.mutedForeground }]}>
                  {c.issuingInstitution} · issued {new Date(c.issueDate).toLocaleDateString()}
                  {c.expirationDate ? ` · expires ${new Date(c.expirationDate).toLocaleDateString()}` : ""}
                </Text>
                <Text style={[styles.cardMeta, { color: colors.mutedForeground }]}>
                  Skill level: <Text style={{ fontWeight: "700", color: c.skillLevel === "advanced" ? "#FB923C" : colors.foreground }}>{c.skillLevel}</Text>
                </Text>
                <View style={styles.actionRow}>
                  <Pressable onPress={() => Linking.openURL(c.documentUrl).catch(() => {})}
                    style={[styles.btn, { backgroundColor: colors.secondary }]}>
                    <Feather name="external-link" size={14} color={colors.foreground} />
                    <Text style={[styles.btnText, { color: colors.foreground }]}>Open document</Text>
                  </Pressable>
                  <Pressable onPress={() => setReviewing(c)}
                    style={[styles.btn, { backgroundColor: colors.primary }]}>
                    <Feather name="check-square" size={14} color="white" />
                    <Text style={[styles.btnText, { color: "white" }]}>Review</Text>
                  </Pressable>
                </View>
              </View>
            ))
          )}

          {tab === "promotions" && (
            candidates.length === 0 ? (
              <Empty colors={colors} text="No advanced-tier mechanics tracked yet." />
            ) : candidates.map((c) => (
              <View key={c.mechanicId} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.cardHeader}>
                  <Text style={[styles.cardTitle, { color: colors.foreground }]}>{c.mechanicName}</Text>
                  {c.flaggedForAdminReview && (
                    <View style={[styles.pill, { backgroundColor: "#10b98122", borderColor: "#10b981" }]}>
                      <Text style={{ color: "#10b981", fontWeight: "700", fontSize: 11 }}>READY</Text>
                    </View>
                  )}
                </View>
                <Text style={[styles.cardMeta, { color: colors.mutedForeground }]}>{c.mechanicEmail}</Text>
                <Text style={[styles.cardMeta, { color: colors.mutedForeground }]}>
                  {c.metrics.completedJobs} paid jobs · {c.metrics.averageRating?.toFixed(2) ?? "—"} avg ({c.metrics.ratingCount} reviews) · {c.metrics.unresolvedFlags} flags · {c.metrics.verifiedAdvancedCertifications} adv certs
                </Text>
                {c.next?.blockers && c.next.blockers.length > 0 && (
                  <View style={{ marginTop: 6 }}>
                    {c.next.blockers.map((b, i) => (
                      <Text key={i} style={[styles.blocker, { color: colors.mutedForeground }]}>• {b}</Text>
                    ))}
                  </View>
                )}
                {c.flaggedForAdminReview && (
                  <Pressable onPress={() => promote(c.mechanicId)}
                    style={[styles.btn, { backgroundColor: colors.primary, marginTop: 10 }]}>
                    <Feather name="award" size={14} color="white" />
                    <Text style={[styles.btnText, { color: "white" }]}>Promote to Master</Text>
                  </Pressable>
                )}
              </View>
            ))
          )}
        </ScrollView>
      )}

      {reviewing && (
        <ReviewModal cert={reviewing} onClose={() => setReviewing(null)} onDone={() => { setReviewing(null); void fetchAll(); }} />
      )}
    </View>
  );
}

function Empty({ colors, text }: { colors: ReturnType<typeof useColors>; text: string }) {
  return (
    <View style={styles.empty}>
      <Feather name="inbox" size={36} color={colors.mutedForeground} />
      <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>{text}</Text>
    </View>
  );
}

function ReviewModal({ cert, onClose, onDone }: { cert: Cert; onClose: () => void; onDone: () => void }) {
  const colors = useColors();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (status: "verified" | "rejected") => {
    setBusy(true);
    try {
      await customFetch(`/api/admin/certifications/${cert.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status, reviewNote: note.trim() || null }),
      });
      onDone();
    } catch (e) {
      alertMessage("Review failed", e instanceof Error ? e.message : "Unknown");
    } finally { setBusy(false); }
  };

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.cardHeader}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Review certification</Text>
            <Pressable onPress={onClose}><Feather name="x" size={22} color={colors.foreground} /></Pressable>
          </View>
          <Text style={[styles.cardMeta, { color: colors.mutedForeground }]}>
            {cert.certificationType} · {cert.issuingInstitution}
          </Text>
          <Text style={[styles.label, { color: colors.foreground }]}>Review note (optional)</Text>
          <TextInput value={note} onChangeText={setNote} multiline
            style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background, minHeight: 80 }]}
            placeholder="Visible to the mechanic" placeholderTextColor={colors.mutedForeground} />
          <View style={[styles.actionRow, { marginTop: 12 }]}>
            <Pressable disabled={busy} onPress={() => submit("rejected")}
              style={[styles.btn, { backgroundColor: colors.destructive, opacity: busy ? 0.6 : 1 }]}>
              <Text style={[styles.btnText, { color: "white" }]}>Reject</Text>
            </Pressable>
            <Pressable disabled={busy} onPress={() => submit("verified")}
              style={[styles.btn, { backgroundColor: "#10b981", opacity: busy ? 0.6 : 1 }]}>
              <Text style={[styles.btnText, { color: "white" }]}>Verify</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  tabs: { flexDirection: "row", borderBottomWidth: 1 },
  tab: { flex: 1, paddingVertical: 14, alignItems: "center", borderBottomWidth: 2 },
  tabText: { fontSize: 13, fontWeight: "600" },
  card: { borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 12, gap: 4 },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardTitle: { fontSize: 15, fontWeight: "700" },
  cardMeta: { fontSize: 12, lineHeight: 18 },
  blocker: { fontSize: 11, lineHeight: 16 },
  actionRow: { flexDirection: "row", gap: 8, marginTop: 10, flexWrap: "wrap" },
  btn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  btnText: { fontSize: 13, fontWeight: "600" },
  pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1 },
  empty: { alignItems: "center", padding: 40, gap: 12 },
  emptyText: { fontSize: 14 },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: { padding: 16, borderTopLeftRadius: 16, borderTopRightRadius: 16, borderTopWidth: 1, gap: 8 },
  label: { fontSize: 12, fontWeight: "600", marginTop: 8, marginBottom: 6 },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14 },
});
