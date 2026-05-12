import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useColors } from "@/hooks/useColors";

interface Invoice {
  jobId: number;
  invoiceNumber: string;
  issuedAt: string | null;
  status: string;
  customer: { name: string; email: string } | null;
  vehicle: { vin: string; year: number; make: string; model: string } | null;
  serviceDescription: string;
  lineItems: {
    labor: { description: string; amountCents: number };
    parts: Array<{ name: string; brand: string | null; quantity: number; amountCents: number }>;
    tax: { amountCents: number };
  };
  totalCents: number;
}

const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;

export default function InvoiceScreen() {
  const colors = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const token = await AsyncStorage.getItem("auth_token");
        const domain = process.env.EXPO_PUBLIC_DOMAIN;
        const res = await fetch(`https://${domain}/api/jobs/${id}/invoice`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error(await res.text());
        setInvoice(await res.json());
      } catch (e) {
        setError((e as Error).message || "Failed to load invoice");
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, justifyContent: "center" }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (error || !invoice) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, justifyContent: "center", padding: 24 }]}>
        <Text style={{ color: colors.foreground, textAlign: "center" }}>{error || "Invoice not found"}</Text>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: "Invoice", headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.foreground }} />
      <ScrollView
        style={{ backgroundColor: colors.background }}
        contentContainerStyle={{ padding: 20, paddingBottom: 120 }}
      >
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Text style={[styles.title, { color: colors.foreground }]}>{invoice.invoiceNumber}</Text>
          <Text style={[styles.muted, { color: colors.mutedForeground }]}>
            {invoice.issuedAt ? new Date(invoice.issuedAt).toLocaleDateString() : "Pending"} · {invoice.status}
          </Text>
        </View>

        {invoice.customer && (
          <View style={styles.row}>
            <Text style={[styles.muted, { color: colors.mutedForeground }]}>BILL TO</Text>
            <Text style={{ color: colors.foreground, fontWeight: "600" }}>{invoice.customer.name}</Text>
            <Text style={{ color: colors.mutedForeground }}>{invoice.customer.email}</Text>
          </View>
        )}

        {invoice.vehicle && (
          <View style={styles.row}>
            <Text style={[styles.muted, { color: colors.mutedForeground }]}>VEHICLE</Text>
            <Text style={{ color: colors.foreground }}>
              {invoice.vehicle.year} {invoice.vehicle.make} {invoice.vehicle.model}
            </Text>
            <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>VIN: {invoice.vehicle.vin}</Text>
          </View>
        )}

        <View style={[styles.section, { borderColor: colors.border }]}>
          <Text style={[styles.muted, { color: colors.mutedForeground, marginBottom: 8 }]}>LINE ITEMS</Text>

          <View style={styles.line}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.foreground, fontWeight: "600" }}>Labor</Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 12 }} numberOfLines={2}>
                {invoice.lineItems.labor.description}
              </Text>
            </View>
            <Text style={{ color: colors.foreground, fontWeight: "600" }}>{fmt(invoice.lineItems.labor.amountCents)}</Text>
          </View>

          {invoice.lineItems.parts.map((p, i) => (
            <View key={i} style={styles.line}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.foreground }}>{p.name}{p.brand ? ` · ${p.brand}` : ""}</Text>
                <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>Qty {p.quantity}</Text>
              </View>
              <Text style={{ color: colors.foreground }}>{fmt(p.amountCents)}</Text>
            </View>
          ))}

          {invoice.lineItems.tax.amountCents > 0 && (
            <View style={styles.line}>
              <Text style={{ color: colors.foreground }}>Sales tax</Text>
              <Text style={{ color: colors.foreground }}>{fmt(invoice.lineItems.tax.amountCents)}</Text>
            </View>
          )}
        </View>

        <View style={[styles.totalRow, { borderTopColor: colors.border }]}>
          <Text style={{ color: colors.foreground, fontSize: 18, fontWeight: "700" }}>TOTAL</Text>
          <Text style={{ color: colors.primary, fontSize: 22, fontWeight: "800" }}>{fmt(invoice.totalCents)}</Text>
        </View>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingBottom: 16, marginBottom: 16, borderBottomWidth: 1 },
  title: { fontSize: 24, fontWeight: "800" },
  muted: { fontSize: 11, fontWeight: "600", letterSpacing: 1 },
  row: { marginBottom: 16 },
  section: { borderWidth: 1, borderRadius: 12, padding: 12, marginTop: 8 },
  line: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", paddingVertical: 8, gap: 8 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingTop: 16, marginTop: 16, borderTopWidth: 2 },
});
