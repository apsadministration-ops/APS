import { View, Text, StyleSheet, ScrollView, Pressable, Switch } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { Feather } from "@expo/vector-icons";
import { useMemo, useState } from "react";
import {
  TIERS,
  JOB_CATALOG,
  COMMISSION,
  EUROPEAN_PREMIUM,
  servicesForTier,
  tierLabel,
  commissionForJob,
  quoteForService,
  splitCents,
  isPricedService,
  type TierKey,
} from "@workspace/tier-catalog";

/**
 * "How Much Can You Earn?" — single page that explains the tier ladder, the
 * three commission rates, the full service catalog by tier, and gives the
 * mechanic an interactive calculator. All numbers come from
 * `@workspace/tier-catalog` so this can never disagree with the server.
 */
export default function EarningsScreen() {
  const colors = useColors();
  const router = useRouter();
  const { user } = useAuth();
  const myTier = ((user?.mechanicTier ?? "detailer") as TierKey);
  // Flat-rate calculator: toggle between domestic and European vehicle to
  // see how the +25–35% premium changes mechanic take-home. Each tier card
  // uses the first PRICED sample service for that tier so the numbers are
  // grounded in the real catalog.
  const [european, setEuropean] = useState(false);

  const calcRows = useMemo(() => {
    return TIERS.map((t) => {
      // Only sample priced services so the calculator can always show a
      // concrete dollar amount. Tiers with no priced services are skipped.
      const sample = servicesForTier(t.key).find(isPricedService);
      if (!sample) return null;
      const quote = quoteForService(sample, { isEuropean: european });
      if (!quote) return null;
      const c = commissionForJob({
        category: sample.category,
        jobTier: t.key,
        mechanicTier: myTier,
      });
      // Use the SAME cents-based split the server uses at Stripe capture
      // (`splitCents` in payments.ts/worklogs.ts). This guarantees the
      // mechanic sees the exact take-home they'll be paid, not a rounded
      // approximation that drifts a dollar from the payout.
      const total = quote.bookedTotal;
      const totalCents = total * 100;
      const { mechanicPayoutCents, platformFeeCents } = splitCents(totalCents, c);
      const mechanicTake = mechanicPayoutCents / 100;
      const platformTake = platformFeeCents / 100;
      return { tier: t, sample, c, quote, total, mechanicTake, platformTake };
    }).filter(Boolean) as Array<{
      tier: typeof TIERS[number];
      sample: typeof JOB_CATALOG[number];
      c: ReturnType<typeof commissionForJob>;
      quote: NonNullable<ReturnType<typeof quoteForService>>;
      total: number;
      mechanicTake: number;
      platformTake: number;
    }>;
  }, [european, myTier]);

  return (
    <>
      <Stack.Screen
        options={{
          title: "How Much Can You Earn?",
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.foreground,
        }}
      />
      <ScrollView style={[styles.container, { backgroundColor: colors.background }]} contentContainerStyle={{ padding: 16, paddingBottom: 120 }}>
        <Text style={[styles.h1, { color: colors.foreground }]}>Earn more by leveling up</Text>
        <Text style={[styles.lede, { color: colors.mutedForeground }]}>
          APS pays mechanics on labor only. Three simple rules: same-tier work pays the most, detailing always pays best, and "working down" to a lower-tier job is a small cut.
        </Text>

        {/* The three rates */}
        <View style={styles.rateRow}>
          <RateCard
            title="Same-tier"
            mechanicPct={COMMISSION.normal.mechanicPct}
            platformPct={COMMISSION.normal.platformPct}
            tone="primary"
            sub="Job at your tier"
          />
          <RateCard
            title="Detailing"
            mechanicPct={COMMISSION.detailing.mechanicPct}
            platformPct={COMMISSION.detailing.platformPct}
            tone="green"
            sub="Any detailing job"
          />
          <RateCard
            title="Working down"
            mechanicPct={COMMISSION.workingDown.mechanicPct}
            platformPct={COMMISSION.workingDown.platformPct}
            tone="amber"
            sub="Lower-tier job"
          />
        </View>

        {/* Live calculator — flat rates from catalog */}
        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Take-home calculator</Text>
          <Text style={[styles.sectionSub, { color: colors.mutedForeground }]}>
            Each tier shows a typical flat-rate job and what you'd keep — calculated against your current tier ({tierLabel(myTier)}). Toggle European to add the +{EUROPEAN_PREMIUM.minPct}–{EUROPEAN_PREMIUM.maxPct}% vehicle premium.
          </Text>

          <View style={[styles.euroToggle, { borderColor: colors.border, backgroundColor: colors.background }]}>
            <Feather name="flag" size={16} color={european ? "#1D4ED8" : colors.mutedForeground} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.euroToggleTitle, { color: colors.foreground }]}>European vehicle</Text>
              <Text style={[styles.euroToggleSub, { color: colors.mutedForeground }]}>
                Adds +{EUROPEAN_PREMIUM.appliedPct}% to the booked total
              </Text>
            </View>
            <Switch
              value={european}
              onValueChange={setEuropean}
              trackColor={{ false: colors.border, true: "#3B82F6" }}
            />
          </View>

          <View style={{ gap: 8, marginTop: 12 }}>
            {calcRows.map((row) => {
              const canAccept = row.tier.level <= TIERS.find((t) => t.key === myTier)!.level;
              return (
                <View
                  key={row.tier.key}
                  style={[styles.calcRow, {
                    backgroundColor: canAccept ? colors.background : colors.card,
                    borderColor: row.tier.key === myTier ? colors.primary : colors.border,
                    opacity: canAccept ? 1 : 0.5,
                  }]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.calcTier, { color: colors.foreground }]}>
                      Tier {row.tier.level} · {row.tier.label}
                    </Text>
                    <Text style={[styles.calcSample, { color: colors.mutedForeground }]} numberOfLines={1}>
                      e.g. {row.sample.name} · ${row.quote.finalMin}–${row.quote.finalMax}
                    </Text>
                    <Text style={[styles.calcReason, { color: colors.mutedForeground }]}>
                      {canAccept ? row.c.reasonLabel : "Above your current tier — not accepted yet"}
                    </Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={[styles.calcTake, { color: row.c.reason === "detailing" ? "#15803D" : row.c.reason === "working_down" ? "#B45309" : colors.primary }]}>
                      ${row.mechanicTake.toFixed(2)}
                    </Text>
                    <Text style={[styles.calcSplit, { color: colors.mutedForeground }]}>
                      of ${row.total} · {row.c.mechanicPct}% / {row.c.platformPct}%
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        </View>

        {/* Tier ladder + full catalog */}
        <Text style={[styles.h2, { color: colors.foreground, marginTop: 28 }]}>The Tier Ladder</Text>
        <Text style={[styles.lede, { color: colors.mutedForeground }]}>
          Higher tiers unlock more (and higher-paying) jobs. You can always work down to lower tiers — those jobs pay you 75% instead of 80%.
        </Text>

        {TIERS.map((t) => {
          const isMine = t.key === myTier;
          const services = JOB_CATALOG.filter((s) => s.tier === t.key);
          return (
            <View
              key={t.key}
              style={[styles.tierBlock, {
                backgroundColor: colors.card,
                borderColor: isMine ? colors.primary : colors.border,
                borderWidth: isMine ? 2 : 1,
              }]}
            >
              <View style={styles.tierHead}>
                <View style={[styles.tierBadge, { backgroundColor: colors.primary + "22" }]}>
                  <Text style={[styles.tierBadgeText, { color: colors.primary }]}>T{t.level}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.tierName, { color: colors.foreground }]}>
                    {t.label}{isMine ? "  (you)" : ""}
                  </Text>
                  <Text style={[styles.tierBlurb, { color: colors.mutedForeground }]}>{t.blurb}</Text>
                </View>
              </View>
              <View style={styles.serviceList}>
                {services.map((s) => (
                  <View key={s.slug} style={[styles.servicePill, { borderColor: colors.border }]}>
                    <Feather
                      name={s.category === "detailing" ? "droplet" : s.category === "diagnostic" ? "search" : "tool"}
                      size={11}
                      color={s.category === "detailing" ? "#15803D" : colors.mutedForeground}
                    />
                    <Text style={[styles.servicePillText, { color: colors.foreground }]}>{s.name}</Text>
                  </View>
                ))}
              </View>
            </View>
          );
        })}

        <View style={[styles.footnote, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="info" size={14} color={colors.mutedForeground} />
          <Text style={[styles.footnoteText, { color: colors.mutedForeground }]}>
            Commission applies to labor only — parts, fees, and tips pass through 100% to the mechanic. Refunded jobs reverse both sides of the ledger.
          </Text>
        </View>

        <Pressable onPress={() => router.back()} style={[styles.doneBtn, { backgroundColor: colors.primary }]}>
          <Text style={styles.doneText}>Got it</Text>
        </Pressable>
      </ScrollView>
    </>
  );
}

function RateCard({ title, mechanicPct, platformPct, tone, sub }: {
  title: string; mechanicPct: number; platformPct: number; tone: "primary" | "green" | "amber"; sub: string;
}) {
  const colors = useColors();
  const fg = tone === "green" ? "#15803D" : tone === "amber" ? "#B45309" : colors.primary;
  const bg = tone === "green" ? "#22C55E1A" : tone === "amber" ? "#F59E0B1A" : colors.primary + "1A";
  return (
    <View style={[rateStyles.card, { backgroundColor: bg, borderColor: fg + "44" }]}>
      <Text style={[rateStyles.title, { color: fg }]}>{title}</Text>
      <Text style={[rateStyles.big, { color: fg }]}>{mechanicPct}<Text style={rateStyles.pct}>%</Text></Text>
      <Text style={[rateStyles.small, { color: colors.mutedForeground }]}>you keep</Text>
      <Text style={[rateStyles.platform, { color: colors.mutedForeground }]}>APS: {platformPct}%</Text>
      <Text style={[rateStyles.sub, { color: colors.mutedForeground }]}>{sub}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  h1: { fontSize: 26, fontWeight: "800", marginBottom: 6 },
  h2: { fontSize: 20, fontWeight: "800", marginBottom: 6 },
  lede: { fontSize: 14, lineHeight: 21, marginBottom: 18 },
  rateRow: { flexDirection: "row", gap: 8, marginBottom: 18 },
  section: { borderWidth: 1, borderRadius: 16, padding: 16, marginTop: 6 },
  sectionTitle: { fontSize: 16, fontWeight: "800" },
  sectionSub: { fontSize: 13, lineHeight: 18, marginTop: 4, marginBottom: 12 },
  euroToggle: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, borderWidth: 1,
  },
  euroToggleTitle: { fontSize: 14, fontWeight: "700" },
  euroToggleSub: { fontSize: 11, marginTop: 1 },
  calcRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    padding: 12, borderRadius: 10, borderWidth: 1,
  },
  calcTier: { fontSize: 14, fontWeight: "700" },
  calcSample: { fontSize: 12, marginTop: 2 },
  calcReason: { fontSize: 11, marginTop: 4, fontStyle: "italic" },
  calcTake: { fontSize: 20, fontWeight: "800" },
  calcSplit: { fontSize: 11, fontWeight: "600", marginTop: 2 },
  tierBlock: { borderRadius: 14, padding: 14, marginTop: 10 },
  tierHead: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 },
  tierBadge: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  tierBadgeText: { fontSize: 13, fontWeight: "800" },
  tierName: { fontSize: 15, fontWeight: "800" },
  tierBlurb: { fontSize: 12, marginTop: 2, lineHeight: 17 },
  serviceList: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  servicePill: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999, borderWidth: 1,
  },
  servicePillText: { fontSize: 11, fontWeight: "600" },
  footnote: {
    flexDirection: "row", alignItems: "flex-start", gap: 8,
    padding: 12, borderRadius: 12, borderWidth: 1, marginTop: 18,
  },
  footnoteText: { flex: 1, fontSize: 12, lineHeight: 17 },
  doneBtn: { height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center", marginTop: 18 },
  doneText: { color: "white", fontWeight: "800", fontSize: 16 },
});

const rateStyles = StyleSheet.create({
  card: {
    flex: 1, borderRadius: 14, borderWidth: 1.5, padding: 12, alignItems: "center",
  },
  title: { fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.6 },
  big: { fontSize: 34, fontWeight: "800", marginTop: 4, lineHeight: 38 },
  pct: { fontSize: 18, fontWeight: "700" },
  small: { fontSize: 10, fontWeight: "600" },
  platform: { fontSize: 10, marginTop: 4 },
  sub: { fontSize: 10, marginTop: 6, textAlign: "center" },
});
