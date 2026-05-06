import {
  View, Text, StyleSheet, Pressable, ActivityIndicator,
  TextInput, Image, ScrollView,
} from "react-native";
import { alertMessage } from "@/utils/confirm";
import { useColors } from "@/hooks/useColors";
import { useGetJob, useCreateWorkLog } from "@workspace/api-client-react";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { useState } from "react";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";

const SERVICE_CATEGORIES = ["repair", "diagnostic", "maintenance", "detailing"] as const;

export default function WorkLogScreen() {
  const colors = useColors();
  const router = useRouter();
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const jid = parseInt(jobId, 10);

  const { data: job } = useGetJob(jid);
  const createMutation = useCreateWorkLog();

  const [category, setCategory] = useState<string>("repair");
  const [description, setDescription] = useState("");
  const [mileageAtService, setMileageAtService] = useState("");
  const [laborCost, setLaborCost] = useState("");
  const [partsCost, setPartsCost] = useState("");
  const [partsUsed, setPartsUsed] = useState<string[]>([]);
  const [newPart, setNewPart] = useState("");
  const [notes, setNotes] = useState("");
  const [beforeImages, setBeforeImages] = useState<string[]>([]);
  const [afterImages, setAfterImages] = useState<string[]>([]);
  const [error, setError] = useState("");

  const pickImages = async (setter: (imgs: string[]) => void) => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      quality: 0.8,
    });
    if (!result.canceled) {
      setter(result.assets.map((a) => a.uri));
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

  const totalCost = (parseFloat(laborCost) || 0) + (parseFloat(partsCost) || 0);

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

    createMutation.mutate(
      {
        data: {
          jobId: jid,
          serviceCategory: category as "repair" | "diagnostic" | "maintenance" | "detailing",
          serviceDescription: description,
          mileageAtService: mileageNum,
          laborCost: parseFloat(laborCost) || 0,
          partsCost: parseFloat(partsCost) || 0,
          partsUsed,
          notes: notes || undefined,
          beforeImages,
          afterImages,
        },
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
              <TextInput
                style={[styles.input, { backgroundColor: colors.card, color: colors.foreground, borderColor: colors.border }]}
                placeholder="0.00"
                placeholderTextColor={colors.mutedForeground}
                keyboardType="decimal-pad"
                value={partsCost}
                onChangeText={setPartsCost}
              />
            </View>
            <View style={styles.totalBox}>
              <Text style={[styles.costLabel, { color: colors.mutedForeground }]}>Total</Text>
              <Text style={[styles.totalValue, { color: colors.primary }]}>${totalCost.toFixed(2)}</Text>
            </View>
          </View>

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
          {afterImages.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.imagePreview}>
              {afterImages.map((uri, i) => (
                <Image key={i} source={{ uri }} style={styles.previewImage} />
              ))}
            </ScrollView>
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
