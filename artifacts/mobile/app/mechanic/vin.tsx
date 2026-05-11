/**
 * Mechanic VIN entry / decoder workspace.
 *
 * Mechanic-only — guarded at the route level by the (mechanic) tab redirect.
 * Customers cannot navigate here even if they manually type the URL because
 * the workspace bundle endpoint also gates by role server-side.
 *
 * Flow: enter VIN → call /api/mechanic/vin/decode → preview decoded specs →
 * "Open workspace" navigates to /mechanic/workspace/[vin] which lazily creates
 * the persistent vehicle row + mechanic profile if APS hasn't seen this VIN.
 *
 * Barcode + OCR scanning are placeholder buttons today — adding them requires
 * expo-barcode-scanner / expo-camera permissions; the network and persistence
 * layers are already wired so the scan handlers only need to plug in raw VIN
 * text when implemented.
 */

import { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, TextInput, Pressable, ScrollView, ActivityIndicator,
} from "react-native";
import { Stack, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useColors } from "@/hooks/useColors";
import { alertMessage } from "@/utils/confirm";
import { useAuth } from "@/context/AuthContext";

interface DecodedPreview {
  year: number | null; make: string | null; model: string | null;
  trim: string | null; engine: string | null; transmission: string | null;
  drivetrain: string | null; fuelType: string | null; bodyClass: string | null;
}

const VIN_REGEX = /^[A-HJ-NPR-Z0-9]{17}$/;

export default function MechanicVinScreen() {
  const colors = useColors();
  const router = useRouter();
  const { user } = useAuth();
  const domain = process.env.EXPO_PUBLIC_DOMAIN;

  const [vin, setVin] = useState("");
  const [decoding, setDecoding] = useState(false);
  const [decoded, setDecoded] = useState<DecodedPreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cleanVin = vin.replace(/\s+/g, "").toUpperCase();
  const looksValid = VIN_REGEX.test(cleanVin);

  const decode = useCallback(async () => {
    setError(null); setDecoded(null);
    if (!looksValid) {
      setError("VIN must be 17 characters and cannot contain I, O, or Q.");
      return;
    }
    setDecoding(true);
    try {
      const token = await AsyncStorage.getItem("auth_token");
      const res = await fetch(`https://${domain}/api/mechanic/vin/decode`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ vin: cleanVin }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "VIN decode failed.");
        return;
      }
      setDecoded(data.decoded);
    } catch (e) {
      setError("Network error. Try again.");
    } finally {
      setDecoding(false);
    }
  }, [cleanVin, looksValid, domain]);

  const openWorkspace = () => {
    router.push(`/mechanic/workspace/${cleanVin}` as never);
  };

  if (user && user.role !== "mechanic" && user.role !== "admin") {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.destructive }}>Mechanics only.</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: "VIN Workspace", headerShown: true }} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120 }}>
        <View style={styles.headerRow}>
          <View style={[styles.iconBox, { backgroundColor: colors.primary + "20" }]}>
            <Feather name="cpu" size={22} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: colors.foreground }]}>Vehicle Intelligence</Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              Decode any VIN and open its persistent mechanic workspace.
            </Text>
          </View>
        </View>

        <Text style={[styles.label, { color: colors.mutedForeground }]}>VIN</Text>
        <TextInput
          value={vin}
          onChangeText={setVin}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={20}
          placeholder="17-character VIN"
          placeholderTextColor={colors.mutedForeground}
          style={[styles.input, {
            backgroundColor: colors.card, color: colors.foreground,
            borderColor: looksValid ? "#10B981" : colors.border,
          }]}
        />
        <View style={styles.helperRow}>
          <Text style={[styles.helper, { color: colors.mutedForeground }]}>
            {cleanVin.length}/17 characters
          </Text>
          {looksValid ? (
            <View style={styles.validRow}>
              <Feather name="check-circle" size={12} color="#10B981" />
              <Text style={[styles.helper, { color: "#10B981" }]}>Valid format</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.actionRow}>
          <Pressable
            disabled={decoding || !looksValid}
            onPress={decode}
            style={[styles.primaryBtn, {
              backgroundColor: colors.primary,
              opacity: decoding || !looksValid ? 0.5 : 1,
            }]}
          >
            {decoding
              ? <ActivityIndicator color="white" />
              : <><Feather name="search" size={16} color="white" /><Text style={styles.primaryBtnText}>Decode VIN</Text></>}
          </Pressable>
        </View>

        <View style={styles.scanRow}>
          <Pressable
            onPress={() => alertMessage("Barcode scanner", "Camera-based VIN scanning ships in the next release. For now, type the VIN manually.")}
            style={[styles.scanBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <Feather name="maximize" size={16} color={colors.foreground} />
            <Text style={[styles.scanBtnText, { color: colors.foreground }]}>Scan barcode</Text>
          </Pressable>
          <Pressable
            onPress={() => alertMessage("OCR scanner", "Photograph-the-VIN scanning ships in the next release.")}
            style={[styles.scanBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <Feather name="camera" size={16} color={colors.foreground} />
            <Text style={[styles.scanBtnText, { color: colors.foreground }]}>Photo scan</Text>
          </Pressable>
        </View>

        {error ? (
          <View style={[styles.errorBox, { backgroundColor: colors.destructive + "15", borderColor: colors.destructive }]}>
            <Feather name="alert-circle" size={14} color={colors.destructive} />
            <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>
          </View>
        ) : null}

        {decoded ? (
          <View style={[styles.previewCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.previewTitle, { color: colors.foreground }]}>
              {decoded.year ?? "—"} {decoded.make ?? ""} {decoded.model ?? ""}
            </Text>
            {decoded.trim ? (
              <Text style={[styles.previewTrim, { color: colors.mutedForeground }]}>{decoded.trim}</Text>
            ) : null}
            <View style={styles.specGrid}>
              <Spec label="Engine" value={decoded.engine} />
              <Spec label="Transmission" value={decoded.transmission} />
              <Spec label="Drivetrain" value={decoded.drivetrain} />
              <Spec label="Fuel" value={decoded.fuelType} />
              <Spec label="Body" value={decoded.bodyClass} />
            </View>
            <Pressable
              onPress={openWorkspace}
              style={[styles.openBtn, { backgroundColor: colors.primary }]}
            >
              <Feather name="arrow-right-circle" size={16} color="white" />
              <Text style={styles.openBtnText}>Open workspace</Text>
            </Pressable>
            <Text style={[styles.hint, { color: colors.mutedForeground }]}>
              Opening creates the persistent APS vehicle profile if one doesn't already exist.
            </Text>
          </View>
        ) : null}

        <View style={[styles.calloutBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="info" size={14} color={colors.primary} />
          <Text style={[styles.calloutText, { color: colors.mutedForeground }]}>
            VIN decoding is the foundation, not the ground truth. Trim variations, tow packages, HD packages, and aftermarket changes mean APS still asks you to verify high-risk parts before ordering.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

function Spec({ label, value }: { label: string; value: string | null }) {
  const colors = useColors();
  return (
    <View style={styles.specItem}>
      <Text style={[styles.specLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Text style={[styles.specValue, { color: colors.foreground }]}>{value ?? "—"}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 20 },
  iconBox: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 22, fontWeight: "700" },
  subtitle: { fontSize: 13, marginTop: 2 },
  label: { fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 },
  input: {
    borderWidth: 1.5, borderRadius: 10, padding: 14, fontSize: 16,
    fontFamily: "monospace", letterSpacing: 1,
  },
  helperRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 6 },
  helper: { fontSize: 12 },
  validRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  actionRow: { marginTop: 16 },
  primaryBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, paddingVertical: 14, borderRadius: 10,
  },
  primaryBtnText: { color: "white", fontWeight: "700", fontSize: 15 },
  scanRow: { flexDirection: "row", gap: 8, marginTop: 10 },
  scanBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 6, paddingVertical: 10, borderRadius: 8, borderWidth: 1,
  },
  scanBtnText: { fontSize: 13, fontWeight: "500" },
  errorBox: {
    marginTop: 16, padding: 12, borderRadius: 8, borderWidth: 1,
    flexDirection: "row", alignItems: "center", gap: 8,
  },
  errorText: { fontSize: 13, flex: 1 },
  previewCard: { marginTop: 20, padding: 16, borderRadius: 12, borderWidth: 1 },
  previewTitle: { fontSize: 18, fontWeight: "700" },
  previewTrim: { fontSize: 13, marginTop: 2 },
  specGrid: { marginTop: 12, flexDirection: "row", flexWrap: "wrap", gap: 12 },
  specItem: { minWidth: "45%", flexBasis: "45%" },
  specLabel: { fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 },
  specValue: { fontSize: 14, fontWeight: "500", marginTop: 2 },
  openBtn: {
    marginTop: 16, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, paddingVertical: 12, borderRadius: 10,
  },
  openBtnText: { color: "white", fontWeight: "600", fontSize: 14 },
  hint: { fontSize: 11, marginTop: 8, textAlign: "center" },
  calloutBox: {
    marginTop: 24, padding: 12, borderRadius: 10, borderWidth: 1,
    flexDirection: "row", alignItems: "flex-start", gap: 8,
  },
  calloutText: { fontSize: 12, flex: 1, lineHeight: 17 },
});
