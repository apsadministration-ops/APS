import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { setBaseUrl } from "@workspace/api-client-react";
import { View } from "react-native";

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

// Needed for Expo to reach the API server correctly
setBaseUrl(`https://${process.env.EXPO_PUBLIC_DOMAIN}`);

function RootLayoutNav() {
  const { user, isLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  // Register push notification token and handle taps
  usePushNotifications();

  useEffect(() => {
    if (isLoading) return;

    const inAuthGroup = segments[0] === "(auth)";
    
    if (!user && !inAuthGroup) {
      router.replace("/(auth)/login");
    } else if (user && inAuthGroup) {
      if (user.role === "customer") {
        router.replace("/(customer)");
      } else if (user.role === "mechanic") {
        router.replace("/(mechanic)");
      } else if (user.role === "admin") {
        router.replace("/(admin)");
      }
    }
  }, [user, isLoading, segments]);

  if (isLoading) {
    return <View style={{ flex: 1 }} />;
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      <Stack.Screen name="(customer)" options={{ headerShown: false }} />
      <Stack.Screen name="(mechanic)" options={{ headerShown: false }} />
      <Stack.Screen name="(admin)" options={{ headerShown: false }} />
      <Stack.Screen name="vehicle/[id]" options={{ presentation: "card" }} />
      <Stack.Screen name="job/[id]" options={{ presentation: "card" }} />
      <Stack.Screen name="request-service" options={{ presentation: "modal" }} />
      <Stack.Screen name="transfer/[vehicleId]" options={{ presentation: "modal" }} />
      <Stack.Screen name="history/[vehicleId]" options={{ presentation: "card" }} />
      <Stack.Screen name="worklog/[jobId]" options={{ presentation: "modal" }} />
      <Stack.Screen name="parts/[vehicleId]" options={{ presentation: "card" }} />
      <Stack.Screen name="tracker/[jobId]" options={{ presentation: "card" }} />
      <Stack.Screen name="obd2/[vehicleId]" options={{ presentation: "card" }} />
      <Stack.Screen name="messages/[jobId]" options={{ presentation: "card", headerShown: false }} />
      <Stack.Screen name="referral" options={{ presentation: "card", headerShown: false }} />
      <Stack.Screen name="detailing" options={{ presentation: "modal", headerShown: false }} />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView>
            <KeyboardProvider>
              <AuthProvider>
                <RootLayoutNav />
              </AuthProvider>
            </KeyboardProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
