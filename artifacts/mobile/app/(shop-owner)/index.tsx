import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator,
  TextInput, RefreshControl,
} from "react-native";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { useListMyShops, useCreateShop, getListMyShopsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useState } from "react";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { alertMessage } from "@/utils/confirm";

export default function ShopsListScreen() {
  const colors = useColors();
  const router = useRouter();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const enabled = !!user && user.role === "shop_owner";

  const { data: shops, isLoading, refetch, isRefetching } = useListMyShops({
    query: { enabled, queryKey: getListMyShopsQueryKey() },
  });
  const createMutation = useCreateShop();

  type PartnerKind = "independent_shop" | "dealership" | "fleet" | "gsa";
  const PARTNER_KINDS: { value: PartnerKind; label: string; icon: keyof typeof Feather.glyphMap; desc: string }[] = [
    { value: "independent_shop", label: "Independent Shop", icon: "tool",  desc: "Rent out bays and lifts to mechanics by the hour or day." },
    { value: "dealership",       label: "Dealership",       icon: "award", desc: "Service department posting overflow jobs to qualified mechanics." },
    { value: "fleet",            label: "Fleet",            icon: "truck", desc: "Corporate, rental, or trucking — VIN-based service history across your fleet." },
    { value: "gsa",              label: "Government / GSA", icon: "shield", desc: "U.S. Government, GSA, and public-sector fleets — flat 10% commission." },
  ];

  const [showForm, setShowForm] = useState(false);
  const [partnerKind, setPartnerKind] = useState<PartnerKind>("independent_shop");
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [region, setRegion] = useState("");
  const [zipCode, setZipCode] = useState("");
  const [phone, setPhone] = useState("");
  const [federalEin, setFederalEin] = useState("");
  const [businessLicense, setBusinessLicense] = useState("");
  const [error, setError] = useState("");

  const submit = () => {
    setError("");
    if (!name.trim() || !address.trim() || !city.trim() || !region.trim() || !zipCode.trim()) {
      setError("Name, street, city, state, and ZIP are all required.");
      return;
    }
    createMutation.mutate(
      {
        data: {
          partnerKind,
          name: name.trim(),
          address: address.trim(),
          city: city.trim(),
          region: region.trim(),
          zipCode: zipCode.trim(),
          phone: phone.trim() || undefined,
          federalEin: federalEin.trim() || undefined,
          businessLicense: businessLicense.trim() || undefined,
        },
      },
      {
        onSuccess: () => {
          setShowForm(false);
          setPartnerKind("independent_shop");
          setName(""); setAddress(""); setCity(""); setRegion(""); setZipCode("");
          setPhone(""); setFederalEin(""); setBusinessLicense("");
          queryClient.invalidateQueries({ queryKey: getListMyShopsQueryKey() });
          void alertMessage("Partner location created", "You can now configure bays, jobs, or fleet vehicles inside this location.");
        },
        onError: (e: any) => setError(e?.message ?? "Failed to create partner location."),
      },
    );
  };

  const kindLabel = (k: string | null | undefined) =>
    k === "dealership" ? "Dealership" :
    k === "fleet" ? "Fleet" :
    k === "gsa" ? "Government / GSA" : "Independent Shop";
  const kindIcon = (k: string | null | undefined): keyof typeof Feather.glyphMap =>
    k === "dealership" ? "award" :
    k === "fleet" ? "truck" :
    k === "gsa" ? "shield" : "tool";

  if (isLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <KeyboardAwareScrollViewCompat
        contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
        bottomOffset={20}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
      >
        <Text style={[styles.heading, { color: colors.foreground }]}>Fleet & Commercial Partners</Text>
        <Text style={[styles.sub, { color: colors.mutedForeground }]}>
          Manage your independent shops, dealership service departments, and fleets. One owner, multiple locations.
        </Text>

        {(shops ?? []).length === 0 ? (
          <View style={[styles.empty, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="home" size={42} color={colors.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No locations yet</Text>
            <Text style={[styles.emptyDesc, { color: colors.mutedForeground }]}>
              Add your first location — shop, dealership, or fleet — to get started.
            </Text>
          </View>
        ) : (
          <View style={{ gap: 10, marginTop: 8 }}>
            {(shops ?? []).map((s) => {
              const k = (s as any).partnerKind as string | undefined;
              return (
                <Pressable
                  key={s.id}
                  style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
                  onPress={() => router.push(`/shop/${s.id}`)}
                >
                  <View style={[styles.kindBadge, { backgroundColor: colors.primary + "18" }]}>
                    <Feather name={kindIcon(k)} size={18} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.cardTitle, { color: colors.foreground }]}>{s.name}</Text>
                    <Text style={[styles.kindPill, { color: colors.primary }]}>{kindLabel(k)}</Text>
                    <Text style={[styles.cardSub, { color: colors.mutedForeground }]} numberOfLines={2}>
                      {s.address}, {s.city}, {s.region} {s.zipCode}
                    </Text>
                    <View style={styles.statusRow}>
                      <View style={[styles.statusDot, { backgroundColor: s.status === "active" ? "#22C55E" : "#F59E0B" }]} />
                      <Text style={[styles.statusText, { color: colors.mutedForeground }]}>{s.status}</Text>
                    </View>
                  </View>
                  <Feather name="chevron-right" size={22} color={colors.mutedForeground} />
                </Pressable>
              );
            })}
          </View>
        )}

        <Pressable
          style={[styles.toggleBtn, { borderColor: colors.primary, backgroundColor: showForm ? colors.card : colors.primary + "12" }]}
          onPress={() => setShowForm((v) => !v)}
        >
          <Feather name={showForm ? "x" : "plus"} size={18} color={colors.primary} />
          <Text style={[styles.toggleBtnText, { color: colors.primary }]}>
            {showForm ? "Cancel" : "Add a Location"}
          </Text>
        </Pressable>

        {showForm && (
          <View style={[styles.formCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.formTitle, { color: colors.foreground }]}>New Partner Location</Text>

            <Text style={[styles.label, { color: colors.mutedForeground }]}>PARTNER TYPE *</Text>
            <View style={{ gap: 8 }}>
              {PARTNER_KINDS.map((k) => {
                const selected = partnerKind === k.value;
                return (
                  <Pressable
                    key={k.value}
                    onPress={() => setPartnerKind(k.value)}
                    style={[
                      styles.kindRow,
                      {
                        backgroundColor: selected ? colors.primary + "14" : colors.background,
                        borderColor: selected ? colors.primary : colors.border,
                      },
                    ]}
                  >
                    <Feather name={k.icon} size={20} color={selected ? colors.primary : colors.mutedForeground} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.kindRowLabel, { color: selected ? colors.primary : colors.foreground }]}>{k.label}</Text>
                      <Text style={[styles.kindRowDesc, { color: colors.mutedForeground }]}>{k.desc}</Text>
                    </View>
                    {selected && <Feather name="check-circle" size={18} color={colors.primary} />}
                  </Pressable>
                );
              })}
            </View>

            <Text style={[styles.label, { color: colors.mutedForeground }]}>NAME *</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
              placeholder="Northside Auto"
              placeholderTextColor={colors.mutedForeground}
              value={name}
              onChangeText={setName}
            />

            <Text style={[styles.label, { color: colors.mutedForeground }]}>STREET ADDRESS *</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
              placeholder="123 Garage Way"
              placeholderTextColor={colors.mutedForeground}
              value={address}
              onChangeText={setAddress}
            />

            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ flex: 2 }}>
                <Text style={[styles.label, { color: colors.mutedForeground }]}>CITY *</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
                  placeholder="Austin"
                  placeholderTextColor={colors.mutedForeground}
                  value={city}
                  onChangeText={setCity}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.label, { color: colors.mutedForeground }]}>STATE *</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
                  placeholder="TX"
                  placeholderTextColor={colors.mutedForeground}
                  autoCapitalize="characters"
                  value={region}
                  onChangeText={setRegion}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.label, { color: colors.mutedForeground }]}>ZIP *</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
                  placeholder="78701"
                  placeholderTextColor={colors.mutedForeground}
                  value={zipCode}
                  onChangeText={setZipCode}
                />
              </View>
            </View>

            <Text style={[styles.label, { color: colors.mutedForeground }]}>PHONE</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
              placeholder="(555) 555-1234"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="phone-pad"
              value={phone}
              onChangeText={setPhone}
            />

            <Text style={[styles.label, { color: colors.mutedForeground }]}>FEDERAL EIN / TAX ID</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
              placeholder="12-3456789"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="characters"
              value={federalEin}
              onChangeText={setFederalEin}
            />

            <Text style={[styles.label, { color: colors.mutedForeground }]}>BUSINESS LICENSE NUMBER</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
              placeholder="BL-2024-00123"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="characters"
              value={businessLicense}
              onChangeText={setBusinessLicense}
            />

            {error ? <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}

            <Pressable
              style={[styles.submitBtn, { backgroundColor: colors.primary }, createMutation.isPending && { opacity: 0.6 }]}
              onPress={submit}
              disabled={createMutation.isPending}
            >
              {createMutation.isPending
                ? <ActivityIndicator color="white" />
                : <Text style={styles.submitText}>Create Shop</Text>}
            </Pressable>
          </View>
        )}
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  heading: { fontSize: 22, fontWeight: "800" },
  sub: { fontSize: 13, marginTop: 4, marginBottom: 12, lineHeight: 18 },
  empty: { padding: 28, alignItems: "center", borderWidth: 1, borderStyle: "dashed", borderRadius: 14, marginTop: 12 },
  emptyTitle: { fontSize: 16, fontWeight: "700", marginTop: 12 },
  emptyDesc: { fontSize: 13, marginTop: 4, textAlign: "center" },
  card: {
    flexDirection: "row", alignItems: "center", gap: 12,
    padding: 14, borderRadius: 14, borderWidth: 1,
  },
  cardTitle: { fontSize: 16, fontWeight: "700" },
  cardSub: { fontSize: 13, marginTop: 2 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 12, fontWeight: "600", textTransform: "capitalize" },
  kindBadge: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  kindPill: { fontSize: 11, fontWeight: "800", letterSpacing: 0.6, marginTop: 2, textTransform: "uppercase" },
  kindRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    padding: 12, borderRadius: 12, borderWidth: 1,
  },
  kindRowLabel: { fontSize: 14, fontWeight: "700" },
  kindRowDesc: { fontSize: 12, marginTop: 2, lineHeight: 16 },
  toggleBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, height: 48, borderRadius: 12, borderWidth: 1, marginTop: 16,
  },
  toggleBtnText: { fontSize: 15, fontWeight: "700" },
  formCard: { borderWidth: 1, borderRadius: 14, padding: 16, marginTop: 12, gap: 8 },
  formTitle: { fontSize: 17, fontWeight: "700", marginBottom: 4 },
  label: { fontSize: 11, fontWeight: "700", letterSpacing: 1, marginTop: 8, marginBottom: 4 },
  input: { height: 46, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, fontSize: 15 },
  error: { fontSize: 14, marginTop: 8 },
  submitBtn: { height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center", marginTop: 12 },
  submitText: { color: "white", fontWeight: "700", fontSize: 16 },
});
