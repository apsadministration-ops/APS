import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable,
  ActivityIndicator, KeyboardAvoidingView, Platform,
} from "react-native";
import { useLocalSearchParams, Stack } from "expo-router";
import { useState, useEffect } from "react";
import { useGetVehicle } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { Feather } from "@expo/vector-icons";
import { searchObd2Code, getAllCodes, type Obd2Code } from "@/data/obd2Codes";

const SEVERITY_COLOR: Record<string, string> = {
  low: "#22C55E",
  medium: "#F59E0B",
  high: "#F97316",
  critical: "#EF4444",
};

const SEVERITY_LABEL: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

function VehicleContextCard({ make, model, year }: { make: string; model: string; year: number | string }) {
  const colors = useColors();
  return (
    <View style={[styles.vehicleCard, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
      <View style={[styles.vehicleIconBox, { backgroundColor: colors.primary + "20" }]}>
        <Feather name="truck" size={20} color={colors.primary} />
      </View>
      <View>
        <Text style={[styles.vehicleCardTitle, { color: colors.foreground }]}>
          {year} {make} {model}
        </Text>
        <Text style={[styles.vehicleCardSub, { color: colors.mutedForeground }]}>
          Vehicle-specific repair context active
        </Text>
      </View>
    </View>
  );
}

function CodeResultCard({ code, vin }: { code: Obd2Code; vin: string }) {
  const colors = useColors();
  const [expanded, setExpanded] = useState(false);
  const sevColor = SEVERITY_COLOR[code.severity] ?? colors.primary;

  return (
    <View style={[styles.codeCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {/* Header */}
      <Pressable style={styles.codeHeader} onPress={() => setExpanded(!expanded)}>
        <View style={[styles.codeBadge, { backgroundColor: sevColor + "18", borderColor: sevColor + "44" }]}>
          <Text style={[styles.codeBadgeText, { color: sevColor }]}>{code.code}</Text>
        </View>
        <View style={styles.codeHeaderMeta}>
          <Text style={[styles.codeDescription, { color: colors.foreground }]} numberOfLines={expanded ? 0 : 2}>
            {code.description}
          </Text>
          <Text style={[styles.codeSystem, { color: colors.mutedForeground }]}>{code.system}</Text>
        </View>
        <Feather name={expanded ? "chevron-up" : "chevron-down"} size={18} color={colors.mutedForeground} />
      </Pressable>

      {/* Pills */}
      <View style={styles.pillRow}>
        <View style={[styles.pill, { backgroundColor: sevColor + "18" }]}>
          <Feather name="alert-triangle" size={11} color={sevColor} />
          <Text style={[styles.pillText, { color: sevColor }]}>{SEVERITY_LABEL[code.severity]} Severity</Text>
        </View>
        <View style={[styles.pill, { backgroundColor: code.canDrive ? "#22C55E18" : "#EF444418" }]}>
          <Feather name={code.canDrive ? "check-circle" : "x-circle"} size={11} color={code.canDrive ? "#22C55E" : "#EF4444"} />
          <Text style={[styles.pillText, { color: code.canDrive ? "#22C55E" : "#EF4444" }]}>
            {code.canDrive ? "OK to Drive" : "Do Not Drive"}
          </Text>
        </View>
        <View style={[styles.pill, { backgroundColor: colors.secondary }]}>
          <Feather name="dollar-sign" size={11} color={colors.mutedForeground} />
          <Text style={[styles.pillText, { color: colors.mutedForeground }]}>
            ${code.estimatedCost.min}–${code.estimatedCost.max}
          </Text>
        </View>
      </View>

      {/* Expanded Detail */}
      {expanded && (
        <View style={styles.expandedContent}>
          {/* Common Causes */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
              <Feather name="search" size={13} color={colors.primary} />  Common Causes
            </Text>
            {code.commonCauses.map((cause, i) => (
              <View key={i} style={styles.bulletRow}>
                <View style={[styles.bullet, { backgroundColor: colors.primary }]} />
                <Text style={[styles.bulletText, { color: colors.foreground }]}>{cause}</Text>
              </View>
            ))}
          </View>

          {/* Repair Steps */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
              <Feather name="tool" size={13} color={colors.primary} />  Diagnostic Steps
            </Text>
            {code.repairSteps.map((step, i) => (
              <View key={i} style={styles.stepNumberRow}>
                <View style={[styles.stepNumber, { backgroundColor: colors.primary }]}>
                  <Text style={styles.stepNumberText}>{i + 1}</Text>
                </View>
                <Text style={[styles.bulletText, { color: colors.foreground }]}>{step}</Text>
              </View>
            ))}
          </View>

          {/* Affected Systems */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
              <Feather name="cpu" size={13} color={colors.primary} />  Affected Systems
            </Text>
            <View style={styles.systemsRow}>
              {code.affectedSystems.map((s) => (
                <View key={s} style={[styles.systemPill, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
                  <Text style={[styles.systemPillText, { color: colors.foreground }]}>{s}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* VIN Contextual Note */}
          {vin && (
            <View style={[styles.vinNote, { backgroundColor: colors.primary + "12", borderColor: colors.primary + "30" }]}>
              <Feather name="info" size={14} color={colors.primary} />
              <Text style={[styles.vinNoteText, { color: colors.primary }]}>
                Repair steps above apply generically. Cross-reference your vehicle's service manual (VIN: {vin}) for torque specs and part numbers specific to this year/make/model.
              </Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

export default function Obd2Screen() {
  const colors = useColors();
  const { vehicleId } = useLocalSearchParams<{ vehicleId: string }>();
  const id = parseInt(vehicleId, 10);

  const { data: vehicle } = useGetVehicle(id, { query: { enabled: !!id } });

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Obd2Code[]>([]);
  const [searched, setSearched] = useState(false);
  const [recentCodes] = useState<string[]>(["P0300", "P0420", "P0171", "P0087", "P0335"]);

  const handleSearch = () => {
    if (!query.trim()) return;
    setResults(searchObd2Code(query));
    setSearched(true);
  };

  const handleQuickSearch = (code: string) => {
    setQuery(code);
    setResults(searchObd2Code(code));
    setSearched(true);
  };

  const vin = vehicle?.vin ?? "";

  return (
    <>
      <Stack.Screen options={{
        title: "OBD2 Code Lookup",
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.foreground,
        headerShown: true,
      }} />
      <KeyboardAvoidingView
        style={[styles.container, { backgroundColor: colors.background }]}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 60 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Vehicle Context */}
          {vehicle && (
            <VehicleContextCard
              make={vehicle.make}
              model={vehicle.model}
              year={vehicle.year}
            />
          )}

          {/* Search Bar */}
          <View style={[styles.searchBar, { backgroundColor: colors.card, borderColor: query ? colors.primary : colors.border }]}>
            <Feather name="search" size={18} color={query ? colors.primary : colors.mutedForeground} />
            <TextInput
              style={[styles.searchInput, { color: colors.foreground }]}
              placeholder="Enter code (e.g. P0300, C0035, U0100)"
              placeholderTextColor={colors.mutedForeground}
              value={query}
              onChangeText={(t) => {
                setQuery(t.toUpperCase());
                if (t.length === 0) { setSearched(false); setResults([]); }
              }}
              onSubmitEditing={handleSearch}
              autoCapitalize="characters"
              autoCorrect={false}
              returnKeyType="search"
            />
            {query.length > 0 && (
              <Pressable onPress={() => { setQuery(""); setResults([]); setSearched(false); }}>
                <Feather name="x" size={16} color={colors.mutedForeground} />
              </Pressable>
            )}
          </View>

          <Pressable
            style={[styles.searchBtn, { backgroundColor: colors.primary, opacity: query.trim() ? 1 : 0.5 }]}
            onPress={handleSearch}
            disabled={!query.trim()}
          >
            <Feather name="search" size={16} color="white" />
            <Text style={styles.searchBtnText}>Look Up Code</Text>
          </Pressable>

          {/* Code Categories Info */}
          {!searched && (
            <>
              <View style={styles.categoryRow}>
                {[
                  { prefix: "P", label: "Powertrain", color: "#6366F1" },
                  { prefix: "B", label: "Body", color: "#F97316" },
                  { prefix: "C", label: "Chassis", color: "#0EA5E9" },
                  { prefix: "U", label: "Network", color: "#8B5CF6" },
                ].map((cat) => (
                  <View key={cat.prefix} style={[styles.categoryPill, { backgroundColor: cat.color + "18", borderColor: cat.color + "44" }]}>
                    <Text style={[styles.categoryPrefix, { color: cat.color }]}>{cat.prefix}</Text>
                    <Text style={[styles.categoryLabel, { color: cat.color }]}>{cat.label}</Text>
                  </View>
                ))}
              </View>

              <Text style={[styles.quickTitle, { color: colors.mutedForeground }]}>Common Codes — Tap to Look Up</Text>
              <View style={styles.quickGrid}>
                {recentCodes.map((code) => (
                  <Pressable
                    key={code}
                    style={[styles.quickPill, { backgroundColor: colors.card, borderColor: colors.border }]}
                    onPress={() => handleQuickSearch(code)}
                  >
                    <Text style={[styles.quickPillText, { color: colors.primary }]}>{code}</Text>
                  </Pressable>
                ))}
              </View>

              <View style={[styles.tipsBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Feather name="info" size={16} color={colors.primary} />
                <Text style={[styles.tipsText, { color: colors.mutedForeground }]}>
                  Enter a full code (P0300) for exact results, or enter a partial code (P03) to see all related codes. Search by keyword (e.g. "misfire", "fuel") is also supported.
                </Text>
              </View>
            </>
          )}

          {/* Results */}
          {searched && (
            <View style={styles.resultsContainer}>
              <View style={styles.resultsHeader}>
                <Text style={[styles.resultsTitle, { color: colors.foreground }]}>
                  {results.length > 0 ? `${results.length} Result${results.length === 1 ? "" : "s"}` : "No results found"}
                </Text>
                {results.length > 0 && (
                  <Pressable onPress={() => { setQuery(""); setResults([]); setSearched(false); }}>
                    <Text style={[styles.clearText, { color: colors.primary }]}>Clear</Text>
                  </Pressable>
                )}
              </View>

              {results.length === 0 ? (
                <View style={[styles.emptyBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Feather name="alert-circle" size={36} color={colors.mutedForeground} />
                  <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Code Not Found</Text>
                  <Text style={[styles.emptyDesc, { color: colors.mutedForeground }]}>
                    "{query}" is not in the local database. Try a different search or consult an OEM service manual.
                  </Text>
                </View>
              ) : (
                results.map((code) => (
                  <CodeResultCard key={code.code} code={code} vin={vin} />
                ))
              )}
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  vehicleCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 16,
  },
  vehicleIconBox: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  vehicleCardTitle: { fontSize: 15, fontWeight: "700" },
  vehicleCardSub: { fontSize: 12 },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    height: 52,
    borderRadius: 14,
    borderWidth: 1.5,
    marginBottom: 10,
  },
  searchInput: { flex: 1, fontSize: 16, fontFamily: "monospace" },
  searchBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 50,
    borderRadius: 14,
    marginBottom: 20,
  },
  searchBtnText: { color: "white", fontWeight: "700", fontSize: 15 },
  categoryRow: { flexDirection: "row", gap: 8, marginBottom: 20 },
  categoryPill: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    gap: 2,
  },
  categoryPrefix: { fontSize: 20, fontWeight: "800" },
  categoryLabel: { fontSize: 10, fontWeight: "600" },
  quickTitle: { fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 },
  quickGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 20 },
  quickPill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  quickPillText: { fontSize: 13, fontWeight: "700", fontFamily: "monospace" },
  tipsBox: {
    flexDirection: "row",
    gap: 10,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  tipsText: { flex: 1, fontSize: 13, lineHeight: 19 },
  resultsContainer: { gap: 12 },
  resultsHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  resultsTitle: { fontSize: 15, fontWeight: "700" },
  clearText: { fontSize: 14, fontWeight: "600" },
  codeCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 10,
  },
  codeHeader: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  codeBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    minWidth: 72,
    alignItems: "center",
  },
  codeBadgeText: { fontSize: 14, fontWeight: "800", fontFamily: "monospace" },
  codeHeaderMeta: { flex: 1, gap: 2 },
  codeDescription: { fontSize: 14, fontWeight: "600", lineHeight: 20 },
  codeSystem: { fontSize: 12 },
  pillRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 20,
  },
  pillText: { fontSize: 11, fontWeight: "600" },
  expandedContent: { gap: 16, paddingTop: 4 },
  section: { gap: 8 },
  sectionTitle: { fontSize: 13, fontWeight: "700", marginBottom: 2 },
  bulletRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  bullet: { width: 6, height: 6, borderRadius: 3, marginTop: 7, flexShrink: 0 },
  bulletText: { fontSize: 13, lineHeight: 20, flex: 1 },
  stepNumberRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  stepNumber: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    marginTop: 2,
  },
  stepNumberText: { color: "white", fontSize: 11, fontWeight: "800" },
  systemsRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  systemPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
  },
  systemPillText: { fontSize: 12, fontWeight: "600" },
  vinNote: {
    flexDirection: "row",
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  vinNoteText: { flex: 1, fontSize: 12, lineHeight: 18 },
  emptyBox: {
    padding: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: "center",
    gap: 8,
  },
  emptyTitle: { fontSize: 16, fontWeight: "700" },
  emptyDesc: { fontSize: 13, textAlign: "center", lineHeight: 20 },
});
