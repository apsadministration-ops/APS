import {
  View, Text, StyleSheet, Pressable, ActivityIndicator,
  TextInput, Image, ScrollView,
} from "react-native";
import { alertMessage } from "@/utils/confirm";
import { useColors } from "@/hooks/useColors";
import { useGetJob, useCreateWorkLog, useListMyBookings } from "@workspace/api-client-react";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { useState } from "react";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { CapabilityNotice } from "@/components/CapabilityNotice";
import { openAppSettings, pickImageLibrary } from "@/lib/deviceCapabilities";

const SERVICE_CATEGORIES = ["repair", "diagnostic", "maintenance", "detailing"] as const;
const WORKLOG_BOOKING_STATUSES = new Set(["reserved", "active", "completed"]);

export default function WorkLogScreen() {
  const colors = useColors();
  const router = useRouter();
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const jid = parseInt(jobId, 10);

  const { data: job } = useGetJob(jid);
  const { data: myBookings } = useListMyBookings();
  const createMutation = useCreateWorkLog();

  const [category, setCategory] = useState<(typeof SERVICE_CATEGORIES)[number]>("repair");
  const [description, setDescription] = useState("");
  const [mileageAtService, setMileageAtService] = useState("");
  const [laborCost, setLaborCost] = useState("");
  // Itemized parts (True Net Profit). partsCost is derived from this list.
  const [partsItems, setPartsItems] = useState<Array<{
    name: string; partNumber: string; brand: string; supplier: string;
    quantity: string; unitPriceDollars: string;
  }>>([]);
  const [partsUsed, setPartsUsed] = useState<string[]>([]);
  const [newPart, setNewPart] = useState("");

  const addPartsItem = () => setPartsItems((prev) => [...prev, { name: "", partNumber: "", brand: "", supplier: "", quantity: "1", unitPriceDollars: "" }]);
  const removePartsItem = (idx: number) => setPartsItems((prev) => prev.filter((_, i) => i !== idx));
  const updatePartsItem = (idx: number, field: keyof typeof partsItems[number], value: string) =>
    setPartsItems((prev) => prev.map((p, i) => i === idx ? { ...p, [field]: value } : p));
  const partsTotalDollars = partsItems.reduce((s, p) => {
    const q = parseInt(p.quantity, 10) || 0;
    const price = parseFloat(p.unitPriceDollars) || 0;
    return s + q * price;
  }, 0);
  const [notes, setNotes] = useState("");
  const [beforeImages, setBeforeImages] = useState<string[]>([]);
  const [afterImages, setAfterImages] = useState<string[]>([]);
  const [laborHours, setLaborHours] = useState("");
  const [diagnosticCodes, setDiagnosticCodes] = useState<string[]>([]);
  const [newDtc, setNewDtc] = useState("");
  const [rootCauseDiagnosis, setRootCauseDiagnosis] = useState("");
  const [repairSteps, setRepairSteps] = useState("");
  const [observedSymptoms, setObservedSymptoms] = useState("");
  const [recommendedMonitoring, setRecommendedMonitoring] = useState("");
  const [recurringIssueTags, setRecurringIssueTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState("");
  const [error, setError] = useState("");
  const [photoError, setPhotoError] = useState<{
    message: string;
    canAskAgain: boolean;
  } | null>(null);

  // A work log can only be linked to a booking that reached a usable
  // lifecycle state. Pending/rejected/cancelled requests must never satisfy
  // the Ghost Garage gate or be submitted as the booking association.
  const matchingBooking = (myBookings ?? []).find(
    (b) => b.jobId === jid && WORKLOG_BOOKING_STATUSES.has(b.status),
  );
  const requiresGhost = job?.requiresGhostGarage === true;

  const addDtc = () => {
    const t = newDtc.trim().toUpperCase();
    if (t) { setDiagnosticCodes((prev) => [...prev, t]); setNewDtc(""); }
  };
  const removeDtc = (idx: number) => setDiagnosticCodes((p) => p.filter((_, i) => i !== idx));

  const addTag = () => {
    const t = newTag.trim();
    if (t) { setRecurringIssueTags((prev) => [...prev, t]); setNewTag(""); }
  };
  const removeTag = (idx: number) => setRecurringIssueTags((p) => p.filter((_, i) => i !== idx));

  const pickImages = async (setter: (imgs: string[]) => void) => {
    setPhotoError(null);
    const result = await pickImageLibrary();
    if (result.status === "selected") {
      setter(result.uris);
    } else if (result.status === "unavailable") {
      setPhotoError({
        message: result.message,
        canAskAgain: result.canAskAgain,
      });
    }
  };

  const addPart = () => {
    if (newPart.trim()) {
      setPartsUsed((prev) => [...prev, newPart.trim()]);
      setNewPart("");
    }
  };

  const removePart = (idx: number) => {
    setPartsUsed((prev) => prev.filter((_, i) => i !== idx));
  };

  // Parts cost is derived from itemized entries (True Net Profit source of truth).
  const partsCost = partsTotalDollars;
  const totalCost = (parseFloat(laborCost) || 0) + partsCost;

  const handleSubmit = () => {
    setError("");
    if (!description.trim()) {
      setError("Please provide a service description.");
      return;
    }
    if (!mileageAtService.trim()) {
      setError("Please enter the vehicle's current mileage.");
      return;
    }
    const mileageNum = parseInt(mileageAtService, 10);
    if (Number.isNaN(mileageNum) || mileageNum < 0) {
      setError("Mileage must be a non-negative whole number.");
      return;
    }
    if (!laborCost) {
      setError("Please enter a labor cost (can be 0).");
      return;
    }
    if (requiresGhost && !matchingBooking) {
      setError("This is a Ghost Garage job — book a bay first, then come back to submit.");
      return;
    }

    // Validate itemized parts — each row must have a name + valid unit price.
    const invalidIdx = partsItems.findIndex((p) => !p.name.trim() || !(parseFloat(p.unitPriceDollars) >= 0));
    if (invalidIdx >= 0) {
      setError(`Parts row ${invalidIdx + 1}: please enter a name and unit price.`);
      return;
    }
    const cleanPartsItems = partsItems.map((p) => ({
      name: p.name.trim(),
      partNumber: p.partNumber.trim() || undefined,
      brand: p.brand.trim() || undefined,
      supplier: p.supplier.trim() || undefined,
      quantity: Math.max(1, parseInt(p.quantity, 10) || 1),
      unitPriceCents: Math.round((parseFloat(p.unitPriceDollars) || 0) * 100),
    }));

    const hoursNum = parseFloat(laborHours);
    const workLogData = {
      jobId: jid,
      serviceCategory: category,
      serviceDescription: description,
      mileageAtService: mileageNum,
      laborCost: parseFloat(laborCost) || 0,
      partsCost,
      partsUsed,
      notes: notes || undefined,
      beforeImages,
      afterImages,
      laborHours: Number.isFinite(hoursNum) && hoursNum >= 0 ? hoursNum : undefined,
      diagnosticCodes: diagnosticCodes.length > 0 ? diagnosticCodes : undefined,
      rootCauseDiagnosis: rootCauseDiagnosis.trim() || undefined,
      repairSteps: repairSteps.trim() || undefined,
      observedSymptoms: observedSymptoms.trim() || undefined,
      recommendedMonitoring: recommendedMonitoring.trim() || undefined,
      recurringIssueTags: recurringIssueTags.length > 0 ? recurringIssueTags : undefined,
      bayBookingId: matchingBooking?.id,
      ...(cleanPartsItems.length > 0 ? { partsItems: cleanPartsItems } : {}),
    };
    createMutation.mutate(
      {
        data: workLogData,
      },
      {
        onSuccess: async () => {
          try { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); } catch { /* web */ }
          await alertMessage("Work Log Submitted", "The job has been marked as completed.");
          router.replace(`/job/${jid}`);
        },
        onError: (e: any) => {
          setError(e?.message ?? "Failed to submit work log.");
        },
      }
    );
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: "Submit Work Log",
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
            <View style={[styles.jobInfo, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.jobVehicle, { color: colors.foreground }]}>
                {job.vehicle?.year} {job.vehicle?.make} {job.vehicle?.model}
              </Text>
              <Text style={[styles.jobDesc, { color: colors.mutedForeground }]} numberOfLines={2}>
                {job.description}
              </Text>
            </View>
          )}

          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>SERVICE CATEGORY</Text>
          <View style={styles.categoryGrid}>
            {SERVICE_CATEGORIES.map((c) => (
              <Pressable
                key={c}
                style={[
                  styles.categoryOption,
                  { backgroundColor: category === c ? colors.primary : colors.card, borderColor: category === c ? colors.primary : colors.border },
                ]}
                onPress={() => setCategory(c)}
              >
                <Text style={[styles.categoryText, { color: category === c ? "white" : colors.foreground }]}>
                  {c.charAt(0).toUpperCase() + c.slice(1)}
                </Text>
              </Pressable>
            ))}
          </View>

          <Text style={[styles.sectionLabel, { color: colors.mutedForeground, marginTop: 16 }]}>SERVICE DESCRIPTION</Text>
          <TextInput
            style={[styles.textarea, { backgroundColor: colors.card, color: colors.foreground, borderColor: colors.border }]}
            placeholder="Describe the work performed..."
            placeholderTextColor={colors.mutedForeground}
            multiline
            numberOfLines={4}
            value={description}
            onChangeText={setDescription}
            textAlignVertical="top"
          />

          <Text style={[styles.sectionLabel, { color: colors.mutedForeground, marginTop: 16 }]}>
            ODOMETER (MILES) *
          </Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.card, color: colors.foreground, borderColor: colors.border }]}
            placeholder="Enter the vehicle's current mileage"
            placeholderTextColor={colors.mutedForeground}
            keyboardType="number-pad"
            value={mileageAtService}
            onChangeText={(t) => setMileageAtService(t.replace(/[^0-9]/g, ""))}
          />

          <Text style={[styles.sectionLabel, { color: colors.mutedForeground, marginTop: 16 }]}>COSTS</Text>
          <View style={styles.costsRow}>
            <View style={styles.costField}>
              <Text style={[styles.costLabel, { color: colors.foreground }]}>Labor ($)</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.card, color: colors.foreground, borderColor: colors.border }]}
                placeholder="0.00"
                placeholderTextColor={colors.mutedForeground}
                keyboardType="decimal-pad"
                value={laborCost}
                onChangeText={setLaborCost}
              />
            </View>
            <View style={styles.costField}>
              <Text style={[styles.costLabel, { color: colors.foreground }]}>Parts ($)</Text>
              <View style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, justifyContent: "center" }]}>
                <Text style={{ color: colors.mutedForeground }}>${partsCost.toFixed(2)} (auto)</Text>
              </View>
            </View>
            <View style={styles.totalBox}>
              <Text style={[styles.costLabel, { color: colors.mutedForeground }]}>Total</Text>
              <Text style={[styles.totalValue, { color: colors.primary }]}>${totalCost.toFixed(2)}</Text>
            </View>
          </View>

          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 16 }}>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>ITEMIZED PARTS (RECEIPT)</Text>
            <Pressable onPress={addPartsItem} style={[styles.addPartBtn, { backgroundColor: colors.primary, paddingHorizontal: 12, height: 32 }]}>
              <Feather name="plus" size={14} color="white" />
              <Text style={{ color: "white", marginLeft: 4, fontWeight: "600" }}>Add</Text>
            </Pressable>
          </View>
          {partsItems.length === 0 && (
            <Text style={{ color: colors.mutedForeground, fontSize: 12, marginTop: 4 }}>
              Add each part you actually purchased — name, supplier, and unit price.
              APS reimburses 100% of these costs to you (excluded from commission).
            </Text>
          )}
          {partsItems.map((p, idx) => {
            const lineTotal = (parseInt(p.quantity, 10) || 0) * (parseFloat(p.unitPriceDollars) || 0);
            return (
              <View key={idx} style={{ marginTop: 8, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card }}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <Text style={{ color: colors.mutedForeground, fontSize: 12, fontWeight: "600" }}>PART #{idx + 1}</Text>
                  <Pressable onPress={() => removePartsItem(idx)}><Feather name="trash-2" size={14} color={colors.mutedForeground} /></Pressable>
                </View>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border, marginTop: 6 }]}
                  placeholder="Part name (e.g. Front brake pads)"
                  placeholderTextColor={colors.mutedForeground}
                  value={p.name} onChangeText={(t) => updatePartsItem(idx, "name", t)}
                />
                <View style={{ flexDirection: "row", gap: 6, marginTop: 6 }}>
                  <TextInput
                    style={[styles.input, { flex: 1, backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
                    placeholder="Brand" placeholderTextColor={colors.mutedForeground}
                    value={p.brand} onChangeText={(t) => updatePartsItem(idx, "brand", t)}
                  />
                  <TextInput
                    style={[styles.input, { flex: 1, backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
                    placeholder="Part #" placeholderTextColor={colors.mutedForeground}
                    value={p.partNumber} onChangeText={(t) => updatePartsItem(idx, "partNumber", t)}
                  />
                </View>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border, marginTop: 6 }]}
                  placeholder="Supplier (e.g. NAPA, AutoZone)" placeholderTextColor={colors.mutedForeground}
                  value={p.supplier} onChangeText={(t) => updatePartsItem(idx, "supplier", t)}
                />
                <View style={{ flexDirection: "row", gap: 6, marginTop: 6, alignItems: "center" }}>
                  <View style={{ width: 70 }}>
                    <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>Qty</Text>
                    <TextInput
                      style={[styles.input, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
                      keyboardType="number-pad" value={p.quantity}
                      onChangeText={(t) => updatePartsItem(idx, "quantity", t.replace(/[^0-9]/g, ""))}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>Unit price ($)</Text>
                    <TextInput
                      style={[styles.input, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
                      keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={colors.mutedForeground}
                      value={p.unitPriceDollars}
                      onChangeText={(t) => updatePartsItem(idx, "unitPriceDollars", t)}
                    />
                  </View>
                  <View style={{ width: 90, alignItems: "flex-end" }}>
                    <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>Line total</Text>
                    <Text style={{ color: colors.primary, fontWeight: "700", fontSize: 16 }}>${lineTotal.toFixed(2)}</Text>
                  </View>
                </View>
              </View>
            );
          })}

          <Text style={[styles.sectionLabel, { color: colors.mutedForeground, marginTop: 16 }]}>PARTS USED</Text>
          <View style={styles.partsInput}>
            <TextInput
              style={[styles.input, { flex: 1, backgroundColor: colors.card, color: colors.foreground, borderColor: colors.border }]}
              placeholder="Part name or number"
              placeholderTextColor={colors.mutedForeground}
              value={newPart}
              onChangeText={setNewPart}
              onSubmitEditing={addPart}
              returnKeyType="done"
            />
            <Pressable style={[styles.addPartBtn, { backgroundColor: colors.primary }]} onPress={addPart}>
              <Feather name="plus" size={18} color="white" />
            </Pressable>
          </View>
          {partsUsed.length > 0 && (
            <View style={styles.partsList}>
              {partsUsed.map((p, i) => (
                <View key={i} style={[styles.partTag, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
                  <Text style={[styles.partTagText, { color: colors.secondaryForeground }]}>{p}</Text>
                  <Pressable onPress={() => removePart(i)}>
                    <Feather name="x" size={14} color={colors.mutedForeground} />
                  </Pressable>
                </View>
              ))}
            </View>
          )}

          <Text style={[styles.sectionLabel, { color: colors.mutedForeground, marginTop: 16 }]}>NOTES (OPTIONAL)</Text>
          <TextInput
            style={[styles.textarea, { backgroundColor: colors.card, color: colors.foreground, borderColor: colors.border, minHeight: 80 }]}
            placeholder="Additional notes for the customer..."
            placeholderTextColor={colors.mutedForeground}
            multiline
            value={notes}
            onChangeText={setNotes}
            textAlignVertical="top"
          />

          <Text style={[styles.sectionLabel, { color: colors.mutedForeground, marginTop: 16 }]}>PHOTOS</Text>
          <View style={styles.photosRow}>
            <Pressable
              style={[styles.photoPickerBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={() => pickImages(setBeforeImages)}
            >
              <Feather name="camera" size={20} color={colors.mutedForeground} />
              <Text style={[styles.photoPickerText, { color: colors.mutedForeground }]}>
                Before ({beforeImages.length})
              </Text>
            </Pressable>
            <Pressable
              style={[styles.photoPickerBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={() => pickImages(setAfterImages)}
            >
              <Feather name="image" size={20} color={colors.mutedForeground} />
              <Text style={[styles.photoPickerText, { color: colors.mutedForeground }]}>
                After ({afterImages.length})
              </Text>
            </Pressable>
          </View>
          {photoError ? (
            <CapabilityNotice
              message={photoError.message}
              canOpenSettings={!photoError.canAskAgain}
              onOpenSettings={() => {
                void openAppSettings();
              }}
            />
          ) : null}
          {afterImages.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.imagePreview}>
              {afterImages.map((uri, i) => (
                <Image key={i} source={{ uri }} style={styles.previewImage} />
              ))}
            </ScrollView>
          )}

          {requiresGhost && (
            <View style={[styles.ghostBanner, {
              backgroundColor: matchingBooking ? colors.primary + "14" : colors.destructive + "14",
              borderColor: matchingBooking ? colors.primary + "44" : colors.destructive + "44",
            }]}>
              <Feather
                name={matchingBooking ? "check-circle" : "alert-triangle"}
                size={16}
                color={matchingBooking ? colors.primary : colors.destructive}
              />
              <Text style={{ flex: 1, fontSize: 12, fontWeight: "600",
                color: matchingBooking ? colors.primary : colors.destructive,
              }}>
                {matchingBooking
                  ? `Linked to bay booking #${matchingBooking.id}`
                  : "Ghost Garage job — book a bay first."}
              </Text>
            </View>
          )}

          <Text style={[styles.sectionLabel, { color: colors.mutedForeground, marginTop: 16 }]}>LABOR HOURS</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.card, color: colors.foreground, borderColor: colors.border }]}
            placeholder="2.5"
            placeholderTextColor={colors.mutedForeground}
            keyboardType="decimal-pad"
            value={laborHours}
            onChangeText={setLaborHours}
          />

          <Text style={[styles.sectionLabel, { color: colors.mutedForeground, marginTop: 16 }]}>OBD-II / DIAGNOSTIC CODES</Text>
          <View style={styles.partsInput}>
            <TextInput
              style={[styles.input, { flex: 1, backgroundColor: colors.card, color: colors.foreground, borderColor: colors.border }]}
              placeholder="P0420, U0100, etc."
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="characters"
              value={newDtc}
              onChangeText={setNewDtc}
              onSubmitEditing={addDtc}
              returnKeyType="done"
            />
            <Pressable style={[styles.addPartBtn, { backgroundColor: colors.primary }]} onPress={addDtc}>
              <Feather name="plus" size={18} color="white" />
            </Pressable>
          </View>
          {diagnosticCodes.length > 0 && (
            <View style={styles.partsList}>
              {diagnosticCodes.map((c, i) => (
                <View key={i} style={[styles.partTag, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
                  <Text style={[styles.partTagText, { color: colors.secondaryForeground, fontFamily: "monospace" }]}>{c}</Text>
                  <Pressable onPress={() => removeDtc(i)}>
                    <Feather name="x" size={14} color={colors.mutedForeground} />
                  </Pressable>
                </View>
              ))}
            </View>
          )}

          <Text style={[styles.sectionLabel, { color: colors.mutedForeground, marginTop: 16 }]}>OBSERVED SYMPTOMS</Text>
          <TextInput
            style={[styles.textarea, { backgroundColor: colors.card, color: colors.foreground, borderColor: colors.border, minHeight: 70 }]}
            placeholder="What the customer/mechanic noticed (rough idle, intermittent stall…)"
            placeholderTextColor={colors.mutedForeground}
            multiline
            value={observedSymptoms}
            onChangeText={setObservedSymptoms}
            textAlignVertical="top"
          />

          <Text style={[styles.sectionLabel, { color: colors.mutedForeground, marginTop: 16 }]}>ROOT CAUSE</Text>
          <TextInput
            style={[styles.textarea, { backgroundColor: colors.card, color: colors.foreground, borderColor: colors.border, minHeight: 70 }]}
            placeholder="What actually caused the failure."
            placeholderTextColor={colors.mutedForeground}
            multiline
            value={rootCauseDiagnosis}
            onChangeText={setRootCauseDiagnosis}
            textAlignVertical="top"
          />

          <Text style={[styles.sectionLabel, { color: colors.mutedForeground, marginTop: 16 }]}>REPAIR STEPS</Text>
          <TextInput
            style={[styles.textarea, { backgroundColor: colors.card, color: colors.foreground, borderColor: colors.border, minHeight: 70 }]}
            placeholder="Step-by-step what was performed."
            placeholderTextColor={colors.mutedForeground}
            multiline
            value={repairSteps}
            onChangeText={setRepairSteps}
            textAlignVertical="top"
          />

          <Text style={[styles.sectionLabel, { color: colors.mutedForeground, marginTop: 16 }]}>RECOMMENDED MONITORING</Text>
          <TextInput
            style={[styles.textarea, { backgroundColor: colors.card, color: colors.foreground, borderColor: colors.border, minHeight: 70 }]}
            placeholder="Re-check at next service / watch for…"
            placeholderTextColor={colors.mutedForeground}
            multiline
            value={recommendedMonitoring}
            onChangeText={setRecommendedMonitoring}
            textAlignVertical="top"
          />

          <Text style={[styles.sectionLabel, { color: colors.mutedForeground, marginTop: 16 }]}>RECURRING ISSUE TAGS</Text>
          <View style={styles.partsInput}>
            <TextInput
              style={[styles.input, { flex: 1, backgroundColor: colors.card, color: colors.foreground, borderColor: colors.border }]}
              placeholder="intermittent, post-storm, recall-likely…"
              placeholderTextColor={colors.mutedForeground}
              value={newTag}
              onChangeText={setNewTag}
              onSubmitEditing={addTag}
              returnKeyType="done"
            />
            <Pressable style={[styles.addPartBtn, { backgroundColor: colors.primary }]} onPress={addTag}>
              <Feather name="plus" size={18} color="white" />
            </Pressable>
          </View>
          {recurringIssueTags.length > 0 && (
            <View style={styles.partsList}>
              {recurringIssueTags.map((t, i) => (
                <View key={i} style={[styles.partTag, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
                  <Text style={[styles.partTagText, { color: colors.secondaryForeground }]}>#{t}</Text>
                  <Pressable onPress={() => removeTag(i)}>
                    <Feather name="x" size={14} color={colors.mutedForeground} />
                  </Pressable>
                </View>
              ))}
            </View>
          )}

          {error ? <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}

          <Pressable
            style={[styles.submitBtn, { backgroundColor: colors.primary }, createMutation.isPending && { opacity: 0.6 }]}
            onPress={handleSubmit}
            disabled={createMutation.isPending}
          >
            {createMutation.isPending
              ? <ActivityIndicator color="white" />
              : <Text style={styles.submitText}>Submit Work Log</Text>}
          </Pressable>
        </KeyboardAwareScrollViewCompat>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  jobInfo: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginBottom: 20,
    gap: 4,
  },
  jobVehicle: { fontSize: 16, fontWeight: "700" },
  jobDesc: { fontSize: 13, lineHeight: 18 },
  sectionLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 1, marginBottom: 8 },
  categoryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  categoryOption: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1.5,
  },
  categoryText: { fontSize: 13, fontWeight: "600" },
  textarea: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    fontSize: 15,
    minHeight: 100,
  },
  costsRow: { flexDirection: "row", gap: 10, alignItems: "flex-end" },
  costField: { flex: 1 },
  costLabel: { fontSize: 12, fontWeight: "600", marginBottom: 6 },
  input: {
    height: 48,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 15,
  },
  totalBox: { paddingBottom: 12, alignItems: "center" },
  totalValue: { fontSize: 20, fontWeight: "800" },
  partsInput: { flexDirection: "row", gap: 8 },
  addPartBtn: {
    width: 48,
    height: 48,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  partsList: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  partTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  partTagText: { fontSize: 13, fontWeight: "500" },
  photosRow: { flexDirection: "row", gap: 10 },
  photoPickerBtn: {
    flex: 1,
    height: 72,
    borderWidth: 1,
    borderRadius: 12,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  photoPickerText: { fontSize: 13, fontWeight: "500" },
  imagePreview: { marginTop: 10 },
  previewImage: { width: 80, height: 80, borderRadius: 8, marginRight: 8 },
  ghostBanner: {
    flexDirection: "row", alignItems: "center", gap: 8,
    padding: 10, borderRadius: 10, borderWidth: 1, marginTop: 12,
  },
  error: { fontSize: 14, marginTop: 8 },
  submitBtn: {
    height: 56,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 20,
  },
  submitText: { color: "white", fontWeight: "700", fontSize: 17 },
});
