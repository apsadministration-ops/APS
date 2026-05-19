/**
 * Fleet & Commercial management screen for shop owners.
 *
 * Lets a shop owner:
 *   - Register fleet / commercial accounts they manage.
 *   - Add vehicles per account.
 *   - Submit individual or bulk service requests that are INJECTED as
 *     normal jobs into the existing APS dispatch pool.
 *
 * Once a job is created via /fleet/jobs, it behaves exactly like any other
 * job in the system — same dispatch, same accept flow, same completion
 * flow. The only difference is a small "FLEET" / "COMMERCIAL" badge the
 * mechanic sees on their job cards.
 */
import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  Alert,
  Platform,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { Feather } from "@expo/vector-icons";

type AccountKind = "fleet" | "commercial";
type ServiceTier = "basic" | "premium" | "enterprise";
type Priority = "standard" | "priority" | "urgent";

interface FleetAccount {
  id: number;
  companyName: string;
  accountKind: AccountKind;
  serviceTier: ServiceTier;
  defaultPriority: Priority;
  responseTimeMinutes: number;
  active: boolean;
}

interface FleetVehicle {
  id: number;
  accountId: number;
  vehicleId: number | null;
  vin: string;
  label: string | null;
}

interface FleetContract {
  id: number;
  contractNumber: string;
  name: string;
  priorityOverride: Priority | null;
  active: boolean;
}

function webPrompt(msg: string): string | null {
  if (Platform.OS === "web") return window.prompt(msg);
  return null;
}

export default function FleetScreen() {
  const { token } = useAuth();
  const colors = useColors();
  const [accounts, setAccounts] = useState<FleetAccount[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<{ contracts: FleetContract[]; vehicles: FleetVehicle[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);

  // Job request draft
  const [draftVehicleId, setDraftVehicleId] = useState<number | null>(null);
  const [draftDesc, setDraftDesc] = useState("");
  const [draftJobType, setDraftJobType] = useState<"repair" | "diagnostic" | "maintenance" | "detailing">("repair");
  const [draftPriority, setDraftPriority] = useState<Priority>("standard");

  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

  const loadAccounts = useCallback(async () => {
    try {
      const r = await fetch("/api/fleet/accounts", { headers });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data: FleetAccount[] = await r.json();
      setAccounts(data);
      if (selectedId == null && data.length > 0) setSelectedId(data[0].id);
    } catch (e) {
      console.warn("fleet accounts load failed", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token, selectedId]);

  const loadDetail = useCallback(async (id: number) => {
    try {
      const r = await fetch(`/api/fleet/accounts/${id}`, { headers });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setDetail({ contracts: data.contracts ?? [], vehicles: data.vehicles ?? [] });
    } catch (e) {
      console.warn("fleet detail load failed", e);
    }
  }, [token]);

  useEffect(() => { loadAccounts(); }, []); // initial
  useEffect(() => { if (selectedId != null) loadDetail(selectedId); }, [selectedId, loadDetail]);

  const createAccount = async () => {
    const name = webPrompt("Company name");
    if (!name) return;
    setBusy(true);
    try {
      const r = await fetch("/api/fleet/accounts", {
        method: "POST", headers,
        body: JSON.stringify({ companyName: name, accountKind: "fleet" }),
      });
      if (!r.ok) throw new Error(await r.text());
      await loadAccounts();
    } catch (e) {
      Alert.alert("Could not create account", String(e));
    } finally { setBusy(false); }
  };

  const addVehicle = async () => {
    if (selectedId == null) return;
    const vin = webPrompt("VIN (11-17 chars)");
    if (!vin) return;
    const make = webPrompt("Make") ?? "Unknown";
    const model = webPrompt("Model") ?? "Unknown";
    const yearStr = webPrompt("Year") ?? "2020";
    setBusy(true);
    try {
      const r = await fetch(`/api/fleet/accounts/${selectedId}/vehicles`, {
        method: "POST", headers,
        body: JSON.stringify({
          vin, make, model, year: parseInt(yearStr, 10) || 2020, mileage: 0,
        }),
      });
      if (!r.ok) throw new Error(await r.text());
      await loadDetail(selectedId);
    } catch (e) {
      Alert.alert("Could not add vehicle", String(e));
    } finally { setBusy(false); }
  };

  const submitJob = async () => {
    if (selectedId == null || draftVehicleId == null) {
      Alert.alert("Pick a vehicle first"); return;
    }
    if (!draftDesc.trim() || draftDesc.trim().length < 5) {
      Alert.alert("Describe the work (5+ chars)"); return;
    }
    setBusy(true);
    try {
      const r = await fetch(`/api/fleet/jobs`, {
        method: "POST", headers,
        body: JSON.stringify({
          accountId: selectedId,
          requests: [{
            fleetVehicleId: draftVehicleId,
            description: draftDesc.trim(),
            jobType: draftJobType,
            priority: draftPriority,
          }],
        }),
      });
      if (!r.ok) throw new Error(await r.text());
      const data = await r.json();
      Alert.alert("Submitted", `${data.summary.created} job(s) created, ${data.summary.skipped} skipped.`);
      setDraftDesc("");
    } catch (e) {
      Alert.alert("Could not submit job", String(e));
    } finally { setBusy(false); }
  };

  const selectedAccount = accounts.find((a) => a.id === selectedId) ?? null;

  if (loading) {
    return (
      <View style={[s.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadAccounts(); }} />}
    >
      <Text style={[s.h1, { color: colors.foreground }]}>Fleet & Commercial</Text>
      <Text style={[s.sub, { color: colors.mutedForeground }]}>
        Submit service requests for your fleet. Each request becomes a normal job that mechanics can accept.
      </Text>

      {/* Accounts */}
      <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={s.rowBetween}>
          <Text style={[s.h2, { color: colors.foreground }]}>Accounts</Text>
          <Pressable onPress={createAccount} style={[s.btn, { backgroundColor: colors.primary }]} disabled={busy}>
            <Feather name="plus" size={14} color="#fff" />
            <Text style={s.btnText}>New</Text>
          </Pressable>
        </View>
        {accounts.length === 0 ? (
          <Text style={[s.muted, { color: colors.mutedForeground }]}>No fleet accounts yet. Create one to get started.</Text>
        ) : (
          <View style={{ gap: 8 }}>
            {accounts.map((a) => (
              <Pressable
                key={a.id}
                onPress={() => setSelectedId(a.id)}
                style={[s.accountRow, {
                  backgroundColor: selectedId === a.id ? colors.primary + "22" : "transparent",
                  borderColor: colors.border,
                }]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[s.accountName, { color: colors.foreground }]}>{a.companyName}</Text>
                  <Text style={[s.muted, { color: colors.mutedForeground }]}>
                    {a.accountKind.toUpperCase()} · tier: {a.serviceTier} · default: {a.defaultPriority}
                  </Text>
                </View>
                {selectedId === a.id ? <Feather name="check" size={16} color={colors.primary} /> : null}
              </Pressable>
            ))}
          </View>
        )}
      </View>

      {selectedAccount && detail ? (
        <>
          {/* Vehicles */}
          <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={s.rowBetween}>
              <Text style={[s.h2, { color: colors.foreground }]}>Vehicles</Text>
              <Pressable onPress={addVehicle} style={[s.btn, { backgroundColor: colors.primary }]} disabled={busy}>
                <Feather name="plus" size={14} color="#fff" />
                <Text style={s.btnText}>Add</Text>
              </Pressable>
            </View>
            {detail.vehicles.length === 0 ? (
              <Text style={[s.muted, { color: colors.mutedForeground }]}>No vehicles yet.</Text>
            ) : (
              <View style={{ gap: 8 }}>
                {detail.vehicles.map((v) => (
                  <Pressable
                    key={v.id}
                    onPress={() => setDraftVehicleId(v.id)}
                    style={[s.vehicleRow, {
                      backgroundColor: draftVehicleId === v.id ? colors.primary + "22" : "transparent",
                      borderColor: colors.border,
                    }]}
                  >
                    <Text style={[{ color: colors.foreground, fontWeight: "600" }]}>{v.label ?? v.vin}</Text>
                    <Text style={[s.muted, { color: colors.mutedForeground }]}>VIN: {v.vin}</Text>
                  </Pressable>
                ))}
              </View>
            )}
          </View>

          {/* Submit job */}
          <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[s.h2, { color: colors.foreground }]}>Submit Service Request</Text>
            <Text style={[s.muted, { color: colors.mutedForeground, marginBottom: 12 }]}>
              Becomes a normal job in the APS dispatch pool. Pricing + tier are derived server-side from the catalog.
            </Text>

            <Text style={[s.label, { color: colors.foreground }]}>Description</Text>
            <TextInput
              value={draftDesc}
              onChangeText={setDraftDesc}
              placeholder="e.g. Front brake pads + rotors on F-150 #3"
              placeholderTextColor={colors.mutedForeground}
              multiline
              style={[s.input, { color: colors.foreground, borderColor: colors.border, minHeight: 80 }]}
            />

            <Text style={[s.label, { color: colors.foreground }]}>Job type</Text>
            <View style={s.chips}>
              {(["repair", "diagnostic", "maintenance", "detailing"] as const).map((k) => (
                <Pressable key={k} onPress={() => setDraftJobType(k)}
                  style={[s.chip, {
                    backgroundColor: draftJobType === k ? colors.primary : "transparent",
                    borderColor: colors.border,
                  }]}>
                  <Text style={{ color: draftJobType === k ? "#fff" : colors.foreground, fontWeight: "600", fontSize: 12 }}>
                    {k}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={[s.label, { color: colors.foreground }]}>Priority</Text>
            <View style={s.chips}>
              {(["standard", "priority", "urgent"] as const).map((p) => (
                <Pressable key={p} onPress={() => setDraftPriority(p)}
                  style={[s.chip, {
                    backgroundColor: draftPriority === p ? colors.primary : "transparent",
                    borderColor: colors.border,
                  }]}>
                  <Text style={{ color: draftPriority === p ? "#fff" : colors.foreground, fontWeight: "600", fontSize: 12 }}>
                    {p}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Pressable
              onPress={submitJob}
              disabled={busy || draftVehicleId == null}
              style={[s.submit, { backgroundColor: colors.primary, opacity: busy || draftVehicleId == null ? 0.5 : 1 }]}
            >
              {busy ? <ActivityIndicator color="#fff" /> : (
                <>
                  <Feather name="send" size={14} color="#fff" />
                  <Text style={s.btnText}>Submit request</Text>
                </>
              )}
            </Pressable>
            {draftVehicleId == null ? (
              <Text style={[s.muted, { color: colors.mutedForeground, marginTop: 8 }]}>
                Pick a vehicle above to enable submit.
              </Text>
            ) : null}
          </View>
        </>
      ) : null}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  h1: { fontSize: 24, fontWeight: "700", marginBottom: 4 },
  h2: { fontSize: 16, fontWeight: "700" },
  sub: { fontSize: 13, marginBottom: 16 },
  card: { borderWidth: 1, borderRadius: 12, padding: 16, marginBottom: 16, gap: 12 },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  btn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  btnText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  muted: { fontSize: 12 },
  accountRow: { flexDirection: "row", alignItems: "center", padding: 12, borderRadius: 10, borderWidth: 1 },
  accountName: { fontSize: 15, fontWeight: "600", marginBottom: 2 },
  vehicleRow: { padding: 12, borderRadius: 10, borderWidth: 1, gap: 2 },
  label: { fontSize: 13, fontWeight: "600", marginTop: 8, marginBottom: 6 },
  input: { borderWidth: 1, borderRadius: 8, padding: 10, fontSize: 14 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999 },
  submit: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, borderRadius: 10, marginTop: 8 },
});
