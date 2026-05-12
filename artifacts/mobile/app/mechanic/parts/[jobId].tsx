import { useState, useMemo } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator,
  Modal, TextInput,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { alertMessage, confirm } from "@/utils/confirm";
import {
  useListRecommendedParts,
  useCreatePartsOrder,
  useListJobPartsOrders,
  useUpdatePartsOrder,
  type PartsRecommendation,
  type PartsOffer,
  PartsOrderConfidence,
  PartsOrderStatus,
  type PartsOrderWithCatalog,
} from "@workspace/api-client-react";

const CATEGORIES = [
  "oil_filter", "air_filter", "cabin_filter", "brake_pads_front", "brake_pads_rear",
  "brake_rotors_front", "brake_rotors_rear", "battery", "alternator", "spark_plugs",
  "wiper_blades", "serpentine_belt",
];

const CONF_COLOR: Record<string, string> = {
  exact_vin: "#16a34a",
  oem_confirmed: "#2563eb",
  supplier_confirmed: "#d97706",
  universal: "#6b7280",
  manual_verify: "#dc2626",
};
const CONF_LABEL: Record<string, string> = {
  exact_vin: "VIN-EXACT",
  oem_confirmed: "OEM CONFIRMED",
  supplier_confirmed: "SUPPLIER CONFIRMED",
  universal: "UNIVERSAL",
  manual_verify: "VERIFY MANUALLY",
};

const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;
const titleize = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export default function SourcePartsScreen() {
  const colors = useColors();
  const router = useRouter();
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const jid = parseInt(jobId, 10);

  const [category, setCategory] = useState<string>("oil_filter");
  const [orderTarget, setOrderTarget] = useState<{ rec: PartsRecommendation; offer: PartsOffer } | null>(null);
  const [orderQty, setOrderQty] = useState("1");

  const recsQ = useListRecommendedParts(jid, { category });
  const ordersQ = useListJobPartsOrders(jid);
  const createOrder = useCreatePartsOrder();
  const updateOrder = useUpdatePartsOrder();

  const recs = recsQ.data?.recommendations ?? [];
  const vehicle = recsQ.data?.vehicle;
  const orders: PartsOrderWithCatalog[] = ordersQ.data?.orders ?? [];

  const submitOrder = async () => {
    if (!orderTarget) return;
    const qty = Math.max(1, Math.min(99, parseInt(orderQty, 10) || 1));
    try {
      await createOrder.mutateAsync({
        jobId: jid,
        data: {
          catalogId: orderTarget.rec.catalogId,
          supplierKey: orderTarget.offer.supplierKey,
          sku: orderTarget.offer.sku,
          qty,
          unitPriceCents: orderTarget.offer.priceCents,
        },
      });
      setOrderTarget(null);
      ordersQ.refetch();
      alertMessage("Order created", "Status: candidate. Mark ordered when supplier confirms.");
    } catch (e) {
      alertMessage("Order failed", (e as Error).message || "Server rejected the order");
    }
  };

  const cycleStatus = async (o: PartsOrderWithCatalog) => {
    const next: Record<string, string | null> = {
      candidate: "ordered",
      ordered: "received",
      received: "installed",
      installed: null,
      returned: null,
      cancelled: null,
    };
    const target = next[o.status];
    if (!target) return;
    if (!(await confirm({ title: `Mark ${target}?`, message: `Move "${o.catalog?.name ?? "part"}" to ${target}.` }))) return;
    try {
      await updateOrder.mutateAsync({ id: o.id, data: { status: target as PartsOrderStatus } });
      ordersQ.refetch();
    } catch (e) {
      alertMessage("Update failed", (e as Error).message);
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: "Source Parts", headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.foreground }} />
      <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={{ padding: 16, paddingBottom: 120 }}>
        {vehicle && (
          <View style={[styles.vehBanner, { borderColor: colors.border }]}>
            <Text style={{ color: colors.mutedForeground, fontSize: 11, fontWeight: "700", letterSpacing: 1 }}>VEHICLE</Text>
            <Text style={{ color: colors.foreground, fontWeight: "700", marginTop: 4 }}>
              {vehicle.year ?? "?"} {vehicle.make ?? "?"} {vehicle.model ?? ""} {vehicle.trim ?? ""}
            </Text>
            <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
              {vehicle.engine ?? "Engine ?"} · {vehicle.drivetrain ?? "Drivetrain ?"}
            </Text>
            {vehicle.vin && <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>VIN: {vehicle.vin}</Text>}
          </View>
        )}

        <Text style={[styles.section, { color: colors.foreground }]}>Category</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
          {CATEGORIES.map((c) => (
            <Pressable
              key={c}
              onPress={() => setCategory(c)}
              style={[styles.chip, { borderColor: colors.border, backgroundColor: category === c ? colors.primary : "transparent" }]}
            >
              <Text style={{ color: category === c ? "#fff" : colors.foreground, fontSize: 12 }}>{titleize(c)}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <Text style={[styles.section, { color: colors.foreground, marginTop: 16 }]}>Recommendations</Text>
        {recsQ.isLoading ? (
          <ActivityIndicator color={colors.primary} style={{ marginVertical: 24 }} />
        ) : recs.length === 0 ? (
          <Text style={{ color: colors.mutedForeground, marginTop: 8 }}>No catalog matches for this category yet.</Text>
        ) : (
          recs.map((r) => (
            <View key={r.catalogId} style={[styles.card, { borderColor: colors.border }]}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.foreground, fontWeight: "700" }}>{r.brand} · {r.name}</Text>
                  <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>OEM: {r.oemPartNumber} · {r.qualityTier} · {r.warrantyMonths}mo</Text>
                </View>
                <View style={[styles.confBadge, { backgroundColor: CONF_COLOR[r.confidence] }]}>
                  <Text style={styles.confText}>{CONF_LABEL[r.confidence]}</Text>
                </View>
              </View>
              {r.reasons.length > 0 && (
                <Text style={{ color: colors.mutedForeground, fontSize: 11, marginTop: 4, fontStyle: "italic" }}>
                  {r.reasons.join(" · ")}
                </Text>
              )}
              <Text style={{ color: colors.foreground, fontSize: 12, marginTop: 8 }}>MSRP: {fmt(r.msrpCents)}</Text>

              {r.offers.length === 0 ? (
                <Text style={{ color: colors.mutedForeground, fontSize: 12, marginTop: 8 }}>No live offers.</Text>
              ) : (
                <View style={{ marginTop: 8, gap: 6 }}>
                  {r.offers.map((o, i) => (
                    <Pressable
                      key={i}
                      onPress={() => { setOrderTarget({ rec: r, offer: o }); setOrderQty("1"); }}
                      style={[styles.offerRow, { borderColor: colors.border }]}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: "600" }}>{o.supplierKey} · {o.sku}</Text>
                        <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>
                          {o.inStock ? "In stock" : "Out of stock"} · ETA {o.etaDays}d
                        </Text>
                      </View>
                      <Text style={{ color: colors.primary, fontWeight: "700" }}>{fmt(o.priceCents)}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>
          ))
        )}

        <Text style={[styles.section, { color: colors.foreground, marginTop: 24 }]}>Job Orders</Text>
        {orders.length === 0 ? (
          <Text style={{ color: colors.mutedForeground, marginTop: 8 }}>No parts ordered for this job yet.</Text>
        ) : (
          orders.map((o) => (
            <Pressable key={o.id} onPress={() => cycleStatus(o)} style={[styles.card, { borderColor: colors.border }]}>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.foreground, fontWeight: "700" }}>
                    {o.catalog?.brand ?? "?"} · {o.catalog?.name ?? "Part"} × {o.qty}
                  </Text>
                  <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
                    {o.supplierKey} · {o.sku} · {fmt(o.totalPriceCents)}
                  </Text>
                  <Text style={{ color: colors.mutedForeground, fontSize: 11, marginTop: 2 }}>
                    {o.validationState === "blocked" ? "BLOCKED · " : o.validationState === "warned" ? "WARN · " : ""}
                    {o.validationReasons.join(" · ") || "Validated"}
                  </Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <View style={[styles.statusPill, { backgroundColor: o.status === "installed" ? "#16a34a" : o.status === "cancelled" ? "#6b7280" : colors.primary }]}>
                    <Text style={styles.confText}>{o.status.toUpperCase()}</Text>
                  </View>
                  {o.status !== "installed" && o.status !== "cancelled" && o.status !== "returned" && (
                    <Text style={{ color: colors.mutedForeground, fontSize: 10, marginTop: 4 }}>tap to advance</Text>
                  )}
                </View>
              </View>
            </Pressable>
          ))
        )}
      </ScrollView>

      <Modal visible={!!orderTarget} transparent animationType="slide" onRequestClose={() => setOrderTarget(null)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modal, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <Text style={{ color: colors.foreground, fontSize: 18, fontWeight: "800", marginBottom: 8 }}>Order part</Text>
            {orderTarget && (
              <>
                <Text style={{ color: colors.foreground, fontWeight: "600" }}>
                  {orderTarget.rec.brand} · {orderTarget.rec.name}
                </Text>
                <Text style={{ color: colors.mutedForeground, fontSize: 12, marginBottom: 4 }}>
                  {orderTarget.offer.supplierKey} · {orderTarget.offer.sku} · {fmt(orderTarget.offer.priceCents)}
                </Text>
                <View style={[styles.confBadgeInline, { backgroundColor: CONF_COLOR[orderTarget.rec.confidence] }]}>
                  <Text style={styles.confText}>{CONF_LABEL[orderTarget.rec.confidence]}</Text>
                </View>
                {orderTarget.rec.confidence === "manual_verify" && (
                  <Text style={{ color: "#dc2626", fontSize: 12, marginTop: 8 }}>
                    Order will be flagged WARNED — verify engine/drivetrain match before installing.
                  </Text>
                )}
                <Text style={{ color: colors.mutedForeground, fontSize: 11, marginTop: 12, marginBottom: 4 }}>QUANTITY</Text>
                <TextInput
                  value={orderQty}
                  onChangeText={setOrderQty}
                  keyboardType="number-pad"
                  style={[styles.input, { borderColor: colors.border, color: colors.foreground }]}
                />
                <View style={{ flexDirection: "row", gap: 8, marginTop: 16 }}>
                  <Pressable onPress={() => setOrderTarget(null)} style={[styles.btn, { borderColor: colors.border }]}>
                    <Text style={{ color: colors.foreground }}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    onPress={submitOrder}
                    disabled={createOrder.isPending}
                    style={[styles.btn, { backgroundColor: colors.primary, borderColor: colors.primary, flex: 1 }]}
                  >
                    <Text style={{ color: "#fff", fontWeight: "700" }}>
                      {createOrder.isPending ? "Submitting…" : "Place order"}
                    </Text>
                  </Pressable>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  vehBanner: { borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 12 },
  section: { fontSize: 13, fontWeight: "700", letterSpacing: 0.5, marginBottom: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1 },
  card: { borderWidth: 1, borderRadius: 12, padding: 12, marginTop: 10 },
  confBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, marginLeft: 8 },
  confBadgeInline: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, alignSelf: "flex-start", marginTop: 6 },
  confText: { color: "#fff", fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },
  offerRow: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 8, padding: 8 },
  statusPill: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  modalBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" },
  modal: { borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20, borderWidth: 1, paddingBottom: 40 },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  btn: { paddingVertical: 12, paddingHorizontal: 16, borderRadius: 8, borderWidth: 1, alignItems: "center", justifyContent: "center" },
});
