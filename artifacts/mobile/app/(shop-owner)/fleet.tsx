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
  ActivityIndicator,
  RefreshControl,
  Modal,
  KeyboardAvoidingView,
  Platform,
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

export default function FleetScreen() {
  const { token } = useAuth();
  const colors = useColors();

  const [accounts, setAccounts] = useState<FleetAccount[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<{ contracts: FleetContract[]; vehicles: FleetVehicle[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);

  // Modals
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [vehicleModalOpen, setVehicleModalOpen] = useState(false);

  // New-account form
  const [acctName, setAcctName] = useState("");
  const [acctKind, setAcctKind] = useState<AccountKind>("fleet");
  const [acctTier, setAcctTier] = useState<ServiceTier>("basic");
  const [acctDefaultPriority, setAcctDefaultPriority] = useState<Priority>("standard");

  // New-vehicle form
  const [vVin, setVVin] = useState("");
  const [vMake, setVMake] = useState("");
  const [vModel, setVModel] = useState("");
  const [vYear, setVYear] = useState("");
  const [vLabel, setVLabel] = useState("");

  // Job request draft
  const [draftVehicleId, setDraftVehicleId] = useState<number | null>(null);
  const [draftDesc, setDraftDesc] = useState("");
  const [draftJobType, setDraftJobType] = useState<"repair" | "diagnostic" | "maintenance" | "detailing">("repair");
  const [draftPriority, setDraftPriority] = useState<Priority>("standard");

  // Build headers fresh per request from the latest token. Computing this
  // once at render time and then capturing it inside a useCallback meant the
  // very first mount (when token was still null because AuthContext hadn't
  // hydrated from AsyncStorage yet) sent `Authorization: Bearer null`, which
  // the API rightly rejected — so the screen would silently sit on the empty
  // state and the Create button would silently fail.
  const authHeaders = useCallback(
    () => ({ "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` }),
    [token],
  );

  const loadAccounts = useCallback(async () => {
    if (!token) return; // wait for auth to hydrate
    try {
      const r = await fetch("/api/fleet/accounts", { headers: authHeaders() });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data: FleetAccount[] = await r.json();
      setAccounts(data);
      setSelectedId((cur) => (cur ?? (data[0]?.id ?? null)));
    } catch (e) {
      console.warn("fleet accounts load failed", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token, authHeaders]);

  const loadDetail = useCallback(async (id: number) => {
    if (!token) return;
    try {
      const r = await fetch(`/api/fleet/accounts/${id}`, { headers: authHeaders() });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setDetail({ contracts: data.contracts ?? [], vehicles: data.vehicles ?? [] });
    } catch (e) {
      console.warn("fleet detail load failed", e);
    }
  }, [token, authHeaders]);

  // Re-run as soon as the token becomes available (auth hydration finishes).
  useEffect(() => { loadAccounts(); }, [loadAccounts]);
  useEffect(() => { if (selectedId != null) loadDetail(selectedId); }, [selectedId, loadDetail]);

  const openAccountModal = () => {
    setAcctName(""); setAcctKind("fleet"); setAcctTier("basic"); setAcctDefaultPriority("standard");
    setAccountModalOpen(true);
  };

  const submitAccount = async () => {
    if (!acctName.trim() || acctName.trim().length < 2) {
      Alert.alert("Company name required", "Please enter a company name (2+ characters)."); return;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/fleet/accounts", {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify({
          companyName: acctName.trim(),
          accountKind: acctKind,
          serviceTier: acctTier,
          defaultPriority: acctDefaultPriority,
        }),
      });
      if (!r.ok) {
        const text = await r.text();
        throw new Error(text || `HTTP ${r.status}`);
      }
      const newAccount: FleetAccount = await r.json();
      setAccountModalOpen(false);
      await loadAccounts();
      setSelectedId(newAccount.id);
    } catch (e) {
      Alert.alert("Could not create account", String((e as Error).message ?? e));
    } finally { setBusy(false); }
  };

  const openVehicleModal = () => {
    if (selectedId == null) { Alert.alert("Select an account first"); return; }
    setVVin(""); setVMake(""); setVModel(""); setVYear(""); setVLabel("");
    setVehicleModalOpen(true);
  };

  const submitVehicle = async () => {
    if (selectedId == null) return;
    if (vVin.trim().length < 11) { Alert.alert("VIN must be at least 11 characters"); return; }
    if (!vMake.trim() || !vModel.trim()) { Alert.alert("Make and model required"); return; }
    const yr = parseInt(vYear, 10);
    if (!Number.isInteger(yr) || yr < 1900 || yr > 2100) { Alert.alert("Year must be a 4-digit number"); return; }
    setBusy(true);
    try {
      const r = await fetch(`/api/fleet/accounts/${selectedId}/vehicles`, {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify({
          vin: vVin.trim().toUpperCase(), make: vMake.trim(), model: vModel.trim(),
          year: yr, mileage: 0, label: vLabel.trim() || null,
        }),
      });
      if (!r.ok) {
        const text = await r.text();
        throw new Error(text || `HTTP ${r.status}`);
      }
      setVehicleModalOpen(false);
      await loadDetail(selectedId);
    } catch (e) {
      Alert.alert("Could not add vehicle", String((e as Error).message ?? e));
    } finally { setBusy(false); }
  };

  const submitJob = async () => {
    if (selectedId == null || draftVehicleId == null) { Alert.alert("Pick a vehicle first"); return; }
    if (!draftDesc.trim() || draftDesc.trim().length < 5) { Alert.alert("Describe the work (5+ chars)"); return; }
    setBusy(true);
    try {
      const r = await fetch(`/api/fleet/jobs`, {
        method: "POST", headers: authHeaders(),
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
      if (!r.ok) {
        const text = await r.text();
        throw new Error(text || `HTTP ${r.status}`);
      }
      const data = await r.json();
      Alert.alert("Submitted", `${data.summary.created} job(s) created, ${data.summary.skipped} skipped.`);
      setDraftDesc("");
    } catch (e) {
      Alert.alert("Could not submit job", String((e as Error).message ?? e));
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
    <>
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
            <Pressable onPress={openAccountModal} style={[s.btn, { backgroundColor: colors.primary }]}>
              <Feather name="plus" size={14} color="#fff" />
              <Text style={s.btnText}>New</Text>
            </Pressable>
          </View>
          {accounts.length === 0 ? (
            <Text style={[s.muted, { color: colors.mutedForeground }]}>No fleet accounts yet. Tap "New" to create one.</Text>
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
                <Pressable onPress={openVehicleModal} style={[s.btn, { backgroundColor: colors.primary }]}>
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

      {/* Create-account modal */}
      <Modal visible={accountModalOpen} transparent animationType="slide" onRequestClose={() => setAccountModalOpen(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={s.modalBackdrop}
        >
          <View style={[s.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={s.rowBetween}>
              <Text style={[s.h2, { color: colors.foreground }]}>New Fleet Account</Text>
              <Pressable onPress={() => setAccountModalOpen(false)} hitSlop={10}>
                <Feather name="x" size={22} color={colors.mutedForeground} />
              </Pressable>
            </View>

            <Text style={[s.label, { color: colors.foreground }]}>Company name</Text>
            <TextInput
              value={acctName}
              onChangeText={setAcctName}
              placeholder="Acme Logistics"
              placeholderTextColor={colors.mutedForeground}
              autoFocus
              style={[s.input, { color: colors.foreground, borderColor: colors.border }]}
            />

            <Text style={[s.label, { color: colors.foreground }]}>Account type</Text>
            <View style={s.chips}>
              {(["fleet", "commercial"] as const).map((k) => (
                <Pressable key={k} onPress={() => setAcctKind(k)}
                  style={[s.chip, {
                    backgroundColor: acctKind === k ? colors.primary : "transparent",
                    borderColor: colors.border,
                  }]}>
                  <Text style={{ color: acctKind === k ? "#fff" : colors.foreground, fontWeight: "600", fontSize: 12 }}>{k}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={[s.label, { color: colors.foreground }]}>Service tier</Text>
            <View style={s.chips}>
              {(["basic", "premium", "enterprise"] as const).map((t) => (
                <Pressable key={t} onPress={() => setAcctTier(t)}
                  style={[s.chip, {
                    backgroundColor: acctTier === t ? colors.primary : "transparent",
                    borderColor: colors.border,
                  }]}>
                  <Text style={{ color: acctTier === t ? "#fff" : colors.foreground, fontWeight: "600", fontSize: 12 }}>{t}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={[s.label, { color: colors.foreground }]}>Default priority</Text>
            <View style={s.chips}>
              {(["standard", "priority", "urgent"] as const).map((p) => (
                <Pressable key={p} onPress={() => setAcctDefaultPriority(p)}
                  style={[s.chip, {
                    backgroundColor: acctDefaultPriority === p ? colors.primary : "transparent",
                    borderColor: colors.border,
                  }]}>
                  <Text style={{ color: acctDefaultPriority === p ? "#fff" : colors.foreground, fontWeight: "600", fontSize: 12 }}>{p}</Text>
                </Pressable>
              ))}
            </View>

            <Pressable
              onPress={submitAccount}
              disabled={busy}
              style={[s.submit, { backgroundColor: colors.primary, opacity: busy ? 0.5 : 1 }]}
            >
              {busy ? <ActivityIndicator color="#fff" /> : (
                <>
                  <Feather name="check" size={14} color="#fff" />
                  <Text style={s.btnText}>Create account</Text>
                </>
              )}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Add-vehicle modal */}
      <Modal visible={vehicleModalOpen} transparent animationType="slide" onRequestClose={() => setVehicleModalOpen(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={s.modalBackdrop}
        >
          <View style={[s.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={s.rowBetween}>
              <Text style={[s.h2, { color: colors.foreground }]}>Add Vehicle</Text>
              <Pressable onPress={() => setVehicleModalOpen(false)} hitSlop={10}>
                <Feather name="x" size={22} color={colors.mutedForeground} />
              </Pressable>
            </View>

            <Text style={[s.label, { color: colors.foreground }]}>VIN (11-17 chars)</Text>
            <TextInput
              value={vVin}
              onChangeText={setVVin}
              placeholder="1FTFW1ET5DFC10312"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="characters"
              autoFocus
              style={[s.input, { color: colors.foreground, borderColor: colors.border }]}
            />

            <Text style={[s.label, { color: colors.foreground }]}>Make</Text>
            <TextInput value={vMake} onChangeText={setVMake} placeholder="Ford"
              placeholderTextColor={colors.mutedForeground}
              style={[s.input, { color: colors.foreground, borderColor: colors.border }]} />

            <Text style={[s.label, { color: colors.foreground }]}>Model</Text>
            <TextInput value={vModel} onChangeText={setVModel} placeholder="F-150"
              placeholderTextColor={colors.mutedForeground}
              style={[s.input, { color: colors.foreground, borderColor: colors.border }]} />

            <Text style={[s.label, { color: colors.foreground }]}>Year</Text>
            <TextInput value={vYear} onChangeText={setVYear} placeholder="2022"
              keyboardType="number-pad"
              placeholderTextColor={colors.mutedForeground}
              style={[s.input, { color: colors.foreground, borderColor: colors.border }]} />

            <Text style={[s.label, { color: colors.foreground }]}>Label (optional)</Text>
            <TextInput value={vLabel} onChangeText={setVLabel} placeholder="Truck #3"
              placeholderTextColor={colors.mutedForeground}
              style={[s.input, { color: colors.foreground, borderColor: colors.border }]} />

            <Pressable
              onPress={submitVehicle}
              disabled={busy}
              style={[s.submit, { backgroundColor: colors.primary, opacity: busy ? 0.5 : 1 }]}
            >
              {busy ? <ActivityIndicator color="#fff" /> : (
                <>
                  <Feather name="check" size={14} color="#fff" />
                  <Text style={s.btnText}>Add vehicle</Text>
                </>
              )}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
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
  submit: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, borderRadius: 10, marginTop: 12 },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalCard: { borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, padding: 20, paddingBottom: 36, gap: 4 },
});
