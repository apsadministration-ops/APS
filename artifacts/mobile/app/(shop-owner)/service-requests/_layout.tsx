import { Stack } from "expo-router";

export default function ServiceRequestsLayout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: "Service requests" }} />
      <Stack.Screen name="new" options={{ title: "New service request" }} />
      <Stack.Screen name="[id]" options={{ title: "Service request" }} />
    </Stack>
  );
}