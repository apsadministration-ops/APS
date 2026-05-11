import {
  View, Text, StyleSheet, Pressable, ActivityIndicator, TextInput, ScrollView, Image,
} from "react-native";
import { useColors } from "@/hooks/useColors";
import {
  useGetJob, useCreateInspection, getGetJobQueryKey, getListJobInspectionsQueryKey,
  CreateInspectionBodyKind, DamageChecklist, DamageChecklistItem,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useState } from "react";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { alertMessage } from "@/utils/confirm";
import * as ImagePicker from "expo-image-picker";

const CHECKLIST_KEYS = [
  "scratches", "dents", "glass", "wheels", "lights", "interior", "fluidLeaks",
] as const;

type ChecklistKey = typeof CHECKLIST_KEYS[number];

const CHECKLIST_LABELS: Record<ChecklistKey, string> = {
  scratches: "Scratches",
  dents: "Dents",
  glass: "Glass",
  wheels: "Wheels & tires",
  lights: "Lights",
  interior: "Interior",
  fluidLeaks: "Fluid leaks",
};

function blankChecklist(): Record<ChecklistKey, DamageChecklistItem> {
  const out = {} as Record<ChecklistKey, DamageChecklistItem>;
  for (const k of CHECKLIST_KEYS) out[k] = { ok: true };
  return out;
}

export default function InspectionScreen() {
  const colors = useColors();
  const router = useRouter();
  const { jobId, kind: kindParam } = useLocalSearchParams<{ jobId: string; kind?: string }>();
  const jid = parseInt(jobId, 10);
  const queryClient = useQueryClient();

  const { data: job } = useGetJob(jid);
  const createMutation = useCreateInspection();

  const initialKind: CreateInspectionBodyKind = kindParam === "post" ? "post" : "pre";
  const [kind, setKind] = useState<CreateInspectionBodyKind>(initialKind);
  const [mileage, setMileage] = useState("");
  const [mediaUrls, setMediaUrls] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [otherNotes, setOtherNotes] = useState("");
  const [transportPickup, setTransportPickup] = useState("");
  const [transportArrival, setTransportArrival] = useState("");
  const [items, setItems] = useState<Record<ChecklistKey, DamageChecklistItem>>(blankChecklist());
  const [itemNotes, setItemNotes] = useState<Record<ChecklistKey, string>>({} as Record<ChecklistKey, string>);
  const [error, setError] = useState("");

  const pickImages = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      quality: 0.8,
    });
    if (!result.canceled) {
      setMediaUrls((prev) => [...prev, ...result.assets.map((a) => a.uri)]);
    }
  };

  const removeImage = (idx: number) =>
    setMediaUrls((prev) => prev.filter((_, i) => i !== idx));

  const toggleItem = (k: ChecklistKey) =>
    setItems((prev) => ({ ...prev, [k]: { ok: !prev[k].ok, notes: prev[k].notes } }));

  const setNoteFor = (k: ChecklistKey, v: string) => {
    setItemNotes((prev) => ({ ...prev, [k]: v }));
    setItems((prev) => ({ ...prev, [k]: { ok: prev[k].ok, notes: v.trim() || undefined } }));
  };

  const submit = () => {
    setError("");
    const m = parseInt(mileage, 10);
    if (!Number.isFinite(m) || m < 0) { setError("Enter a valid odometer reading."); return; }
    if (mediaUrls.length === 0) { setError("Capture at least one walkthrough photo."); return; }
    const checklist: DamageChecklist = {
      scratches: items.scratches, dents: items.dents, glass: items.glass,
      wheels: items.wheels, lights: items.lights, interior: items.interior,
      fluidLeaks: items.fluidLeaks,
      other: otherNotes.trim() || undefined,
    };
    const data: any = {
      kind,
      mileage: m,
      mediaUrls,
      damageChecklist: checklist,
      notes: notes.trim() || undefined,
    };
    const tp = parseInt(transportPickup, 10);
    const ta = parseInt(transportArrival, 10);
    if (Number.isFinite(tp)) data.transportPickupMileage = tp;
    if (Number.isFinite(ta)) data.transportArrivalMileage = ta;

    createMutation.mutate(
      { jobId: jid, data },
      {
        onSuccess: async () => {
          queryClient.invalidateQueries({ queryKey: getGetJobQueryKey(jid) });
          queryClient.invalidateQueries({ queryKey: getListJobInspectionsQueryKey(jid) });
          await alertMessage(`${kind === "pre" ? "Pre" : "Post"}-inspection saved`, "Returning to job.");
          router.back();
        },
        onError: (e: any) => setError(e?.message ?? "Failed to save inspection."),
      },
    );
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: kind === "pre" ? "Pre-Service Inspection" : "Post-Service Inspection",
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.foreground,
          headerShown: true,
          presentation: "modal",
        }}
      />
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <KeyboardAwareScrollViewCompat
          contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
          bottomOffset={20}
        >
          {job && (
            <View style={[styles.jobCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.jobTitle, { color: colors.foreground }]}>
                {job.vehicle?.year} {job.vehicle?.make} {job.vehicle?.model}
              </Text>
              <Text style={[styles.jobVin, { color: colors.mutedForeground }]}>VIN {job.vin}</Text>
            </View>
          )}

          <Text style={[styles.section, { color: colors.mutedForeground }]}>INSPECTION TYPE</Text>
          <View style={styles.kindRow}>
            {(["pre", "post"] as CreateInspectionBodyKind[]).map((k) => {
              const sel = kind === k;
              return (
                <Pressable
                  key={k}
                  style={[styles.kindChip, {
                    backgroundColor: sel ? colors.primary : colors.card,
                    borderColor: sel ? colors.primary : colors.border,
                  }]}
                  onPress={() => setKind(k)}
                >
                  <Text style={{ color: sel ? "white" : colors.foreground, fontWeight: "700" }}>
                    {k === "pre" ? "Pre-Service" : "Post-Service"}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={[styles.section, { color: colors.mutedForeground, marginTop: 16 }]}>ODOMETER (MILES) *</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.card, color: colors.foreground, borderColor: colors.border }]}
            placeholder="Reading at this inspection"
            placeholderTextColor={colors.mutedForeground}
            keyboardType="number-pad"
            value={mileage}
            onChangeText={(t) => setMileage(t.replace(/[^0-9]/g, ""))}
          />

          <Text style={[styles.section, { color: colors.mutedForeground, marginTop: 16 }]}>WALKTHROUGH PHOTOS *</Text>
          <Pressable
            style={[styles.photoBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={pickImages}
          >
            <Feather name="camera" size={20} color={colors.mutedForeground} />
            <Text style={{ color: colors.mutedForeground, fontWeight: "600" }}>
              Add photos ({mediaUrls.length})
            </Text>
          </Pressable>
          {mediaUrls.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
              {mediaUrls.map((uri, i) => (
                <View key={i} style={{ marginRight: 8 }}>
                  <Image source={{ uri }} style={styles.thumb} />
                  <Pressable
                    style={[styles.removeImg, { backgroundColor: colors.destructive }]}
                    onPress={() => removeImage(i)}
                  >
                    <Feather name="x" size={12} color="white" />
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          )}

          <Text style={[styles.section, { color: colors.mutedForeground, marginTop: 16 }]}>DAMAGE CHECKLIST</Text>
          <Text style={[styles.helper, { color: colors.mutedForeground }]}>
            Tap an item to mark it NOT OK and add details.
          </Text>
          <View style={{ gap: 8, marginTop: 8 }}>
            {CHECKLIST_KEYS.map((k) => {
              const item = items[k];
              return (
                <View key={k} style={[styles.checkCard, { backgroundColor: colors.card, borderColor: item.ok ? colors.border : colors.destructive }]}>
                  <Pressable style={styles.checkRow} onPress={() => toggleItem(k)}>
                    <Feather
                      name={item.ok ? "check-circle" : "alert-circle"}
                      size={22}
                      color={item.ok ? "#22C55E" : colors.destructive}
                    />
                    <Text style={[styles.checkLabel, { color: colors.foreground }]}>{CHECKLIST_LABELS[k]}</Text>
                    <Text style={[styles.checkStatus, { color: item.ok ? "#22C55E" : colors.destructive }]}>
                      {item.ok ? "OK" : "ISSUE"}
                    </Text>
                  </Pressable>
                  {!item.ok && (
                    <TextInput
                      style={[styles.subInput, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
                      placeholder="What's wrong?"
                      placeholderTextColor={colors.mutedForeground}
                      value={itemNotes[k] ?? ""}
                      onChangeText={(v) => setNoteFor(k, v)}
                    />
                  )}
                </View>
              );
            })}
          </View>

          <Text style={[styles.section, { color: colors.mutedForeground, marginTop: 16 }]}>OTHER OBSERVATIONS</Text>
          <TextInput
            style={[styles.textarea, { backgroundColor: colors.card, color: colors.foreground, borderColor: colors.border }]}
            placeholder="Anything else worth recording…"
            placeholderTextColor={colors.mutedForeground}
            value={otherNotes}
            onChangeText={setOtherNotes}
            multiline
            textAlignVertical="top"
          />

          <Text style={[styles.section, { color: colors.mutedForeground, marginTop: 16 }]}>NOTES</Text>
          <TextInput
            style={[styles.textarea, { backgroundColor: colors.card, color: colors.foreground, borderColor: colors.border }]}
            placeholder="Free-form notes for the dispute trail."
            placeholderTextColor={colors.mutedForeground}
            value={notes}
            onChangeText={setNotes}
            multiline
            textAlignVertical="top"
          />

          <Text style={[styles.section, { color: colors.mutedForeground, marginTop: 16 }]}>TRANSPORT MILEAGE (OPTIONAL)</Text>
          <Text style={[styles.helper, { color: colors.mutedForeground }]}>
            Use these only when you drove the vehicle to the bay (ghost-garage). Capture the odometer at pickup and arrival.
          </Text>
          <View style={{ flexDirection: "row", gap: 10, marginTop: 8 }}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>PICKUP</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.card, color: colors.foreground, borderColor: colors.border }]}
                placeholder="123450"
                placeholderTextColor={colors.mutedForeground}
                keyboardType="number-pad"
                value={transportPickup}
                onChangeText={(t) => setTransportPickup(t.replace(/[^0-9]/g, ""))}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>ARRIVAL</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.card, color: colors.foreground, borderColor: colors.border }]}
                placeholder="123455"
                placeholderTextColor={colors.mutedForeground}
                keyboardType="number-pad"
                value={transportArrival}
                onChangeText={(t) => setTransportArrival(t.replace(/[^0-9]/g, ""))}
              />
            </View>
          </View>

          {error ? <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}

          <Pressable
            style={[styles.submitBtn, { backgroundColor: colors.primary }, createMutation.isPending && { opacity: 0.6 }]}
            onPress={submit}
            disabled={createMutation.isPending}
          >
            {createMutation.isPending
              ? <ActivityIndicator color="white" />
              : <Text style={styles.submitText}>Save Inspection</Text>}
          </Pressable>
        </KeyboardAwareScrollViewCompat>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  jobCard: { padding: 14, borderRadius: 12, borderWidth: 1, marginBottom: 16, gap: 4 },
  jobTitle: { fontSize: 16, fontWeight: "700" },
  jobVin: { fontSize: 12, fontFamily: "monospace" },
  section: { fontSize: 11, fontWeight: "700", letterSpacing: 1, marginBottom: 6 },
  kindRow: { flexDirection: "row", gap: 10 },
  kindChip: { flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1.5, alignItems: "center" },
  input: { height: 46, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, fontSize: 15 },
  textarea: { minHeight: 80, borderWidth: 1, borderRadius: 12, padding: 12, fontSize: 15 },
  photoBtn: { height: 56, borderWidth: 1, borderStyle: "dashed", borderRadius: 12, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 },
  thumb: { width: 80, height: 80, borderRadius: 8 },
  removeImg: { position: "absolute", top: 4, right: 4, width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  helper: { fontSize: 12, lineHeight: 18 },
  checkCard: { padding: 12, borderRadius: 12, borderWidth: 1, gap: 8 },
  checkRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  checkLabel: { flex: 1, fontSize: 14, fontWeight: "600" },
  checkStatus: { fontSize: 11, fontWeight: "800", letterSpacing: 1 },
  subInput: { height: 40, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, fontSize: 13 },
  label: { fontSize: 11, fontWeight: "700", letterSpacing: 1, marginBottom: 4 },
  error: { fontSize: 14, marginTop: 8 },
  submitBtn: { height: 56, borderRadius: 14, alignItems: "center", justifyContent: "center", marginTop: 20 },
  submitText: { color: "white", fontWeight: "700", fontSize: 17 },
});
