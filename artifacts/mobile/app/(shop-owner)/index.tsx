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

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [region, setRegion] = useState("");
  const [zipCode, setZipCode] = useState("");
  const [phone, setPhone] = useState("");
  const [insuranceCarrier, setInsuranceCarrier] = useState("");
  const [insurancePolicy, setInsurancePolicy] = useState("");
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
          name: name.trim(),
          address: address.trim(),
          city: city.trim(),
          region: region.trim(),
          zipCode: zipCode.trim(),
          phone: phone.trim() || undefined,
          insuranceCarrier: insuranceCarrier.trim() || undefined,
          insurancePolicyNumber: insurancePolicy.trim() || undefined,
        },
      },
      {
        onSuccess: () => {
          setShowForm(false);
          setName(""); setAddress(""); setCity(""); setRegion(""); setZipCode("");
          setPhone(""); setInsuranceCarrier(""); setInsurancePolicy("");
          queryClient.invalidateQueries({ queryKey: getListMyShopsQueryKey() });
          void alertMessage("Shop created", "You can now add bays inside this shop.");
        },
        onError: (e: any) => setError(e?.message ?? "Failed to create shop."),
      },
    );
  };

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
        <Text style={[styles.heading, { color: colors.foreground }]}>Your Shops</Text>
        <Text style={[styles.sub, { color: colors.mutedForeground }]}>
          Each shop hosts one or more service bays that mechanics can rent for ghost-garage jobs.
        </Text>

        {(shops ?? []).length === 0 ? (
          <View style={[styles.empty, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="home" size={42} color={colors.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No shops yet</Text>
            <Text style={[styles.emptyDesc, { color: colors.mutedForeground }]}>
              Add your first shop to start renting out bays.
            </Text>
          </View>
        ) : (
          <View style={{ gap: 10, marginTop: 8 }}>
            {(shops ?? []).map((s) => (
              <Pressable
                key={s.id}
                style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
                onPress={() => router.push(`/shop/${s.id}`)}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.cardTitle, { color: colors.foreground }]}>{s.name}</Text>
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
            ))}
          </View>
        )}

        <Pressable
          style={[styles.toggleBtn, { borderColor: colors.primary, backgroundColor: showForm ? colors.card : colors.primary + "12" }]}
          onPress={() => setShowForm((v) => !v)}
        >
          <Feather name={showForm ? "x" : "plus"} size={18} color={colors.primary} />
          <Text style={[styles.toggleBtnText, { color: colors.primary }]}>
            {showForm ? "Cancel" : "Add a Shop"}
          </Text>
        </Pressable>

        {showForm && (
          <View style={[styles.formCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.formTitle, { color: colors.foreground }]}>New Shop</Text>

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

            <Text style={[styles.label, { color: colors.mutedForeground }]}>INSURANCE CARRIER</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
              placeholder="State Farm Commercial"
              placeholderTextColor={colors.mutedForeground}
              value={insuranceCarrier}
              onChangeText={setInsuranceCarrier}
            />

            <Text style={[styles.label, { color: colors.mutedForeground }]}>POLICY NUMBER</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
              placeholder="POL-12345"
              placeholderTextColor={colors.mutedForeground}
              value={insurancePolicy}
              onChangeText={setInsurancePolicy}
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
