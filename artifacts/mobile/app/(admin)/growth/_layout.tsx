import { Stack } from "expo-router";
import { useColors } from "@/hooks/useColors";

export default function GrowthLayout() {
  const colors = useColors();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.foreground,
        headerTitleStyle: { fontWeight: "700" },
      }}
    >
      <Stack.Screen name="index" options={{ title: "Growth Intelligence" }} />
      <Stack.Screen name="referrals" options={{ title: "Referral Intelligence" }} />
      <Stack.Screen name="regions" options={{ title: "Regional & Balance" }} />
      <Stack.Screen name="cpa" options={{ title: "Analytics & CPA" }} />
      <Stack.Screen name="amplification" options={{ title: "Mechanic Amplification" }} />
      <Stack.Screen name="trends" options={{ title: "Trends & Opportunities" }} />
      <Stack.Screen name="queue" options={{ title: "Content Approval Queue" }} />
      <Stack.Screen name="content/[id]" options={{ title: "Post Detail" }} />
      <Stack.Screen name="admin-controls" options={{ title: "Admin Controls" }} />
    </Stack>
  );
}
