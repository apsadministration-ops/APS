import { View, Text, StyleSheet, TextInput, Pressable, ActivityIndicator, Alert } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useGetVehicle, useTransferVehicle } from "@workspace/api-client-react";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { useState } from "react";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

export default function TransferScreen() {
  const colors = useColors();
  const router = useRouter();
  const { vehicleId } = useLocalSearchParams<{ vehicleId: string }>();
  const id = parseInt(vehicleId, 10);

  const { data: vehicle } = useGetVehicle(id, { query: { enabled: !!id } });
  const transferMutation = useTransferVehicle();

  const [email, setEmail] = useState("");
  const [error, setError] = useState("");

  const handleTransfer = () => {
    setError("");
    if (!email.trim()) {
      setError("Please enter the new owner's email.");
      return;
    }
    Alert.alert(
      "Confirm Transfer",
      `Transfer ${vehicle?.year} ${vehicle?.make} ${vehicle?.model} to ${email}?\n\nThis cannot be undone. All service history will remain permanently tied to this VIN.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Transfer",
          style: "destructive",
          onPress: () => {
            transferMutation.mutate(
              { vehicleId: id, data: { newOwnerEmail: email } },
              {
                onSuccess: () => {
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                  Alert.alert("Success", "Vehicle ownership transferred successfully.", [
                    { text: "OK", onPress: () => router.replace("/(customer)/vehicles") },
                  ]);
                },
                onError: (e: any) => {
                  setError(e?.message ?? "Transfer failed. Please check the email and try again.");
                },
              }
            );
          },
        },
      ]
    );
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: "Transfer Ownership",
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.foreground,
          headerShown: true,
          presentation: "modal",
        }}
      />
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <KeyboardAwareScrollViewCompat
          contentContainerStyle={{ padding: 24, paddingBottom: 80 }}
          bottomOffset={20}
        >
          {vehicle && (
            <View style={[styles.vehicleCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={[styles.vehicleIcon, { backgroundColor: colors.secondary }]}>
                <Feather name="truck" size={28} color={colors.foreground} />
              </View>
              <View>
                <Text style={[styles.vehicleName, { color: colors.foreground }]}>
                  {vehicle.year} {vehicle.make} {vehicle.model}
                </Text>
                <Text style={[styles.vehicleVin, { color: colors.mutedForeground }]}>VIN: {vehicle.vin}</Text>
              </View>
            </View>
          )}

          <View style={[styles.infoBox, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
            <Feather name="info" size={16} color={colors.secondaryForeground} />
            <Text style={[styles.infoText, { color: colors.secondaryForeground }]}>
              All service history is permanently tied to this VIN and will remain accessible to the new owner.
            </Text>
          </View>

          <Text style={[styles.label, { color: colors.foreground }]}>New Owner Email</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.card, color: colors.foreground, borderColor: colors.border }]}
            placeholder="Enter their email address"
            placeholderTextColor={colors.mutedForeground}
            keyboardType="email-address"
            autoCapitalize="none"
            value={email}
            onChangeText={setEmail}
          />

          {error ? <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}

          <Pressable
            style={[styles.btn, { backgroundColor: colors.destructive }, transferMutation.isPending && { opacity: 0.6 }]}
            onPress={handleTransfer}
            disabled={transferMutation.isPending}
          >
            {transferMutation.isPending
              ? <ActivityIndicator color="white" />
              : (
                <>
                  <Feather name="send" size={18} color="white" />
                  <Text style={styles.btnText}>Transfer Ownership</Text>
                </>
              )}
          </Pressable>
        </KeyboardAwareScrollViewCompat>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  vehicleCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 16,
  },
  vehicleIcon: {
    width: 56,
    height: 56,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  vehicleName: { fontSize: 17, fontWeight: "700" },
  vehicleVin: { fontSize: 12, fontFamily: "monospace", marginTop: 2 },
  infoBox: {
    flexDirection: "row",
    gap: 10,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 24,
    alignItems: "flex-start",
  },
  infoText: { flex: 1, fontSize: 13, lineHeight: 20 },
  label: { fontSize: 14, fontWeight: "600", marginBottom: 8 },
  input: {
    height: 52,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 16,
    marginBottom: 16,
  },
  error: { fontSize: 14, marginBottom: 12 },
  btn: {
    height: 54,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginTop: 8,
  },
  btnText: { color: "white", fontWeight: "700", fontSize: 16 },
});
