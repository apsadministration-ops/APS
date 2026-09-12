import { Stack } from "expo-router";

import { PartnerFocusedScreenBoundary } from "@/components/partner/PartnerFocusedScreenBoundary";

export default function ServiceRequestsLayout() {
  return (
    <Stack
      screenLayout={({ children }) => (
        <PartnerFocusedScreenBoundary>{children}</PartnerFocusedScreenBoundary>
      )}
    >
      <Stack.Screen
        name="index"
        options={{
          title: "Service requests",
          headerBackVisible: false,
          headerLeft: () => null,
        }}
      />
      <Stack.Screen name="new" options={{ title: "New service request" }} />
      <Stack.Screen name="[id]" options={{ title: "Service request" }} />
    </Stack>
  );
}
