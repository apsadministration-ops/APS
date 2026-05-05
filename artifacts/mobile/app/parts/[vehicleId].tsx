import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator,
  Pressable, Linking, Alert,
} from "react-native";
import { useLocalSearchParams, Stack } from "expo-router";
import { useEffect, useState } from "react";
import { useGetVehicle } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { Feather } from "@expo/vector-icons";

interface VinField {
  Variable: string;
  Value: string | null;
}

interface Recall {
  NHTSACampaignNumber: string;
  Component: string;
  Summary: string;
  Consequence: string;
  Remedy: string;
  ReportReceivedDate: string;
}

interface DecodedVehicle {
  make: string;
  model: string;
  year: string;
  trim: string;
  engineCylinders: string;
  engineDisplacement: string;
  driveType: string;
  fuelType: string;
  transmissionStyle: string;
  bodyClass: string;
  doors: string;
  manufacturer: string;
  plantCity: string;
  plantCountry: string;
}

function parseVinFields(fields: VinField[]): DecodedVehicle {
  const get = (key: string) => fields.find((f) => f.Variable === key)?.Value ?? "";
  return {
    make: get("Make"),
    model: get("Model"),
    year: get("Model Year"),
    trim: get("Trim"),
    engineCylinders: get("Engine Number of Cylinders"),
    engineDisplacement: get("Displacement (L)"),
    driveType: get("Drive Type"),
    fuelType: get("Fuel Type - Primary"),
    transmissionStyle: get("Transmission Style"),
    bodyClass: get("Body Class"),
    doors: get("Doors"),
    manufacturer: get("Manufacturer Name"),
    plantCity: get("Plant City"),
    plantCountry: get("Plant Country"),
  };
}

function DetailRow({ label, value }: { label: string; value: string }) {
  const colors = useColors();
  if (!value || value === "Not Applicable") return null;
  return (
    <View style={[styles.detailRow, { borderBottomColor: colors.border }]}>
      <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Text style={[styles.detailValue, { color: colors.foreground }]}>{value}</Text>
    </View>
  );
}

function RecallCard({ recall }: { recall: Recall }) {
  const colors = useColors();
  const [expanded, setExpanded] = useState(false);
  return (
    <Pressable
      style={[styles.recallCard, { backgroundColor: colors.card, borderColor: colors.border }]}
      onPress={() => setExpanded(!expanded)}
    >
      <View style={styles.recallHeader}>
        <View style={[styles.recallBadge, { backgroundColor: colors.destructive + "20" }]}>
          <Text style={[styles.recallBadgeText, { color: colors.destructive }]}>RECALL</Text>
        </View>
        <Text style={[styles.recallCampaign, { color: colors.mutedForeground }]}>
          #{recall.NHTSACampaignNumber}
        </Text>
        <Feather name={expanded ? "chevron-up" : "chevron-down"} size={16} color={colors.mutedForeground} />
      </View>
      <Text style={[styles.recallComponent, { color: colors.foreground }]}>{recall.Component}</Text>
      {expanded && (
        <View style={styles.recallDetails}>
          {recall.Summary ? (
            <View style={styles.recallSection}>
              <Text style={[styles.recallSectionTitle, { color: colors.mutedForeground }]}>SUMMARY</Text>
              <Text style={[styles.recallText, { color: colors.foreground }]}>{recall.Summary}</Text>
            </View>
          ) : null}
          {recall.Consequence ? (
            <View style={styles.recallSection}>
              <Text style={[styles.recallSectionTitle, { color: colors.destructive }]}>CONSEQUENCE</Text>
              <Text style={[styles.recallText, { color: colors.foreground }]}>{recall.Consequence}</Text>
            </View>
          ) : null}
          {recall.Remedy ? (
            <View style={styles.recallSection}>
              <Text style={[styles.recallSectionTitle, { color: colors.mutedForeground }]}>REMEDY</Text>
              <Text style={[styles.recallText, { color: colors.foreground }]}>{recall.Remedy}</Text>
            </View>
          ) : null}
        </View>
      )}
    </Pressable>
  );
}

function PartsLink({ icon, label, url, color }: { icon: string; label: string; url: string; color: string }) {
  const colors = useColors();
  return (
    <Pressable
      style={[styles.partsLink, { backgroundColor: colors.card, borderColor: colors.border }]}
      onPress={() => Linking.openURL(url).catch(() => Alert.alert("Error", "Could not open link."))}
    >
      <View style={[styles.partsLinkIcon, { backgroundColor: color + "20" }]}>
        <Feather name={icon as any} size={20} color={color} />
      </View>
      <Text style={[styles.partsLinkLabel, { color: colors.foreground }]}>{label}</Text>
      <Feather name="external-link" size={16} color={colors.mutedForeground} />
    </Pressable>
  );
}

export default function PartsScreen() {
  const colors = useColors();
  const { vehicleId } = useLocalSearchParams<{ vehicleId: string }>();
  const id = parseInt(vehicleId, 10);

  const { data: vehicle } = useGetVehicle(id, { query: { enabled: !!id } });

  const [vinData, setVinData] = useState<DecodedVehicle | null>(null);
  const [recalls, setRecalls] = useState<Recall[]>([]);
  const [loadingVin, setLoadingVin] = useState(false);
  const [loadingRecalls, setLoadingRecalls] = useState(false);
  const [error, setError] = useState("");

  const vin = vehicle?.vin;
  const make = vehicle?.make ?? vinData?.make ?? "";
  const model = vehicle?.model ?? vinData?.model ?? "";
  const year = String(vehicle?.year ?? vinData?.year ?? "");

  useEffect(() => {
    if (!vin) return;

    setLoadingVin(true);
    fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/decodevinvalues/${vin}?format=json`)
      .then((r) => r.json())
      .then((data) => {
        const fields: VinField[] = data?.Results?.[0]
          ? Object.entries(data.Results[0]).map(([Variable, Value]) => ({ Variable, Value: Value as string | null }))
          : [];
        setVinData(parseVinFields(fields));
      })
      .catch(() => setError("Could not decode VIN."))
      .finally(() => setLoadingVin(false));
  }, [vin]);

  useEffect(() => {
    if (!make || !model || !year) return;
    setLoadingRecalls(true);
    fetch(`https://api.nhtsa.gov/recalls/recallsByVehicle?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}&modelYear=${year}`)
      .then((r) => r.json())
      .then((data) => {
        setRecalls(data?.results ?? []);
      })
      .catch(() => {})
      .finally(() => setLoadingRecalls(false));
  }, [make, model, year]);

  const rockautoUrl = make && model && year
    ? `https://www.rockauto.com/en/catalog/${encodeURIComponent(make.toLowerCase())},${year},${encodeURIComponent(model.toLowerCase())}`
    : "https://www.rockauto.com";

  const autozoneUrl = make && model && year
    ? `https://www.autozone.com/searchresult?searchText=${encodeURIComponent(`${year} ${make} ${model} parts`)}`
    : "https://www.autozone.com";

  const advanceUrl = make && model && year
    ? `https://shop.advanceautoparts.com/find-parts-by-size/parts-for-${year}-${encodeURIComponent(make.toLowerCase())}-${encodeURIComponent(model.toLowerCase())}`
    : "https://www.advanceautoparts.com";

  const nhtsaUrl = vin
    ? `https://www.nhtsa.gov/vehicle/${encodeURIComponent(vin)}`
    : "https://www.nhtsa.gov";

  return (
    <>
      <Stack.Screen
        options={{
          title: "Parts Catalog",
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.foreground,
          headerShown: true,
        }}
      />
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 60 }}
          contentInsetAdjustmentBehavior="automatic"
        >
          {/* Vehicle Header */}
          <View style={[styles.header, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.headerIcon, { backgroundColor: colors.secondary }]}>
              <Feather name="settings" size={28} color={colors.foreground} />
            </View>
            <View style={styles.headerInfo}>
              <Text style={[styles.headerTitle, { color: colors.foreground }]}>
                {vehicle?.year} {vehicle?.make} {vehicle?.model}
              </Text>
              <Text style={[styles.headerVin, { color: colors.mutedForeground }]}>VIN: {vin}</Text>
              {vehicle?.trim ? (
                <Text style={[styles.headerTrim, { color: colors.primary }]}>{vehicle.trim}</Text>
              ) : null}
            </View>
          </View>

          {/* VIN Decoded Specs */}
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Vehicle Specifications</Text>
          <Text style={[styles.sectionSubtitle, { color: colors.mutedForeground }]}>
            Decoded from VIN via NHTSA database
          </Text>

          {loadingVin ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color={colors.primary} size="small" />
              <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>Decoding VIN...</Text>
            </View>
          ) : vinData ? (
            <View style={[styles.specsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <DetailRow label="Engine" value={vinData.engineCylinders ? `${vinData.engineCylinders}-Cylinder ${vinData.engineDisplacement ? `${vinData.engineDisplacement}L` : ""}`.trim() : ""} />
              <DetailRow label="Drive Type" value={vinData.driveType} />
              <DetailRow label="Fuel Type" value={vinData.fuelType} />
              <DetailRow label="Transmission" value={vinData.transmissionStyle} />
              <DetailRow label="Body Style" value={vinData.bodyClass} />
              <DetailRow label="Doors" value={vinData.doors} />
              <DetailRow label="Trim" value={vinData.trim} />
              <DetailRow label="Manufacturer" value={vinData.manufacturer} />
              <DetailRow label="Assembly Plant" value={[vinData.plantCity, vinData.plantCountry].filter(Boolean).join(", ")} />
            </View>
          ) : error ? (
            <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>
          ) : null}

          {/* Parts Sources */}
          <Text style={[styles.sectionTitle, { color: colors.foreground, marginTop: 24 }]}>Source Parts</Text>
          <Text style={[styles.sectionSubtitle, { color: colors.mutedForeground }]}>
            Pre-filtered to your exact vehicle
          </Text>
          <View style={styles.linksGrid}>
            <PartsLink
              icon="shopping-cart"
              label="RockAuto"
              url={rockautoUrl}
              color={colors.primary}
            />
            <PartsLink
              icon="tool"
              label="AutoZone"
              url={autozoneUrl}
              color="#E87722"
            />
            <PartsLink
              icon="zap"
              label="Advance Auto Parts"
              url={advanceUrl}
              color="#CC0000"
            />
            <PartsLink
              icon="shield"
              label="NHTSA Vehicle Info"
              url={nhtsaUrl}
              color="#003366"
            />
          </View>

          {/* NHTSA Safety Recalls */}
          <View style={styles.recallsHeader}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Safety Recalls</Text>
            {recalls.length > 0 && (
              <View style={[styles.recallCountBadge, { backgroundColor: colors.destructive }]}>
                <Text style={styles.recallCountText}>{recalls.length}</Text>
              </View>
            )}
          </View>
          <Text style={[styles.sectionSubtitle, { color: colors.mutedForeground }]}>
            Official NHTSA recall data
          </Text>

          {loadingRecalls ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color={colors.primary} size="small" />
              <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>Loading recalls...</Text>
            </View>
          ) : recalls.length === 0 ? (
            <View style={[styles.noRecalls, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Feather name="check-circle" size={32} color="#22C55E" />
              <Text style={[styles.noRecallsText, { color: colors.foreground }]}>No open recalls found</Text>
              <Text style={[styles.noRecallsSubtext, { color: colors.mutedForeground }]}>
                This vehicle has no active NHTSA safety recalls.
              </Text>
            </View>
          ) : (
            <View style={styles.recallsList}>
              {recalls.map((r) => (
                <RecallCard key={r.NHTSACampaignNumber} recall={r} />
              ))}
            </View>
          )}
        </ScrollView>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 20,
  },
  headerIcon: {
    width: 60,
    height: 60,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  headerInfo: { flex: 1 },
  headerTitle: { fontSize: 17, fontWeight: "700" },
  headerVin: { fontSize: 11, fontFamily: "monospace", marginTop: 2 },
  headerTrim: { fontSize: 13, fontWeight: "600", marginTop: 4 },
  sectionTitle: { fontSize: 18, fontWeight: "700", marginBottom: 4 },
  sectionSubtitle: { fontSize: 13, marginBottom: 12 },
  loadingRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 16 },
  loadingText: { fontSize: 14 },
  specsCard: {
    borderWidth: 1,
    borderRadius: 14,
    overflow: "hidden",
    marginBottom: 4,
  },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  detailLabel: { fontSize: 13, fontWeight: "500", flex: 1 },
  detailValue: { fontSize: 14, fontWeight: "600", flex: 1.2, textAlign: "right" },
  errorText: { fontSize: 14, paddingVertical: 8 },
  linksGrid: { gap: 10, marginBottom: 4 },
  partsLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  partsLinkIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  partsLinkLabel: { flex: 1, fontSize: 15, fontWeight: "600" },
  recallsHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 24 },
  recallCountBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  recallCountText: { color: "white", fontSize: 12, fontWeight: "700" },
  noRecalls: {
    padding: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: "center",
    gap: 8,
  },
  noRecallsText: { fontSize: 16, fontWeight: "600" },
  noRecallsSubtext: { fontSize: 13, textAlign: "center" },
  recallsList: { gap: 10 },
  recallCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    gap: 8,
  },
  recallHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  recallBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  recallBadgeText: { fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },
  recallCampaign: { fontSize: 12, flex: 1 },
  recallComponent: { fontSize: 14, fontWeight: "600" },
  recallDetails: { gap: 12, marginTop: 4 },
  recallSection: { gap: 4 },
  recallSectionTitle: { fontSize: 10, fontWeight: "700", letterSpacing: 0.5 },
  recallText: { fontSize: 13, lineHeight: 19 },
});
