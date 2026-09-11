import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Modal,
  TextInput,
  Linking,
  Platform,
} from "react-native";
import Svg, { Path, Rect, Circle, Ellipse, G } from "react-native-svg";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  useGetJob,
  useGetVehicle,
  useGetVehicleHistory,
  useGetVehicleComponentSpecs,
  useGetVehiclePartsCatalog,
  useGetVehicleRecommendations,
  assistantChat,
  type ServiceRecommendation,
  type CatalogPart,
  type ComponentSpecs,
  type AssistantChatMessage,
  type JobStatus,
} from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { StatusBadge } from "@/components/StatusBadge";
import { confirm, alertMessage } from "@/utils/confirm";
import { getApiUrl } from "@/lib/apiConfig";

type Tab = "overview" | "parts" | "history" | "recommendations" | "assistant" | "notes";

const TABS: { key: Tab; label: string; icon: keyof typeof Feather.glyphMap }[] = [
  { key: "overview",        label: "Overview",        icon: "layout" },
  { key: "parts",           label: "Parts",           icon: "package" },
  { key: "history",         label: "History",         icon: "clock" },
  { key: "recommendations", label: "Recommendations", icon: "alert-circle" },
  { key: "assistant",       label: "AI Assist",       icon: "message-square" },
  { key: "notes",           label: "Work Notes",      icon: "edit-3" },
];

type Zone = "tires" | "windshield" | "suspension" | null;

export default function VehicleWorkbenchScreen() {
  const colors = useColors();
  const router = useRouter();
  const { user } = useAuth();
  const { jobId: jobIdParam } = useLocalSearchParams<{ jobId: string }>();
  const jobId = parseInt(String(jobIdParam ?? ""), 10);

  const [tab, setTab] = useState<Tab>("overview");
  const [zone, setZone] = useState<Zone>(null);

  const { data: job, isLoading: jobLoading } = useGetJob(jobId, {
    query: { enabled: Number.isFinite(jobId) } as any,
  });

  const vehicleId = job?.vehicleId ?? null;

  if (jobLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!job || !vehicleId) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.destructive }}>Job not found</Text>
      </View>
    );
  }

  // Strict access guard — only the assigned mechanic on an active job
  const isAssignedMechanic = user?.role === "mechanic" && job.mechanicId === user.id;
  const isActiveStatus = ["ACCEPTED", "EN_ROUTE", "IN_PROGRESS", "COMPLETED", "PAID"].includes(job.status);
  if (!isAssignedMechanic || !isActiveStatus) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background, padding: 24 }]}>
        <Feather name="lock" size={32} color={colors.mutedForeground} />
        <Text style={{ color: colors.foreground, fontSize: 16, fontWeight: "700", marginTop: 12 }}>
          Workbench unavailable
        </Text>
        <Text style={{ color: colors.mutedForeground, fontSize: 13, textAlign: "center", marginTop: 8 }}>
          The Vehicle Workbench is only available to the mechanic assigned to this job
          while the job is active.
        </Text>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {/* Header */}
        <View style={[styles.header, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
            <Feather name="chevron-left" size={26} color={colors.foreground} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={[styles.headerTitle, { color: colors.foreground }]}>Vehicle Workbench</Text>
            <Text style={[styles.headerSub, { color: colors.mutedForeground }]} numberOfLines={1}>
              Job #{job.id} · VIN-locked · append-only
            </Text>
          </View>
        </View>

        {/* Tab strip */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabStrip}
        >
          {TABS.map((t) => {
            const active = tab === t.key;
            return (
              <Pressable
                key={t.key}
                onPress={() => setTab(t.key)}
                style={[
                  styles.tabBtn,
                  {
                    backgroundColor: active ? colors.primary : colors.card,
                    borderColor: active ? colors.primary : colors.border,
                  },
                ]}
              >
                <Feather name={t.icon} size={14} color={active ? "white" : colors.foreground} />
                <Text style={[styles.tabText, { color: active ? "white" : colors.foreground }]}>
                  {t.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Tab content */}
        <View style={{ flex: 1 }}>
          {tab === "overview" && (
            <OverviewTab
              vehicleId={vehicleId}
              job={job}
              onZoneTap={setZone}
            />
          )}
          {tab === "parts"           && <PartsTab vehicleId={vehicleId} jobId={job.id} />}
          {tab === "history"         && <HistoryTab vehicleId={vehicleId} />}
          {tab === "recommendations" && (
            <RecommendationsTab
              vehicleId={vehicleId}
              customerId={job.customerId}
              jobId={job.id}
            />
          )}
          {tab === "assistant" && (
            <AssistantTab vehicleId={vehicleId} jobId={job.id} />
          )}
          {tab === "notes" && (
            <NotesTab
              jobStatus={job.status as JobStatus}
              onOpenWorklog={() => router.push(`/worklog/${job.id}`)}
            />
          )}
        </View>

        {/* Component-spec modal triggered by overview clickable zones */}
        <ComponentZoneModal vehicleId={vehicleId} jobId={job.id} zone={zone} onClose={() => setZone(null)} />
      </View>
    </>
  );
}

// ─── Overview tab ────────────────────────────────────────────────────────────

function OverviewTab({
  vehicleId,
  job,
  onZoneTap,
}: {
  vehicleId: number;
  job: { vin?: string | null; status: JobStatus; vehicle?: { year?: number; make?: string; model?: string; mileage?: number } | null };
  onZoneTap: (z: Zone) => void;
}) {
  const colors = useColors();
  const { data: vehicle } = useGetVehicle(vehicleId, {
    query: { enabled: Number.isFinite(vehicleId) } as any,
  });

  const v = vehicle ?? job.vehicle;
  const make = v?.make ?? "—";
  const model = v?.model ?? "—";
  const year = v?.year ?? "—";
  const vin = (vehicle?.vin ?? job.vin) ?? "—";
  const mileage = vehicle?.mileage ?? v?.mileage ?? 0;

  return (
    <ScrollView
      contentContainerStyle={styles.scroll}
      contentInsetAdjustmentBehavior="automatic"
    >
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.cardTitle, { color: colors.foreground }]}>
          {year} {make} {model}
        </Text>
        <View style={styles.metaRow}>
          <Feather name="hash" size={13} color={colors.mutedForeground} />
          <Text style={[styles.metaText, { color: colors.mutedForeground }]} selectable>{vin}</Text>
        </View>
        <View style={styles.metaRow}>
          <Feather name="activity" size={13} color={colors.mutedForeground} />
          <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
            {mileage.toLocaleString()} mi
          </Text>
        </View>
        <View style={styles.metaRow}>
          <Feather name="briefcase" size={13} color={colors.mutedForeground} />
          <StatusBadge status={job.status} />
        </View>
      </View>

      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.cardTitle, { color: colors.foreground }]}>Interactive Vehicle</Text>
        <Text style={[styles.cardHint, { color: colors.mutedForeground }]}>
          Tap a highlighted zone to see VIN-derived component specs.
        </Text>

        <CarSilhouette
          colors={{ stroke: colors.foreground, primary: colors.primary, muted: colors.mutedForeground }}
          onTires={() => onZoneTap("tires")}
          onWindshield={() => onZoneTap("windshield")}
          onSuspension={() => onZoneTap("suspension")}
        />

        <View style={styles.zoneLegend}>
          <Pressable style={[styles.zoneChip, { borderColor: colors.primary + "55", backgroundColor: colors.primary + "12" }]} onPress={() => onZoneTap("tires")}>
            <Feather name="disc" size={13} color={colors.primary} />
            <Text style={[styles.zoneChipText, { color: colors.primary }]}>Tires</Text>
          </Pressable>
          <Pressable style={[styles.zoneChip, { borderColor: colors.primary + "55", backgroundColor: colors.primary + "12" }]} onPress={() => onZoneTap("windshield")}>
            <Feather name="square" size={13} color={colors.primary} />
            <Text style={[styles.zoneChipText, { color: colors.primary }]}>Windshield</Text>
          </Pressable>
          <Pressable style={[styles.zoneChip, { borderColor: colors.primary + "55", backgroundColor: colors.primary + "12" }]} onPress={() => onZoneTap("suspension")}>
            <Feather name="settings" size={13} color={colors.primary} />
            <Text style={[styles.zoneChipText, { color: colors.primary }]}>Front End / Suspension</Text>
          </Pressable>
        </View>
      </View>
    </ScrollView>
  );
}

function CarSilhouette({
  colors,
  onTires,
  onWindshield,
  onSuspension,
}: {
  colors: { stroke: string; primary: string; muted: string };
  onTires: () => void;
  onWindshield: () => void;
  onSuspension: () => void;
}) {
  // Simple side-profile silhouette with three clickable zones.
  return (
    <View style={{ marginTop: 12, alignItems: "center" }}>
      <Svg width={320} height={140} viewBox="0 0 320 140">
        {/* Body */}
        <Path
          d="M30,100 L60,60 L120,40 L210,40 L260,70 L290,75 L300,95 L300,108 L270,108 L260,118 L80,118 L70,108 L30,108 Z"
          fill={colors.muted + "33"}
          stroke={colors.stroke}
          strokeWidth={2}
        />
        {/* Windshield clickable zone */}
        <G onPress={onWindshield}>
          <Path
            d="M125,42 L200,42 L240,72 L138,72 Z"
            fill={colors.primary + "33"}
            stroke={colors.primary}
            strokeWidth={2}
          />
        </G>
        {/* Front end / suspension clickable zone */}
        <G onPress={onSuspension}>
          <Rect x={235} y={78} width={60} height={28} fill={colors.primary + "22"} stroke={colors.primary} strokeDasharray="4,3" strokeWidth={1.5} rx={4} />
        </G>
        {/* Wheels (clickable as tire zone) */}
        <G onPress={onTires}>
          <Circle cx={80} cy={112} r={18} fill={colors.stroke} />
          <Circle cx={80} cy={112} r={9}  fill={colors.muted} />
          <Circle cx={250} cy={112} r={18} fill={colors.stroke} />
          <Circle cx={250} cy={112} r={9}  fill={colors.muted} />
          {/* highlight ring */}
          <Circle cx={80}  cy={112} r={20} fill="none" stroke={colors.primary} strokeWidth={1.5} strokeDasharray="3,3" />
          <Circle cx={250} cy={112} r={20} fill="none" stroke={colors.primary} strokeWidth={1.5} strokeDasharray="3,3" />
        </G>
        {/* Ground line */}
        <Ellipse cx={165} cy={132} rx={140} ry={4} fill={colors.muted + "44"} />
      </Svg>
    </View>
  );
}

// ─── Component zone modal ────────────────────────────────────────────────────

function ComponentZoneModal({
  vehicleId,
  jobId,
  zone,
  onClose,
}: {
  vehicleId: number;
  jobId: number;
  zone: Zone;
  onClose: () => void;
}) {
  const colors = useColors();
  const { data: specs, isLoading } = useGetVehicleComponentSpecs(
    vehicleId,
    { jobId },
    { query: { enabled: zone != null && Number.isFinite(vehicleId) } as any },
  );

  return (
    <Modal visible={zone != null} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={[styles.modalSheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.modalHead}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>
              {zone === "tires" && "Tires"}
              {zone === "windshield" && "Windshield & Wipers"}
              {zone === "suspension" && "Front End / Suspension"}
            </Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Feather name="x" size={22} color={colors.foreground} />
            </Pressable>
          </View>

          {isLoading || !specs ? (
            <ActivityIndicator color={colors.primary} style={{ marginVertical: 24 }} />
          ) : (
            <ScrollView style={{ maxHeight: 480 }} contentContainerStyle={{ paddingBottom: 16 }}>
              <SpecBadge label={`Source: ${specs.source}`} colors={colors} />
              {zone === "tires" && <TireSpecView specs={specs} colors={colors} />}
              {zone === "windshield" && <WiperSpecView specs={specs} colors={colors} />}
              {zone === "suspension" && <SuspensionSpecView specs={specs} colors={colors} />}
              {specs.notes ? (
                <Text style={[styles.specNote, { color: colors.mutedForeground }]}>
                  {specs.notes}
                </Text>
              ) : null}
              <Text style={[styles.specNote, { color: colors.mutedForeground, marginTop: 12 }]}>
                Mechanic override: log any modifications detected as a structured note in the
                Work Notes tab. The next visit will see your override in the VIN history.
              </Text>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

function SpecBadge({ label, colors }: { label: string; colors: any }) {
  return (
    <View style={[styles.specBadge, { backgroundColor: colors.primary + "18", borderColor: colors.primary + "55" }]}>
      <Text style={{ color: colors.primary, fontSize: 11, fontWeight: "700" }}>{label.toUpperCase()}</Text>
    </View>
  );
}

function TireSpecView({ specs, colors }: { specs: ComponentSpecs; colors: any }) {
  return (
    <View style={{ gap: 8 }}>
      <SpecRow label="Front" value={specs.tires.front} colors={colors} />
      <SpecRow label="Rear" value={specs.tires.rear} colors={colors} />
      <SpecRow label="Recommended" value={specs.tires.recommended} colors={colors} />
      {specs.tires.notes ? <Text style={[styles.specNote, { color: colors.mutedForeground }]}>{specs.tires.notes}</Text> : null}
    </View>
  );
}

function WiperSpecView({ specs, colors }: { specs: ComponentSpecs; colors: any }) {
  return (
    <View style={{ gap: 8 }}>
      <SpecRow label="Driver" value={specs.wipers.driver} colors={colors} />
      <SpecRow label="Passenger" value={specs.wipers.passenger} colors={colors} />
      {specs.wipers.rear ? <SpecRow label="Rear" value={specs.wipers.rear} colors={colors} /> : null}
      {specs.wipers.partNumbers && specs.wipers.partNumbers.length > 0 ? (
        <SpecRow label="Part #s" value={specs.wipers.partNumbers.join(", ")} colors={colors} />
      ) : null}
    </View>
  );
}

function SuspensionSpecView({ specs, colors }: { specs: ComponentSpecs; colors: any }) {
  const s = specs.suspension;
  return (
    <View style={{ gap: 8 }}>
      {s.cvAxle ? <SpecRow label="CV Axle" value={s.cvAxle} colors={colors} /> : null}
      {s.tieRod ? <SpecRow label="Tie Rod" value={s.tieRod} colors={colors} /> : null}
      {s.controlArm ? <SpecRow label="Control Arm" value={s.controlArm} colors={colors} /> : null}
      {s.knownFailures && s.knownFailures.length > 0 ? (
        <View style={{ marginTop: 4 }}>
          <Text style={{ color: colors.foreground, fontWeight: "700", marginBottom: 4 }}>Known failure points</Text>
          {s.knownFailures.map((f, i) => (
            <Text key={i} style={[styles.specBullet, { color: colors.mutedForeground }]}>• {f}</Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function SpecRow({ label, value, colors }: { label: string; value: string; colors: any }) {
  return (
    <View>
      <Text style={{ color: colors.mutedForeground, fontSize: 11, fontWeight: "700", letterSpacing: 0.5 }}>{label.toUpperCase()}</Text>
      <Text style={{ color: colors.foreground, fontSize: 14, marginTop: 2 }} selectable>{value}</Text>
    </View>
  );
}

// ─── Parts tab ───────────────────────────────────────────────────────────────

const PART_CATEGORIES = ["all", "engine", "brakes", "suspension", "filters", "fluids", "electrical", "wipers", "tires"] as const;
type PartCat = typeof PART_CATEGORIES[number];

function PartsTab({ vehicleId, jobId }: { vehicleId: number; jobId: number }) {
  const colors = useColors();
  const [category, setCategory] = useState<PartCat>("all");
  const { data, isLoading } = useGetVehiclePartsCatalog(vehicleId, { jobId, category }, {
    query: { enabled: Number.isFinite(vehicleId) } as any,
  });

  const openLink = async (url: string) => {
    try {
      if (Platform.OS === "web") window.open(url, "_blank");
      else await Linking.openURL(url);
    } catch {
      await alertMessage("Couldn't open link", "Try again or copy the URL manually.");
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, paddingBottom: 8 }]}>
        <Text style={[styles.cardTitle, { color: colors.foreground }]}>VIN-Compatible Parts</Text>
        <Text style={[styles.cardHint, { color: colors.mutedForeground }]}>
          Filtered by VIN year/make/model. OEM-equivalent parts prioritized. Deep links to RockAuto / AutoZone / NAPA / Advance.
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingTop: 12 }}>
          {PART_CATEGORIES.map((c) => {
            const active = category === c;
            return (
              <Pressable
                key={c}
                onPress={() => setCategory(c)}
                style={[
                  styles.pill,
                  { borderColor: active ? colors.primary : colors.border, backgroundColor: active ? colors.primary : colors.background },
                ]}
              >
                <Text style={{ color: active ? "white" : colors.foreground, fontSize: 12, fontWeight: "600" }}>{c}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 16 }} />
      ) : (data?.parts ?? []).length === 0 ? (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
            No parts in this category match the VIN configuration.
          </Text>
        </View>
      ) : (
        (data?.parts ?? []).map((p: CatalogPart) => (
          <View key={p.id} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
              <View style={{ flex: 1, marginRight: 12 }}>
                <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: "700" }}>{p.name}</Text>
                <Text style={{ color: colors.mutedForeground, fontSize: 12, marginTop: 2 }}>
                  {p.brand} · {p.partNumber}
                </Text>
              </View>
              <Text style={{ color: colors.primary, fontSize: 16, fontWeight: "700" }}>${p.estimatedPriceUsd.toFixed(2)}</Text>
            </View>

            <View style={[styles.metaRow, { marginTop: 8 }]}>
              <View style={[styles.tinyBadge, { backgroundColor: p.oemEquivalent ? colors.primary + "18" : colors.muted, borderColor: p.oemEquivalent ? colors.primary + "55" : colors.border }]}>
                <Text style={{ fontSize: 10, color: p.oemEquivalent ? colors.primary : colors.foreground, fontWeight: "700" }}>
                  {p.oemEquivalent ? "OEM-EQUIV" : "AFTERMARKET"}
                </Text>
              </View>
              <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>
                {p.availability} · ETA {p.etaDays}d
              </Text>
            </View>

            {p.notes ? (
              <Text style={{ color: colors.mutedForeground, fontSize: 12, marginTop: 8 }}>{p.notes}</Text>
            ) : null}

            <View style={[styles.linkRow]}>
              {p.supplierLinks.map((s, i) => (
                <Pressable
                  key={i}
                  onPress={() => void openLink(s.url)}
                  style={[styles.linkBtn, { borderColor: colors.border, backgroundColor: colors.background }]}
                >
                  <Feather name="external-link" size={11} color={colors.foreground} />
                  <Text style={{ color: colors.foreground, fontSize: 11, fontWeight: "600" }}>{s.supplier}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ))
      )}
    </ScrollView>
  );
}

// ─── History tab ─────────────────────────────────────────────────────────────

function HistoryTab({ vehicleId }: { vehicleId: number }) {
  const colors = useColors();
  const { data: history, isLoading } = useGetVehicleHistory(vehicleId, {
    query: { enabled: Number.isFinite(vehicleId) } as any,
  });

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.cardTitle, { color: colors.foreground }]}>VIN Service Timeline</Text>
        <Text style={[styles.cardHint, { color: colors.mutedForeground }]}>
          Append-only history. Persists across ownership transfers.
        </Text>
      </View>

      {isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 16 }} />
      ) : (history ?? []).length === 0 ? (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
            No prior service logged for this VIN.
          </Text>
        </View>
      ) : (
        [...(history ?? [])].reverse().map((log: any) => (
          <View key={log.id} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={{ color: colors.foreground, fontWeight: "700" }}>
                {log.serviceCategory?.toUpperCase()}
              </Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
                {new Date(log.createdAt).toLocaleDateString()}
              </Text>
            </View>
            <Text style={{ color: colors.foreground, marginTop: 6 }}>{log.serviceDescription}</Text>
            <View style={[styles.metaRow, { marginTop: 8 }]}>
              <Feather name="user" size={12} color={colors.mutedForeground} />
              <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
                {log.mechanicName ?? "Mechanic"} · {(log.mileageAtService ?? 0).toLocaleString()} mi
              </Text>
            </View>
            {log.diagnosticCodes && (log.diagnosticCodes as string[]).length > 0 ? (
              <View style={[styles.metaRow, { marginTop: 4 }]}>
                <Feather name="cpu" size={12} color={colors.mutedForeground} />
                <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
                  Codes: {(log.diagnosticCodes as string[]).join(", ")}
                </Text>
              </View>
            ) : null}
            {log.partsUsed && (log.partsUsed as string[]).length > 0 ? (
              <View style={[styles.metaRow, { marginTop: 4 }]}>
                <Feather name="package" size={12} color={colors.mutedForeground} />
                <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
                  Parts: {(log.partsUsed as string[]).join(", ")}
                </Text>
              </View>
            ) : null}
            {log.rootCauseDiagnosis ? (
              <Text style={{ color: colors.mutedForeground, fontSize: 12, marginTop: 6, fontStyle: "italic" }}>
                Root cause: {log.rootCauseDiagnosis}
              </Text>
            ) : null}
          </View>
        ))
      )}
    </ScrollView>
  );
}

// ─── Recommendations tab ─────────────────────────────────────────────────────

const SEVERITY_COLOR: Record<string, string> = {
  safety: "#DC2626",
  overdue: "#D97706",
  "due-soon": "#2563EB",
  info: "#6B7280",
};

function RecommendationsTab({
  vehicleId,
  jobId,
}: {
  vehicleId: number;
  customerId: number;
  jobId: number;
}) {
  const colors = useColors();
  const { data: recs, isLoading } = useGetVehicleRecommendations(
    vehicleId,
    { jobId },
    { query: { enabled: Number.isFinite(vehicleId) } as any },
  );
  const [sentIds, setSentIds] = useState<Set<string>>(new Set());
  const [sendingId, setSendingId] = useState<string | null>(null);

  const handleSendToCustomer = async (rec: ServiceRecommendation) => {
    const ok = await confirm({
      title: "Send to customer?",
      message: `"${rec.title}" will be sent in the job chat as an advisory recommendation.`,
      confirmText: "Send",
    });
    if (!ok) return;

    const cost = rec.estimatedCostRangeUsd
      ? ` Estimated: $${rec.estimatedCostRangeUsd[0]}–$${rec.estimatedCostRangeUsd[1]}.`
      : "";
    const content = `🔧 Recommendation (advisory): ${rec.title}\n\n${rec.detail}\n\nSuggested action: ${rec.suggestedAction}${cost}`;

    setSendingId(rec.id);
    try {
      const token = await AsyncStorage.getItem("auth_token");
      const res = await fetch(getApiUrl(`/jobs/${jobId}/messages`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) throw new Error(`Send failed (${res.status})`);
      setSentIds((prev) => new Set(prev).add(rec.id));
    } catch (e: any) {
      await alertMessage("Couldn't send", e?.message ?? "Try again.");
    } finally {
      setSendingId(null);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.cardTitle, { color: colors.foreground }]}>Service Recommendations</Text>
        <Text style={[styles.cardHint, { color: colors.mutedForeground }]}>
          Advisory only — never auto-creates jobs. Mileage rules + recurring history tags + known model failure points.
        </Text>
      </View>

      {isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 16 }} />
      ) : (recs ?? []).length === 0 ? (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
            No outstanding recommendations for this vehicle.
          </Text>
        </View>
      ) : (
        (recs ?? []).map((r: ServiceRecommendation) => {
          const sev = SEVERITY_COLOR[r.severity] ?? colors.mutedForeground;
          const sent = sentIds.has(r.id);
          return (
            <View key={r.id} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, borderLeftColor: sev, borderLeftWidth: 4 }]}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                <Text style={{ color: colors.foreground, fontWeight: "700", flex: 1, marginRight: 8 }}>{r.title}</Text>
                <View style={[styles.tinyBadge, { backgroundColor: sev + "22", borderColor: sev + "55" }]}>
                  <Text style={{ fontSize: 10, color: sev, fontWeight: "700" }}>{r.severity.toUpperCase()}</Text>
                </View>
              </View>
              <Text style={{ color: colors.foreground, fontSize: 13, marginTop: 6, lineHeight: 18 }}>{r.detail}</Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 12, marginTop: 6 }}>
                <Text style={{ fontWeight: "700" }}>Action:</Text> {r.suggestedAction}
              </Text>
              {r.estimatedCostRangeUsd ? (
                <Text style={{ color: colors.mutedForeground, fontSize: 12, marginTop: 4 }}>
                  Est. ${r.estimatedCostRangeUsd[0]}–${r.estimatedCostRangeUsd[1]}
                </Text>
              ) : null}
              <Text style={{ color: colors.mutedForeground, fontSize: 11, marginTop: 8, fontStyle: "italic" }}>
                Source: {r.source}
              </Text>

              <Pressable
                onPress={() => void handleSendToCustomer(r)}
                disabled={sent || sendingId === r.id}
                style={[
                  styles.linkBtn,
                  {
                    marginTop: 12,
                    borderColor: sent ? colors.border : colors.primary + "55",
                    backgroundColor: sent ? colors.muted : colors.primary + "12",
                    opacity: sent ? 0.7 : 1,
                  },
                ]}
              >
                <Feather name={sent ? "check" : "send"} size={12} color={sent ? colors.mutedForeground : colors.primary} />
                <Text style={{ color: sent ? colors.mutedForeground : colors.primary, fontSize: 12, fontWeight: "700" }}>
                  {sent ? "Sent to customer" : "Send recommendation to customer"}
                </Text>
              </Pressable>
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

// ─── AI Assistant tab ────────────────────────────────────────────────────────

const QUICK_PROMPTS = [
  "What torque spec does this vehicle use for CV axle bolts?",
  "Common causes of front-left clunk noise on this model?",
  "What's the correct part number for the alternator?",
  "Step-by-step: replace front brake pads on this vehicle.",
];

interface ChatMsg { role: "user" | "assistant"; content: string; urgency?: "low" | "medium" | "high" | null }

function AssistantTab({ vehicleId, jobId }: { vehicleId: number; jobId: number }) {
  const colors = useColors();
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  const send = async (msg: string) => {
    if (!msg.trim() || sending) return;
    setSending(true);
    const next = [...messages, { role: "user" as const, content: msg.trim() }];
    setMessages(next);
    setInput("");
    try {
      const history: AssistantChatMessage[] = next.slice(0, -1).map((m) => ({
        role: m.role,
        content: m.content,
      }));
      const res = await assistantChat({
        message: msg.trim(),
        history,
        context: { vehicleId, jobId, screen: `workbench/${jobId}` },
      });
      setMessages((m) => [
        ...m,
        { role: "assistant", content: res.reply, urgency: res.urgency ?? null },
      ]);
    } catch (e: any) {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: `Sorry — I couldn't reach the assistant. ${e?.message ?? ""}` },
      ]);
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: 20 }]}
      >
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>AI Mechanic Assistant</Text>
          <Text style={[styles.cardHint, { color: colors.mutedForeground }]}>
            VIN context is automatically attached. Ask torque specs, part numbers, diagnostic
            chains — answers prioritize accurate mechanical guidance.
          </Text>
        </View>

        {messages.length === 0 && (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={{ color: colors.mutedForeground, fontSize: 12, marginBottom: 8 }}>Quick prompts</Text>
            <View style={{ gap: 8 }}>
              {QUICK_PROMPTS.map((p) => (
                <Pressable
                  key={p}
                  onPress={() => void send(p)}
                  style={[styles.quickPrompt, { borderColor: colors.border, backgroundColor: colors.background }]}
                >
                  <Text style={{ color: colors.foreground, fontSize: 13 }}>{p}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {messages.map((m, i) => (
          <View
            key={i}
            style={[
              styles.bubble,
              m.role === "user"
                ? { alignSelf: "flex-end", backgroundColor: colors.primary }
                : { alignSelf: "flex-start", backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 },
            ]}
          >
            <Text style={{ color: m.role === "user" ? "white" : colors.foreground, fontSize: 14, lineHeight: 20 }}>
              {m.content}
            </Text>
            {m.urgency ? (
              <Text style={{
                color: m.urgency === "high" ? "#DC2626" : m.urgency === "medium" ? "#D97706" : "#16A34A",
                fontSize: 10, fontWeight: "700", marginTop: 6, letterSpacing: 0.5,
              }}>
                URGENCY: {m.urgency.toUpperCase()}
              </Text>
            ) : null}
          </View>
        ))}

        {sending && <ActivityIndicator color={colors.primary} style={{ marginTop: 8 }} />}
      </ScrollView>

      <View style={[styles.composer, { backgroundColor: colors.card, borderTopColor: colors.border }]}>
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder="Ask the assistant…"
          placeholderTextColor={colors.mutedForeground}
          style={[styles.composerInput, { color: colors.foreground, backgroundColor: colors.background, borderColor: colors.border }]}
          editable={!sending}
          onSubmitEditing={() => void send(input)}
          returnKeyType="send"
        />
        <Pressable
          style={[styles.sendBtn, { backgroundColor: colors.primary, opacity: sending || !input.trim() ? 0.5 : 1 }]}
          onPress={() => void send(input)}
          disabled={sending || !input.trim()}
        >
          <Feather name="send" size={16} color="white" />
        </Pressable>
      </View>
    </View>
  );
}

// ─── Notes tab ───────────────────────────────────────────────────────────────

function NotesTab({ jobStatus, onOpenWorklog }: { jobStatus: string; onOpenWorklog: () => void }) {
  const colors = useColors();
  const canSubmit = jobStatus === "IN_PROGRESS";

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.cardTitle, { color: colors.foreground }]}>Structured Work Notes</Text>
        <Text style={[styles.cardHint, { color: colors.mutedForeground }]}>
          Notes submitted from the work-log form are appended to VIN history and become immutable.
          They include customer complaint, diagnostic findings, repair actions, parts installed,
          and additional recommendations.
        </Text>

        <View style={{ marginTop: 12, gap: 6 }}>
          {[
            "Customer complaint description",
            "Diagnostic findings + OBD2 codes",
            "Repair actions taken",
            "Parts installed (with part numbers)",
            "Additional recommendations",
            "Recurring issue tags (for future visits)",
          ].map((s) => (
            <View key={s} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Feather name="check-circle" size={14} color={colors.primary} />
              <Text style={{ color: colors.foreground, fontSize: 13 }}>{s}</Text>
            </View>
          ))}
        </View>

        <Pressable
          onPress={onOpenWorklog}
          disabled={!canSubmit}
          style={[
            styles.primaryBtn,
            {
              backgroundColor: canSubmit ? colors.primary : colors.muted,
              opacity: canSubmit ? 1 : 0.7,
              marginTop: 16,
            },
          ]}
        >
          <Feather name="edit-3" size={16} color="white" />
          <Text style={{ color: "white", fontWeight: "700" }}>
            {canSubmit ? "Open Work Log Form" : "Available once job is IN_PROGRESS"}
          </Text>
        </Pressable>

        <Text style={{ color: colors.mutedForeground, fontSize: 11, marginTop: 10, fontStyle: "italic" }}>
          Once submitted, the work log cannot be edited. It will appear in this VIN's history for
          all current and future owners.
        </Text>
      </View>
    </ScrollView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 12, paddingTop: Platform.OS === "ios" ? 56 : 36,
    paddingBottom: 12, borderBottomWidth: 1,
  },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 17, fontWeight: "700" },
  headerSub: { fontSize: 11, marginTop: 2 },
  tabStrip: { paddingHorizontal: 12, paddingVertical: 10, gap: 6 },
  tabBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1,
  },
  tabText: { fontSize: 12, fontWeight: "600" },
  scroll: { padding: 12, paddingBottom: 120, gap: 12 },
  card: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 4 },
  cardTitle: { fontSize: 15, fontWeight: "700" },
  cardHint: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 },
  metaText: { fontSize: 12 },
  zoneLegend: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 12 },
  zoneChip: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  zoneChipText: { fontSize: 11, fontWeight: "700" },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalSheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, borderWidth: 1, gap: 12 },
  modalHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  modalTitle: { fontSize: 17, fontWeight: "700" },
  specBadge: { alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1, marginBottom: 8 },
  specNote: { fontSize: 12, marginTop: 8, fontStyle: "italic" },
  specBullet: { fontSize: 12, marginTop: 2 },
  pill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1 },
  tinyBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, borderWidth: 1 },
  linkRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 },
  linkBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 6, borderWidth: 1 },
  bubble: { maxWidth: "85%", padding: 10, borderRadius: 12 },
  quickPrompt: { padding: 10, borderRadius: 8, borderWidth: 1 },
  composer: {
    flexDirection: "row", alignItems: "center", gap: 8,
    padding: 10, borderTopWidth: 1, paddingBottom: Platform.OS === "ios" ? 30 : 16,
  },
  composerInput: { flex: 1, height: 40, borderRadius: 8, paddingHorizontal: 12, borderWidth: 1, fontSize: 14 },
  sendBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 8 },
  primaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 46, borderRadius: 10 },
});
