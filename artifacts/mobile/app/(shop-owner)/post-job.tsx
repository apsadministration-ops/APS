import React, { useMemo, useState } from "react";
import { ScrollView, View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, Platform, Alert } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { useListMyShops, useCreatePartnerJob, getListMyShopsQueryKey } from "@workspace/api-client-react";

type Urgency = "urgent" | "high" | "normal" | "low";

const URGENCY_OPTIONS: { value: Urgency; label: string; window: string; color: string }[] = [
  { value: "urgent", label: "Urgent",  window: "All qualified mechanics see immediately", color: "#DC2626" },
  { value: "high",   label: "High",    window: "Senior+ see now · Junior tiers wait 15m", color: "#F59E0B" },
  { value: "normal", label: "Normal",  window: "Senior+ see now · Junior tiers wait 1h",  color: "#3B82F6" },
  { value: "low",    label: "Low",     window: "Senior+ see now · Junior tiers wait 4h",  color: "#6B7280" },
];

export default function PostJobScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const colors = useColors();
  const enabled = !!user && user.role === "shop_owner";
  const { data: shops, isLoading } = useListMyShops({ query: { enabled, queryKey: getListMyShopsQueryKey() } });
  const createMutation = useCreatePartnerJob();

  const eligibleShops = useMemo(
    () => (shops ?? []).filter((s: any) => s.partnerKind === "dealership" || s.partnerKind === "fleet"),
    [shops],
  );

  const [shopId, setShopId] = useState<number | null>(null);
  const [vehicleId, setVehicleId] = useState("");
  const [serviceSlug, setServiceSlug] = useState("");
  const [description, setDescription] = useState("");
  const [urgency, setUrgency] = useState<Urgency>("normal");
  const [error, setError] = useState("");

  React.useEffect(() => {
    if (shopId == null && eligibleShops.length > 0) setShopId(eligibleShops[0].id);
  }, [eligibleShops, shopId]);

  const alertMsg = (title: string, msg: string) => {
    if (Platform.OS === "web") window.alert(`${title}\n\n${msg}`);
    else Alert.alert(title, msg);
  };

  const submit = () => {
    setError("");
    if (!shopId) { setError("Pick a partner location."); return; }
    const vid = parseInt(vehicleId.trim(), 10);
    if (!Number.isFinite(vid) || vid <= 0) { setError("Enter a valid vehicle ID."); return; }
    if (description.trim().length < 5) { setError("Describe the work (at least 5 chars)."); return; }
    createMutation.mutate(
      {
        data: {
          shopId,
          vehicleId: vid,
          serviceSlug: serviceSlug.trim() || undefined,
          description: description.trim(),
          urgency,
        },
      },
      {
        onSuccess: (r) => {
          alertMsg("Job posted", `Job #${r.jobId} is now visible to ${urgency === "urgent" ? "all" : "senior+"} mechanics.`);
          setVehicleId(""); setServiceSlug(""); setDescription(""); setUrgency("normal");
          router.push(`/job/${r.jobId}` as any);
        },
        onError: (e: any) => setError(e?.message ?? "Failed to post job."),
      },
    );
  };

  if (isLoading) {
    return <View style={[styles.center, { backgroundColor: colors.background }]}><ActivityIndicator color={colors.primary} /></View>;
  }
  if (eligibleShops.length === 0) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background, padding: 24 }]}>
        <Feather name="alert-circle" size={42} color={colors.mutedForeground} />
        <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No eligible partner locations</Text>
        <Text style={[styles.emptyDesc, { color: colors.mutedForeground }]}>
          Posting jobs is available to Dealership and Fleet partners only. Independent shops rent bays via Bookings.
        </Text>
        <Pressable
          style={[styles.cta, { backgroundColor: colors.primary }]}
          onPress={() => router.push("/(shop-owner)" as any)}
        >
          <Text style={[styles.ctaText, { color: colors.primaryForeground }]}>Add a Dealership or Fleet</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: 16, paddingBottom: 120, gap: 12 }}
    >
      <Text style={[styles.heading, { color: colors.foreground }]}>Post a Job</Text>
      <Text style={[styles.sub, { color: colors.mutedForeground }]}>
        Fleet & dealership overflow work — flat 15% platform fee, priority dispatch to higher-tier mechanics.
      </Text>

      <Text style={[styles.label, { color: colors.mutedForeground }]}>PARTNER LOCATION *</Text>
      <View style={{ gap: 8 }}>
        {eligibleShops.map((s: any) => {
          const selected = shopId === s.id;
          return (
            <Pressable
              key={s.id}
              onPress={() => setShopId(s.id)}
              style={[
                styles.shopRow,
                {
                  backgroundColor: selected ? colors.primary + "14" : colors.card,
                  borderColor: selected ? colors.primary : colors.border,
                },
              ]}
            >
              <Feather
                name={s.partnerKind === "fleet" ? "truck" : "award"}
                size={20}
                color={selected ? colors.primary : colors.mutedForeground}
              />
              <View style={{ flex: 1 }}>
                <Text style={[styles.shopName, { color: selected ? colors.primary : colors.foreground }]}>{s.name}</Text>
                <Text style={[styles.shopKind, { color: colors.mutedForeground }]}>
                  {s.partnerKind === "fleet" ? "Fleet" : "Dealership"} · {s.city}, {s.region}
                </Text>
              </View>
              {selected && <Feather name="check-circle" size={18} color={colors.primary} />}
            </Pressable>
          );
        })}
      </View>

      <Text style={[styles.label, { color: colors.mutedForeground }]}>VEHICLE ID *</Text>
      <TextInput
        style={[styles.input, { backgroundColor: colors.card, color: colors.cardForeground, borderColor: colors.border }]}
        placeholder="e.g. 142"
        placeholderTextColor={colors.mutedForeground}
        keyboardType="number-pad"
        value={vehicleId}
        onChangeText={setVehicleId}
      />
      <Text style={[styles.help, { color: colors.mutedForeground }]}>
        Register fleet vehicles via Vehicles first. Each gets its own ID.
      </Text>

      <Text style={[styles.label, { color: colors.mutedForeground }]}>SERVICE SLUG (optional)</Text>
      <TextInput
        style={[styles.input, { backgroundColor: colors.card, color: colors.cardForeground, borderColor: colors.border }]}
        placeholder="e.g. oil_change_full_synthetic"
        placeholderTextColor={colors.mutedForeground}
        autoCapitalize="none"
        value={serviceSlug}
        onChangeText={setServiceSlug}
      />

      <Text style={[styles.label, { color: colors.mutedForeground }]}>DESCRIPTION *</Text>
      <TextInput
        style={[styles.input, styles.textarea, { backgroundColor: colors.card, color: colors.cardForeground, borderColor: colors.border }]}
        placeholder="Describe the work needed…"
        placeholderTextColor={colors.mutedForeground}
        value={description}
        onChangeText={setDescription}
        multiline
        textAlignVertical="top"
      />

      <Text style={[styles.label, { color: colors.mutedForeground }]}>URGENCY</Text>
      <View style={{ gap: 8 }}>
        {URGENCY_OPTIONS.map((u) => {
          const selected = urgency === u.value;
          return (
            <Pressable
              key={u.value}
              onPress={() => setUrgency(u.value)}
              style={[
                styles.urgRow,
                {
                  backgroundColor: selected ? u.color + "1A" : colors.card,
                  borderColor: selected ? u.color : colors.border,
                },
              ]}
            >
              <View style={[styles.urgDot, { backgroundColor: u.color }]} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.urgLabel, { color: selected ? u.color : colors.foreground }]}>{u.label}</Text>
                <Text style={[styles.urgWin, { color: colors.mutedForeground }]}>{u.window}</Text>
              </View>
              {selected && <Feather name="check" size={18} color={u.color} />}
            </Pressable>
          );
        })}
      </View>

      {!!error && (
        <View style={[styles.errBox, { backgroundColor: "#FEE2E2", borderColor: "#DC2626" }]}>
          <Text style={{ color: "#991B1B", fontSize: 13 }}>{error}</Text>
        </View>
      )}

      <Pressable
        style={[styles.submit, { backgroundColor: colors.primary, opacity: createMutation.isPending ? 0.6 : 1 }]}
        disabled={createMutation.isPending}
        onPress={submit}
      >
        {createMutation.isPending
          ? <ActivityIndicator color={colors.primaryForeground} />
          : <Text style={[styles.submitText, { color: colors.primaryForeground }]}>Post Job</Text>}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8 },
  heading: { fontSize: 22, fontWeight: "800" },
  sub: { fontSize: 13, lineHeight: 18 },
  emptyTitle: { fontSize: 18, fontWeight: "700", marginTop: 12, textAlign: "center" },
  emptyDesc: { fontSize: 13, marginTop: 6, textAlign: "center", lineHeight: 18 },
  cta: { marginTop: 16, paddingHorizontal: 18, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  ctaText: { fontWeight: "700", fontSize: 14 },
  label: { fontSize: 11, fontWeight: "700", letterSpacing: 1, marginTop: 6 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, height: 44, fontSize: 14 },
  textarea: { height: 110, paddingVertical: 10 },
  help: { fontSize: 11, marginTop: -2 },
  shopRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 12, borderWidth: 1 },
  shopName: { fontSize: 14, fontWeight: "700" },
  shopKind: { fontSize: 12, marginTop: 2 },
  urgRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 12, borderWidth: 1 },
  urgDot: { width: 10, height: 10, borderRadius: 5 },
  urgLabel: { fontSize: 14, fontWeight: "700" },
  urgWin: { fontSize: 12, marginTop: 2 },
  errBox: { padding: 12, borderRadius: 10, borderWidth: 1, marginTop: 4 },
  submit: { height: 50, borderRadius: 14, alignItems: "center", justifyContent: "center", marginTop: 12 },
  submitText: { fontSize: 16, fontWeight: "800" },
});
