/**
 * Mechanic Vehicle Intelligence Workspace.
 *
 * The dealership-grade operating screen for a single VIN. Loads
 * /api/mechanic/workspace/by-vin/:vin which lazily creates the persistent
 * profile + decoded-VIN cache the first time the VIN is opened.
 *
 * One screen, eight sections (chip-tabs at top):
 *   Overview · Service History · Installed Parts · Compatibility ·
 *   Recommendations · Notes · Specs · Diagram
 *
 * All data is mechanic-only — the underlying endpoints reject customer
 * accounts with 403, so even if a customer somehow opened this URL they'd
 * get nothing back.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable,
  RefreshControl, TextInput, Modal, KeyboardAvoidingView, Platform,
} from "react-native";
import { Stack, useLocalSearchParams, Redirect } from "expo-router";
import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useColors } from "@/hooks/useColors";
import { alertMessage, confirm } from "@/utils/confirm";
import { useAuth } from "@/context/AuthContext";
import { VehicleDiagram, type DiagramComponent } from "@/components/VehicleDiagram";
import { getApiOrigin, getApiUrl } from "@/lib/apiConfig";

interface Vehicle {
  id: number; vin: string; make: string; model: string; year: number;
  trim: string | null; color: string | null; mileage: number;
}
interface Profile {
  decoded: Record<string, string | null>;
  decodedAt: string | null;
  engine: string | null; transmission: string | null; drivetrain: string | null;
  fuelType: string | null; bodyClass: string | null; imageUrl: string | null;
}
interface ServiceLog {
  id: number; serviceCategory: string; serviceDescription: string;
  mileageAtService: number; createdAt: string; mechanicId: number;
  partsUsed: string[]; notes: string | null;
  rootCauseDiagnosis: string | null; recurringIssueTags: string[];
}
interface InstalledPart {
  id: number; category: string; partNumber: string | null; brand: string | null;
  supplier: string | null; installMileage: number | null; installedAt: string;
  removedAt: string | null; notes: string | null; mechanicId: number;
  confidenceAtInstall: string | null;
  overrideRecommendation: { reason: string; recommendedPartNumber?: string; recommendedBrand?: string } | null;
}
interface Note {
  id: number; type: "observation" | "warning" | "diagnostic";
  severity: "info" | "low" | "medium" | "high";
  title: string; body: string | null;
  resolvedAt: string | null; createdAt: string; mechanicId: number;
}
interface Reco {
  id: number; title: string; description: string | null;
  urgency: "low" | "medium" | "high" | "critical";
  status: "open" | "addressed" | "dismissed";
  estimatedCost: number | null; createdAt: string;
}
interface Bundle {
  vehicle: Vehicle; profile: Profile;
  serviceHistory: ServiceLog[]; installedParts: InstalledPart[];
  notes: Note[]; recommendations: Reco[];
  counts: { services: number; installedParts: number; openNotes: number; openRecommendations: number };
}
interface Category { key: string; label: string; baseConfidence: "high" | "medium" | "verify" }
interface Compat {
  category: string; label: string; confidence: "high" | "medium" | "verify";
  rationale: string; verifySteps: string[];
  suggestedPartNumber?: string; suggestedBrand?: string; suggestedSupplier?: string;
  lastInstall?: { partNumber: string | null; brand: string | null; installedAt: string; installMileage: number | null };
  lastOverride?: { reason: string; recommendedPartNumber?: string; overriddenAt: string };
}

type Tab = "overview" | "history" | "parts" | "compatibility" | "recommendations" | "notes" | "specs" | "diagram";

const TABS: { key: Tab; label: string; icon: keyof typeof Feather.glyphMap }[] = [
  { key: "overview",        label: "Overview",        icon: "grid" },
  { key: "history",         label: "Service",         icon: "clock" },
  { key: "parts",           label: "Installed",       icon: "package" },
  { key: "compatibility",   label: "Compatibility",   icon: "shield" },
  { key: "recommendations", label: "Recommend",       icon: "alert-triangle" },
  { key: "notes",           label: "Notes",           icon: "edit-3" },
  { key: "specs",           label: "Specs",           icon: "list" },
  { key: "diagram",         label: "Diagram",         icon: "truck" },
];

const URGENCY_COLORS: Record<string, string> = {
  low: "#94A3B8", medium: "#F59E0B", high: "#EF4444", critical: "#B91C1C",
};
const SEVERITY_COLORS: Record<string, string> = {
  info: "#0EA5E9", low: "#94A3B8", medium: "#F59E0B", high: "#EF4444",
};
const CONFIDENCE_COLORS: Record<string, string> = {
  high: "#10B981", medium: "#F59E0B", verify: "#EF4444",
};

export default function MechanicWorkspaceScreen() {
  const colors = useColors();
  const { vin: vinParam } = useLocalSearchParams<{ vin: string }>();
  const vin = (vinParam ?? "").toUpperCase();
  const domain = getApiOrigin() ?? "";
  const { user } = useAuth();

  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");

  const authHeaders = useCallback(async () => {
    const token = await AsyncStorage.getItem("auth_token");
    return {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    } as Record<string, string>;
  }, []);

  const load = useCallback(async () => {
    setError(null);
    const headers = await authHeaders();
    const res = await fetch(getApiUrl(`/mechanic/workspace/by-vin/${vin}`), { headers });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error ?? `Failed to load workspace (${res.status})`);
      return;
    }
    setBundle(await res.json());
  }, [domain, vin, authHeaders]);

  useEffect(() => { load().finally(() => setLoading(false)); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true); await load(); setRefreshing(false);
  }, [load]);

  // Defense-in-depth: even though the server returns 403 for non-mechanics on
  // every /mechanic/* endpoint, we redirect customers off this screen before
  // any fetch runs so they never see the loading spinner or even the title.
  if (user && user.role !== "mechanic" && user.role !== "admin") {
    return <Redirect href="/(customer)" />;
  }

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (error || !bundle) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ title: vin }} />
        <Feather name="alert-circle" size={28} color={colors.destructive} />
        <Text style={{ color: colors.destructive, marginTop: 8, textAlign: "center", paddingHorizontal: 24 }}>
          {error ?? "Workspace not found"}
        </Text>
      </View>
    );
  }

  const { vehicle, profile, counts } = bundle;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{
        title: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
        headerShown: true,
      }} />

      {/* Vehicle header */}
      <View style={[styles.header, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <View style={styles.headerRow}>
          <View style={[styles.headerIcon, { backgroundColor: colors.primary + "20" }]}>
            <Feather name="truck" size={22} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.headerTitle, { color: colors.foreground }]}>
              {vehicle.year} {vehicle.make} {vehicle.model}
            </Text>
            {vehicle.trim ? (
              <Text style={[styles.headerTrim, { color: colors.mutedForeground }]}>{vehicle.trim}</Text>
            ) : null}
          </View>
        </View>
        <View style={styles.vinPill}>
          <Text style={[styles.vinPillLabel, { color: colors.mutedForeground }]}>VIN</Text>
          <Text style={[styles.vinPillVal, { color: colors.foreground }]}>{vin}</Text>
        </View>
        <View style={styles.headerStats}>
          <Stat icon="hash" label="Mileage" value={vehicle.mileage > 0 ? `${vehicle.mileage.toLocaleString()} mi` : "—"} />
          <Stat icon="clock" label="Services" value={String(counts.services)} />
          <Stat icon="package" label="Parts" value={String(counts.installedParts)} />
          <Stat icon="alert-triangle" label="Open recos" value={String(counts.openRecommendations)} />
        </View>
      </View>

      {/* Section chips */}
      <ScrollView
        horizontal showsHorizontalScrollIndicator={false}
        style={[styles.tabs, { borderBottomColor: colors.border }]}
        contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 10, gap: 6 }}
      >
        {TABS.map((t) => (
          <Pressable
            key={t.key}
            onPress={() => setTab(t.key)}
            style={[styles.chip, {
              backgroundColor: tab === t.key ? colors.primary : colors.card,
              borderColor: tab === t.key ? colors.primary : colors.border,
            }]}
          >
            <Feather name={t.icon} size={13} color={tab === t.key ? "white" : colors.foreground} />
            <Text style={[styles.chipText, { color: tab === t.key ? "white" : colors.foreground }]}>{t.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 140 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {tab === "overview" &&        <OverviewTab bundle={bundle} setTab={setTab} />}
        {tab === "history" &&         <HistoryTab logs={bundle.serviceHistory} />}
        {tab === "parts" &&           <PartsTab bundle={bundle} domain={domain!} authHeaders={authHeaders} reload={load} />}
        {tab === "compatibility" &&   <CompatibilityTab vehicleId={vehicle.id} domain={domain!} authHeaders={authHeaders} />}
        {tab === "recommendations" && <RecosTab bundle={bundle} domain={domain!} authHeaders={authHeaders} reload={load} />}
        {tab === "notes" &&           <NotesTab bundle={bundle} domain={domain!} authHeaders={authHeaders} reload={load} />}
        {tab === "specs" &&           <SpecsTab profile={profile} />}
        {tab === "diagram" &&         <DiagramTab vehicleId={vehicle.id} domain={domain!} authHeaders={authHeaders} />}
      </ScrollView>
    </View>
  );
}

function Stat({ icon, label, value }: { icon: keyof typeof Feather.glyphMap; label: string; value: string }) {
  const colors = useColors();
  return (
    <View style={styles.statCell}>
      <Feather name={icon} size={12} color={colors.mutedForeground} />
      <Text style={[styles.statValue, { color: colors.foreground }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  );
}

// ────────────────────────────── Overview ──────────────────────────────
function OverviewTab({ bundle, setTab }: { bundle: Bundle; setTab: (t: Tab) => void }) {
  const colors = useColors();
  const openRecos = bundle.recommendations.filter((r) => r.status === "open");
  const recentParts = bundle.installedParts.slice(0, 3);
  const recentNotes = bundle.notes.filter((n) => !n.resolvedAt).slice(0, 3);
  const lastService = bundle.serviceHistory[0];

  return (
    <View style={{ gap: 14 }}>
      {openRecos.length > 0 ? (
        <View style={[styles.alertCard, { backgroundColor: "#FEF2F2", borderColor: "#FECACA" }]}>
          <View style={styles.alertHeader}>
            <Feather name="alert-triangle" size={16} color="#DC2626" />
            <Text style={[styles.alertTitle, { color: "#7F1D1D" }]}>
              {openRecos.length} open recommendation{openRecos.length === 1 ? "" : "s"}
            </Text>
          </View>
          {openRecos.slice(0, 3).map((r) => (
            <View key={r.id} style={styles.alertRow}>
              <View style={[styles.urgencyDot, { backgroundColor: URGENCY_COLORS[r.urgency] }]} />
              <Text style={[styles.alertItem, { color: "#7F1D1D" }]} numberOfLines={1}>{r.title}</Text>
            </View>
          ))}
          <Pressable onPress={() => setTab("recommendations")} style={styles.alertLink}>
            <Text style={[styles.alertLinkText, { color: "#7F1D1D" }]}>View all →</Text>
          </Pressable>
        </View>
      ) : null}

      <SectionTitle text="Last service" />
      {lastService ? (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>{lastService.serviceDescription}</Text>
          <Text style={[styles.cardMeta, { color: colors.mutedForeground }]}>
            {new Date(lastService.createdAt).toLocaleDateString()} · {lastService.mileageAtService.toLocaleString()} mi
          </Text>
          {lastService.recurringIssueTags.length > 0 ? (
            <View style={styles.tagRow}>
              {lastService.recurringIssueTags.map((t) => (
                <View key={t} style={[styles.tag, { backgroundColor: colors.secondary }]}>
                  <Text style={[styles.tagText, { color: colors.foreground }]}>{t}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ) : (
        <Empty text="No service history yet." />
      )}

      <SectionTitle text="Recently installed" />
      {recentParts.length > 0 ? recentParts.map((p) => (
        <PartRow key={p.id} part={p} />
      )) : <Empty text="No installed parts logged yet." />}

      <SectionTitle text="Active notes" />
      {recentNotes.length > 0 ? recentNotes.map((n) => (
        <NoteRow key={n.id} note={n} />
      )) : <Empty text="No mechanic notes yet." />}
    </View>
  );
}

function SectionTitle({ text }: { text: string }) {
  const colors = useColors();
  return <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>{text.toUpperCase()}</Text>;
}
function Empty({ text }: { text: string }) {
  const colors = useColors();
  return (
    <View style={[styles.emptyBox, { borderColor: colors.border }]}>
      <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>{text}</Text>
    </View>
  );
}

function PartRow({ part }: { part: InstalledPart }) {
  const colors = useColors();
  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.partHeader}>
        <Text style={[styles.cardTitle, { color: colors.foreground }]}>{part.category.replace(/_/g, " ")}</Text>
        {part.confidenceAtInstall ? (
          <View style={[styles.confPill, { backgroundColor: CONFIDENCE_COLORS[part.confidenceAtInstall] + "20" }]}>
            <Text style={[styles.confPillText, { color: CONFIDENCE_COLORS[part.confidenceAtInstall] }]}>
              {part.confidenceAtInstall}
            </Text>
          </View>
        ) : null}
      </View>
      <Text style={[styles.cardMeta, { color: colors.mutedForeground }]}>
        {[part.brand, part.partNumber].filter(Boolean).join(" · ") || "No part number"}
      </Text>
      <Text style={[styles.cardMeta, { color: colors.mutedForeground, marginTop: 2 }]}>
        {new Date(part.installedAt).toLocaleDateString()}{part.installMileage ? ` · ${part.installMileage.toLocaleString()} mi` : ""}
      </Text>
      {part.overrideRecommendation ? (
        <View style={[styles.overrideBox, { borderColor: "#F59E0B" }]}>
          <Feather name="info" size={12} color="#92400E" />
          <Text style={[styles.overrideText, { color: "#92400E" }]}>
            Override: {part.overrideRecommendation.reason}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function NoteRow({ note }: { note: Note }) {
  const colors = useColors();
  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.partHeader}>
        <View style={styles.noteHeaderLeft}>
          <View style={[styles.severityDot, { backgroundColor: SEVERITY_COLORS[note.severity] }]} />
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>{note.title}</Text>
        </View>
        <Text style={[styles.noteType, { color: colors.mutedForeground }]}>{note.type}</Text>
      </View>
      {note.body ? <Text style={[styles.cardMeta, { color: colors.mutedForeground, marginTop: 4 }]}>{note.body}</Text> : null}
    </View>
  );
}

// ────────────────────────────── Service history ──────────────────────────────
function HistoryTab({ logs }: { logs: ServiceLog[] }) {
  const colors = useColors();
  if (logs.length === 0) return <Empty text="No completed services on this VIN yet." />;
  return (
    <View style={{ gap: 10 }}>
      {logs.map((l, i) => (
        <View key={l.id} style={styles.timelineRow}>
          <View style={styles.timelineGutter}>
            <View style={[styles.timelineDot, { backgroundColor: colors.primary }]} />
            {i < logs.length - 1 ? <View style={[styles.timelineLine, { backgroundColor: colors.border }]} /> : null}
          </View>
          <View style={[styles.card, { flex: 1, backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>{l.serviceDescription}</Text>
            <Text style={[styles.cardMeta, { color: colors.mutedForeground }]}>
              {new Date(l.createdAt).toLocaleDateString()} · {l.mileageAtService.toLocaleString()} mi · {l.serviceCategory}
            </Text>
            {l.partsUsed.length > 0 ? (
              <Text style={[styles.cardMeta, { color: colors.mutedForeground, marginTop: 4 }]}>
                Parts: {l.partsUsed.join(", ")}
              </Text>
            ) : null}
            {l.rootCauseDiagnosis ? (
              <Text style={[styles.cardBody, { color: colors.foreground }]}>{l.rootCauseDiagnosis}</Text>
            ) : null}
            {l.recurringIssueTags.length > 0 ? (
              <View style={styles.tagRow}>
                {l.recurringIssueTags.map((t) => (
                  <View key={t} style={[styles.tag, { backgroundColor: "#FEF3C7" }]}>
                    <Text style={[styles.tagText, { color: "#92400E" }]}>↻ {t}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        </View>
      ))}
    </View>
  );
}

// ────────────────────────────── Installed parts ──────────────────────────────
function PartsTab({
  bundle, domain, authHeaders, reload,
}: { bundle: Bundle; domain: string; authHeaders: () => Promise<Record<string, string>>; reload: () => Promise<void> }) {
  const colors = useColors();
  const [adding, setAdding] = useState(false);
  return (
    <View style={{ gap: 10 }}>
      <Pressable
        style={[styles.addBtn, { backgroundColor: colors.primary }]}
        onPress={() => setAdding(true)}
      >
        <Feather name="plus" size={14} color="white" />
        <Text style={styles.addBtnText}>Log installed part</Text>
      </Pressable>
      {bundle.installedParts.length === 0
        ? <Empty text="No active installed parts. Log every install so APS can recommend the exact match next time." />
        : bundle.installedParts.map((p) => <PartRow key={p.id} part={p} />)}
      <AddPartModal
        visible={adding}
        onClose={() => setAdding(false)}
        onSaved={async () => { setAdding(false); await reload(); }}
        vehicleId={bundle.vehicle.id}
        mileage={bundle.vehicle.mileage}
        domain={domain}
        authHeaders={authHeaders}
      />
    </View>
  );
}

function AddPartModal({
  visible, onClose, onSaved, vehicleId, mileage, domain, authHeaders,
}: {
  visible: boolean; onClose: () => void; onSaved: () => void;
  vehicleId: number; mileage: number;
  domain: string; authHeaders: () => Promise<Record<string, string>>;
}) {
  const colors = useColors();
  const [category, setCategory] = useState("");
  const [partNumber, setPartNumber] = useState("");
  const [brand, setBrand] = useState("");
  const [supplier, setSupplier] = useState("");
  const [installMileage, setInstallMileage] = useState(String(mileage || ""));
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      setCategory(""); setPartNumber(""); setBrand(""); setSupplier("");
      setInstallMileage(String(mileage || "")); setNotes("");
    }
  }, [visible, mileage]);

  const submit = async () => {
    if (!category.trim()) {
      await alertMessage("Category required", "e.g. brake_pads_front, oil_filter, tires.");
      return;
    }
    setSaving(true);
    try {
      const headers = await authHeaders();
      const res = await fetch(getApiUrl(`/mechanic/vehicles/${vehicleId}/installed-parts`), {
        method: "POST",
        headers,
        body: JSON.stringify({
          category: category.trim().toLowerCase(),
          partNumber: partNumber.trim() || undefined,
          brand: brand.trim() || undefined,
          supplier: supplier.trim() || undefined,
          installMileage: installMileage ? Number(installMileage) : undefined,
          notes: notes.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        await alertMessage("Save failed", d.error ?? "Unknown error");
        return;
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalBackdrop}>
        <View style={[styles.modalSheet, { backgroundColor: colors.background }]}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Log installed part</Text>
            <Pressable onPress={onClose} hitSlop={10}><Feather name="x" size={20} color={colors.foreground} /></Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
            <Field label="Category (e.g. brake_pads_front)" value={category} onChange={setCategory} mono />
            <Field label="Part number" value={partNumber} onChange={setPartNumber} mono />
            <Field label="Brand" value={brand} onChange={setBrand} />
            <Field label="Supplier" value={supplier} onChange={setSupplier} />
            <Field label="Install mileage" value={installMileage} onChange={setInstallMileage} keyboardType="numeric" />
            <Field label="Notes" value={notes} onChange={setNotes} multiline />
            <Pressable
              disabled={saving}
              onPress={submit}
              style={[styles.primaryBtn, { backgroundColor: colors.primary, opacity: saving ? 0.5 : 1 }]}
            >
              {saving ? <ActivityIndicator color="white" /> : <Text style={styles.primaryBtnText}>Save</Text>}
            </Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Field({ label, value, onChange, multiline, keyboardType, mono }: {
  label: string; value: string; onChange: (s: string) => void;
  multiline?: boolean; keyboardType?: "default" | "numeric"; mono?: boolean;
}) {
  const colors = useColors();
  return (
    <View>
      <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <TextInput
        value={value} onChangeText={onChange}
        multiline={multiline} keyboardType={keyboardType ?? "default"}
        autoCapitalize={mono ? "none" : "sentences"}
        autoCorrect={!mono}
        placeholderTextColor={colors.mutedForeground}
        style={[styles.fieldInput, {
          backgroundColor: colors.card, color: colors.foreground, borderColor: colors.border,
          minHeight: multiline ? 60 : 40,
          fontFamily: mono ? "monospace" : undefined,
        }]}
      />
    </View>
  );
}

// ────────────────────────────── Compatibility ──────────────────────────────
function CompatibilityTab({
  vehicleId, domain, authHeaders,
}: { vehicleId: number; domain: string; authHeaders: () => Promise<Record<string, string>> }) {
  const colors = useColors();
  const [categories, setCategories] = useState<Category[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [compat, setCompat] = useState<Compat | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const headers = await authHeaders();
      const res = await fetch(getApiUrl("/mechanic/parts/categories"), { headers });
      if (res.ok) setCategories(await res.json());
    })();
  }, [domain, authHeaders]);

  const lookup = useCallback(async (key: string) => {
    setSelected(key); setCompat(null); setLoading(true);
    const headers = await authHeaders();
    const res = await fetch(getApiUrl(`/mechanic/vehicles/${vehicleId}/compatibility?category=${key}`), { headers });
    if (res.ok) setCompat(await res.json());
    setLoading(false);
  }, [domain, vehicleId, authHeaders]);

  return (
    <View style={{ gap: 12 }}>
      <Text style={[styles.helperText, { color: colors.mutedForeground }]}>
        Pick a category — APS combines static category data, this vehicle's install history, and prior mechanic overrides to score confidence.
      </Text>
      <View style={styles.catGrid}>
        {categories.map((c) => (
          <Pressable
            key={c.key}
            onPress={() => lookup(c.key)}
            style={[styles.catBtn, {
              backgroundColor: selected === c.key ? colors.primary : colors.card,
              borderColor: selected === c.key ? colors.primary : colors.border,
            }]}
          >
            <View style={[styles.catDot, { backgroundColor: CONFIDENCE_COLORS[c.baseConfidence] }]} />
            <Text style={[styles.catLabel, { color: selected === c.key ? "white" : colors.foreground }]}>
              {c.label}
            </Text>
          </Pressable>
        ))}
      </View>
      {loading ? <ActivityIndicator color={colors.primary} /> : null}
      {compat ? (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: CONFIDENCE_COLORS[compat.confidence] }]}>
          <View style={styles.partHeader}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>{compat.label}</Text>
            <View style={[styles.confPill, { backgroundColor: CONFIDENCE_COLORS[compat.confidence] }]}>
              <Text style={[styles.confPillText, { color: "white" }]}>{compat.confidence.toUpperCase()}</Text>
            </View>
          </View>
          <Text style={[styles.cardBody, { color: colors.foreground, marginTop: 6 }]}>{compat.rationale}</Text>
          {compat.suggestedPartNumber ? (
            <View style={[styles.suggestBox, { backgroundColor: colors.background, borderColor: colors.border }]}>
              <Text style={[styles.suggestLabel, { color: colors.mutedForeground }]}>SUGGESTED FROM HISTORY</Text>
              <Text style={[styles.suggestVal, { color: colors.foreground }]}>{compat.suggestedPartNumber}</Text>
              {compat.suggestedBrand ? (
                <Text style={[styles.cardMeta, { color: colors.mutedForeground }]}>{compat.suggestedBrand}{compat.suggestedSupplier ? ` · ${compat.suggestedSupplier}` : ""}</Text>
              ) : null}
            </View>
          ) : null}
          {compat.verifySteps.length > 0 ? (
            <View style={{ marginTop: 10 }}>
              <Text style={[styles.suggestLabel, { color: colors.mutedForeground }]}>VERIFY BEFORE ORDERING</Text>
              {compat.verifySteps.map((s, i) => (
                <View key={i} style={styles.verifyRow}>
                  <Feather name="check-square" size={12} color={colors.mutedForeground} />
                  <Text style={[styles.cardMeta, { color: colors.foreground, flex: 1 }]}>{s}</Text>
                </View>
              ))}
            </View>
          ) : null}
          {compat.lastOverride ? (
            <View style={[styles.overrideBox, { borderColor: "#F59E0B", marginTop: 10 }]}>
              <Feather name="info" size={12} color="#92400E" />
              <Text style={[styles.overrideText, { color: "#92400E", flex: 1 }]}>
                Last mechanic override: {compat.lastOverride.reason}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

// ────────────────────────────── Recommendations ──────────────────────────────
function RecosTab({
  bundle, domain, authHeaders, reload,
}: { bundle: Bundle; domain: string; authHeaders: () => Promise<Record<string, string>>; reload: () => Promise<void> }) {
  const colors = useColors();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [urgency, setUrgency] = useState<"low" | "medium" | "high" | "critical">("medium");

  const submit = async () => {
    if (!title.trim()) return;
    const headers = await authHeaders();
    const res = await fetch(getApiUrl(`/mechanic/vehicles/${bundle.vehicle.id}/recommendations`), {
      method: "POST", headers,
      body: JSON.stringify({ title: title.trim(), description: desc.trim() || undefined, urgency }),
    });
    if (!res.ok) { await alertMessage("Save failed"); return; }
    setTitle(""); setDesc(""); setUrgency("medium"); setAdding(false);
    await reload();
  };

  const setStatus = async (id: number, status: "addressed" | "dismissed") => {
    const ok = await confirm({ title: status === "addressed" ? "Mark addressed?" : "Dismiss?" });
    if (!ok) return;
    const headers = await authHeaders();
    const res = await fetch(getApiUrl(`/mechanic/recommendations/${id}`), {
      method: "PATCH", headers, body: JSON.stringify({ status }),
    });
    if (!res.ok) { await alertMessage("Update failed"); return; }
    await reload();
  };

  const open = bundle.recommendations.filter((r) => r.status === "open");
  const closed = bundle.recommendations.filter((r) => r.status !== "open");

  return (
    <View style={{ gap: 10 }}>
      {!adding ? (
        <Pressable onPress={() => setAdding(true)} style={[styles.addBtn, { backgroundColor: colors.primary }]}>
          <Feather name="plus" size={14} color="white" />
          <Text style={styles.addBtnText}>Add recommendation</Text>
        </Pressable>
      ) : (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, gap: 10 }]}>
          <Field label="Title" value={title} onChange={setTitle} />
          <Field label="Description" value={desc} onChange={setDesc} multiline />
          <View style={styles.urgencyRow}>
            {(["low", "medium", "high", "critical"] as const).map((u) => (
              <Pressable
                key={u}
                onPress={() => setUrgency(u)}
                style={[styles.urgencyChip, {
                  backgroundColor: urgency === u ? URGENCY_COLORS[u] : colors.background,
                  borderColor: URGENCY_COLORS[u],
                }]}
              >
                <Text style={[styles.urgencyText, { color: urgency === u ? "white" : URGENCY_COLORS[u] }]}>{u}</Text>
              </Pressable>
            ))}
          </View>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Pressable onPress={() => setAdding(false)} style={[styles.cancelBtn, { borderColor: colors.border }]}>
              <Text style={{ color: colors.foreground }}>Cancel</Text>
            </Pressable>
            <Pressable onPress={submit} style={[styles.primaryBtn, { backgroundColor: colors.primary, flex: 1 }]}>
              <Text style={styles.primaryBtnText}>Save</Text>
            </Pressable>
          </View>
        </View>
      )}

      {open.length === 0 && closed.length === 0 ? <Empty text="No recommendations yet." /> : null}

      {open.length > 0 ? <SectionTitle text="Open" /> : null}
      {open.map((r) => (
        <View key={r.id} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.partHeader}>
            <View style={styles.noteHeaderLeft}>
              <View style={[styles.urgencyDot, { backgroundColor: URGENCY_COLORS[r.urgency] }]} />
              <Text style={[styles.cardTitle, { color: colors.foreground, flexShrink: 1 }]}>{r.title}</Text>
            </View>
          </View>
          {r.description ? <Text style={[styles.cardBody, { color: colors.foreground, marginTop: 6 }]}>{r.description}</Text> : null}
          <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
            <Pressable onPress={() => setStatus(r.id, "addressed")} style={[styles.smallBtn, { backgroundColor: "#10B981" }]}>
              <Text style={styles.smallBtnText}>Address</Text>
            </Pressable>
            <Pressable onPress={() => setStatus(r.id, "dismissed")} style={[styles.smallBtn, { backgroundColor: colors.secondary, borderWidth: 1, borderColor: colors.border }]}>
              <Text style={[styles.smallBtnText, { color: colors.foreground }]}>Dismiss</Text>
            </Pressable>
          </View>
        </View>
      ))}

      {closed.length > 0 ? <SectionTitle text="Closed" /> : null}
      {closed.map((r) => (
        <View key={r.id} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, opacity: 0.6 }]}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>{r.title}</Text>
          <Text style={[styles.cardMeta, { color: colors.mutedForeground }]}>{r.status}</Text>
        </View>
      ))}
    </View>
  );
}

// ────────────────────────────── Notes ──────────────────────────────
function NotesTab({
  bundle, domain, authHeaders, reload,
}: { bundle: Bundle; domain: string; authHeaders: () => Promise<Record<string, string>>; reload: () => Promise<void> }) {
  const colors = useColors();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [type, setType] = useState<"observation" | "warning" | "diagnostic">("observation");
  const [severity, setSeverity] = useState<"info" | "low" | "medium" | "high">("info");

  const submit = async () => {
    if (!title.trim()) return;
    const headers = await authHeaders();
    const res = await fetch(getApiUrl(`/mechanic/vehicles/${bundle.vehicle.id}/notes`), {
      method: "POST", headers,
      body: JSON.stringify({ title: title.trim(), body: body.trim() || undefined, type, severity }),
    });
    if (!res.ok) { await alertMessage("Save failed"); return; }
    setTitle(""); setBody(""); setType("observation"); setSeverity("info"); setAdding(false);
    await reload();
  };

  const toggleResolved = async (n: Note) => {
    const headers = await authHeaders();
    const res = await fetch(getApiUrl(`/mechanic/notes/${n.id}`), {
      method: "PATCH", headers, body: JSON.stringify({ resolved: !n.resolvedAt }),
    });
    if (!res.ok) { await alertMessage("Update failed"); return; }
    await reload();
  };

  return (
    <View style={{ gap: 10 }}>
      {!adding ? (
        <Pressable onPress={() => setAdding(true)} style={[styles.addBtn, { backgroundColor: colors.primary }]}>
          <Feather name="plus" size={14} color="white" />
          <Text style={styles.addBtnText}>Add note</Text>
        </Pressable>
      ) : (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, gap: 10 }]}>
          <View style={styles.urgencyRow}>
            {(["observation", "warning", "diagnostic"] as const).map((t) => (
              <Pressable key={t} onPress={() => setType(t)} style={[styles.urgencyChip, {
                backgroundColor: type === t ? colors.primary : colors.background, borderColor: colors.border,
              }]}>
                <Text style={{ color: type === t ? "white" : colors.foreground, fontSize: 12, fontWeight: "600" }}>{t}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.urgencyRow}>
            {(["info", "low", "medium", "high"] as const).map((s) => (
              <Pressable key={s} onPress={() => setSeverity(s)} style={[styles.urgencyChip, {
                backgroundColor: severity === s ? SEVERITY_COLORS[s] : colors.background, borderColor: SEVERITY_COLORS[s],
              }]}>
                <Text style={{ color: severity === s ? "white" : SEVERITY_COLORS[s], fontSize: 12, fontWeight: "600" }}>{s}</Text>
              </Pressable>
            ))}
          </View>
          <Field label="Title" value={title} onChange={setTitle} />
          <Field label="Detail" value={body} onChange={setBody} multiline />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Pressable onPress={() => setAdding(false)} style={[styles.cancelBtn, { borderColor: colors.border }]}>
              <Text style={{ color: colors.foreground }}>Cancel</Text>
            </Pressable>
            <Pressable onPress={submit} style={[styles.primaryBtn, { backgroundColor: colors.primary, flex: 1 }]}>
              <Text style={styles.primaryBtnText}>Save</Text>
            </Pressable>
          </View>
        </View>
      )}

      {bundle.notes.length === 0
        ? <Empty text="No mechanic notes yet. Capture observations so the next mechanic sees them." />
        : bundle.notes.map((n) => (
          <Pressable key={n.id} onPress={() => toggleResolved(n)}>
            <View style={[styles.card, {
              backgroundColor: colors.card, borderColor: colors.border, opacity: n.resolvedAt ? 0.5 : 1,
            }]}>
              <View style={styles.partHeader}>
                <View style={styles.noteHeaderLeft}>
                  <View style={[styles.severityDot, { backgroundColor: SEVERITY_COLORS[n.severity] }]} />
                  <Text style={[styles.cardTitle, { color: colors.foreground, flexShrink: 1 }]}>{n.title}</Text>
                </View>
                <Text style={[styles.noteType, { color: colors.mutedForeground }]}>{n.type}</Text>
              </View>
              {n.body ? <Text style={[styles.cardMeta, { color: colors.mutedForeground, marginTop: 4 }]}>{n.body}</Text> : null}
              <Text style={[styles.cardMeta, { color: colors.mutedForeground, marginTop: 4 }]}>
                {n.resolvedAt ? "✓ Resolved · tap to reopen" : "Tap to mark resolved"}
              </Text>
            </View>
          </Pressable>
        ))}
    </View>
  );
}

// ────────────────────────────── Specs ──────────────────────────────
function SpecsTab({ profile }: { profile: Profile }) {
  const colors = useColors();
  const decoded = profile.decoded ?? {};
  const ordered = useMemo(() => {
    const order = [
      "ModelYear", "Make", "Model", "Trim", "Series", "VehicleType", "BodyClass",
      "EngineModel", "EngineCylinders", "DisplacementL", "EngineHP",
      "FuelTypePrimary", "TransmissionStyle", "DriveType",
      "PlantCity", "PlantState", "PlantCountry", "Manufacturer",
      "Doors", "GVWR",
    ];
    return order
      .map((k) => ({ key: k, label: k.replace(/([A-Z])/g, " $1").trim(), value: decoded[k] ?? "" }))
      .filter((r) => r.value && r.value !== "Not Applicable");
  }, [decoded]);

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {ordered.length === 0 ? (
        <Empty text="VIN not yet decoded." />
      ) : ordered.map((r) => (
        <View key={r.key} style={[styles.specRow, { borderBottomColor: colors.border }]}>
          <Text style={[styles.specRowLabel, { color: colors.mutedForeground }]}>{r.label}</Text>
          <Text style={[styles.specRowVal, { color: colors.foreground }]}>{r.value}</Text>
        </View>
      ))}
    </View>
  );
}

// ────────────────────────────── Diagram ──────────────────────────────
function DiagramTab({
  vehicleId, domain, authHeaders,
}: { vehicleId: number; domain: string; authHeaders: () => Promise<Record<string, string>> }) {
  const colors = useColors();
  const [active, setActive] = useState<DiagramComponent | null>(null);
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);

  const tap = useCallback(async (k: DiagramComponent) => {
    setActive(k); setData(null); setLoading(true);
    const headers = await authHeaders();
    const res = await fetch(getApiUrl(`/mechanic/vehicles/${vehicleId}/diagram-lookup?component=${k}`), { headers });
    if (res.ok) setData(await res.json());
    setLoading(false);
  }, [domain, vehicleId, authHeaders]);

  return (
    <View style={{ gap: 12 }}>
      <Text style={[styles.helperText, { color: colors.mutedForeground }]}>
        Tap any component for OEM hints overlaid with what's currently installed on this VIN.
      </Text>
      <VehicleDiagram active={active} onComponentTap={tap} />
      {loading ? <ActivityIndicator color={colors.primary} /> : null}
      {data ? (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.foreground, marginBottom: 6 }]}>
            {active?.replace(/_/g, " ")}
          </Text>
          {Object.entries(data).map(([k, v]) => {
            if (k === "component" || v === null || v === undefined) return null;
            const display = typeof v === "string" ? v : JSON.stringify(v, null, 2);
            return (
              <View key={k} style={{ marginTop: 6 }}>
                <Text style={[styles.specRowLabel, { color: colors.mutedForeground }]}>{k}</Text>
                <Text style={[styles.cardBody, { color: colors.foreground }]}>{display}</Text>
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

// ────────────────────────────── Styles ──────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  header: { padding: 14, borderBottomWidth: 1 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  headerIcon: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 18, fontWeight: "700" },
  headerTrim: { fontSize: 12, marginTop: 2 },
  vinPill: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginTop: 10, alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 6, backgroundColor: "rgba(0,0,0,0.05)",
  },
  vinPillLabel: { fontSize: 10, letterSpacing: 1, fontWeight: "700" },
  vinPillVal: { fontSize: 12, fontFamily: "monospace", letterSpacing: 0.5 },
  headerStats: { flexDirection: "row", justifyContent: "space-between", marginTop: 12 },
  statCell: { alignItems: "center", gap: 2, flex: 1 },
  statValue: { fontSize: 14, fontWeight: "700" },
  statLabel: { fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5 },
  tabs: { borderBottomWidth: 1, flexGrow: 0 },
  chip: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingVertical: 8, paddingHorizontal: 12, borderRadius: 18, borderWidth: 1,
  },
  chipText: { fontSize: 12, fontWeight: "600" },
  card: { padding: 12, borderRadius: 10, borderWidth: 1 },
  cardTitle: { fontSize: 14, fontWeight: "600" },
  cardMeta: { fontSize: 12, marginTop: 2 },
  cardBody: { fontSize: 13, marginTop: 6, lineHeight: 18 },
  sectionTitle: { fontSize: 11, letterSpacing: 1, fontWeight: "700", marginTop: 4 },
  emptyBox: { padding: 16, borderRadius: 10, borderWidth: 1, borderStyle: "dashed", alignItems: "center" },
  alertCard: { padding: 12, borderRadius: 10, borderWidth: 1, gap: 6 },
  alertHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  alertTitle: { fontWeight: "700", fontSize: 13 },
  alertRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  alertItem: { fontSize: 13, flex: 1 },
  alertLink: { marginTop: 4 },
  alertLinkText: { fontSize: 12, fontWeight: "600" },
  urgencyDot: { width: 8, height: 8, borderRadius: 4 },
  severityDot: { width: 8, height: 8, borderRadius: 4 },
  partHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  noteHeaderLeft: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1 },
  noteType: { fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 },
  confPill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 },
  confPillText: { fontSize: 10, fontWeight: "700" },
  overrideBox: {
    flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8,
    padding: 6, borderRadius: 6, borderWidth: 1, backgroundColor: "#FEF3C7",
  },
  overrideText: { fontSize: 11, flex: 1 },
  tagRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  tag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 },
  tagText: { fontSize: 10, fontWeight: "600" },
  timelineRow: { flexDirection: "row", gap: 8 },
  timelineGutter: { width: 14, alignItems: "center" },
  timelineDot: { width: 10, height: 10, borderRadius: 5, marginTop: 14 },
  timelineLine: { width: 2, flex: 1, marginTop: 4 },
  addBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 6, paddingVertical: 10, borderRadius: 8,
  },
  addBtnText: { color: "white", fontWeight: "600", fontSize: 13 },
  primaryBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 6, paddingVertical: 12, borderRadius: 8,
  },
  primaryBtnText: { color: "white", fontWeight: "700", fontSize: 14 },
  cancelBtn: { paddingVertical: 12, paddingHorizontal: 16, borderRadius: 8, borderWidth: 1 },
  smallBtn: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 6 },
  smallBtnText: { color: "white", fontWeight: "600", fontSize: 12 },
  helperText: { fontSize: 12, lineHeight: 17 },
  catGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  catBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 10, paddingVertical: 8, borderRadius: 6, borderWidth: 1,
  },
  catDot: { width: 6, height: 6, borderRadius: 3 },
  catLabel: { fontSize: 12, fontWeight: "500" },
  suggestBox: { marginTop: 10, padding: 10, borderRadius: 6, borderWidth: 1 },
  suggestLabel: { fontSize: 10, letterSpacing: 1, fontWeight: "700" },
  suggestVal: { fontSize: 14, fontWeight: "700", fontFamily: "monospace", marginTop: 2 },
  verifyRow: { flexDirection: "row", alignItems: "flex-start", gap: 6, marginTop: 4 },
  fieldLabel: { fontSize: 11, marginBottom: 4, fontWeight: "600", letterSpacing: 0.3 },
  fieldInput: { borderWidth: 1, borderRadius: 8, padding: 10, fontSize: 14 },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalSheet: { borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: "85%" },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: 1 },
  modalTitle: { fontSize: 16, fontWeight: "700" },
  urgencyRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  urgencyChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, borderWidth: 1 },
  urgencyText: { fontSize: 11, fontWeight: "700", textTransform: "uppercase" },
  specRow: { paddingVertical: 10, borderBottomWidth: 1, gap: 2 },
  specRowLabel: { fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 },
  specRowVal: { fontSize: 14, fontWeight: "500" },
});
