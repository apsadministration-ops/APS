import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { Feather, Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import * as SystemUI from "expo-system-ui";
import { StatusBar } from "expo-status-bar";
import React, { useEffect } from "react";
import { useColorScheme, ActivityIndicator, Text, Platform } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import colors from "@/constants/colors";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import AIAssistantWidget from "@/components/AIAssistantWidget";
import { MileagePromptHost } from "@/components/MileagePromptHost";
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
      } else if (user.role === "shop_owner") {
        router.replace("/(shop-owner)");
      }
    }
  }, [user, isLoading, segments]);

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.light.background }}>
        <ActivityIndicator size="large" color={colors.light.primary} />
        <Text style={{ marginTop: 12, color: colors.light.mutedForeground, fontSize: 13 }}>Loading session…</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(customer)" options={{ headerShown: false }} />
        <Stack.Screen name="(mechanic)" options={{ headerShown: false }} />
        <Stack.Screen name="(admin)" options={{ headerShown: false }} />
        <Stack.Screen name="(shop-owner)" options={{ headerShown: false }} />
        <Stack.Screen name="shop/[id]" options={{ presentation: "card" }} />
        <Stack.Screen name="bays/[jobId]" options={{ presentation: "modal" }} />
        <Stack.Screen name="inspection/[jobId]" options={{ presentation: "modal" }} />
        <Stack.Screen name="vehicle/[id]" options={{ presentation: "card" }} />
        <Stack.Screen name="job/[id]" options={{ presentation: "card" }} />
        <Stack.Screen name="request-service" options={{ presentation: "modal" }} />
        <Stack.Screen name="transfer/[vehicleId]" options={{ presentation: "modal" }} />
        <Stack.Screen name="history/[vehicleId]" options={{ presentation: "card" }} />
        <Stack.Screen name="worklog/[jobId]" options={{ presentation: "modal" }} />
        <Stack.Screen name="workbench/[jobId]" options={{ presentation: "card", headerShown: false }} />
        <Stack.Screen name="parts/[vehicleId]" options={{ presentation: "card" }} />
        <Stack.Screen name="tracker/[jobId]" options={{ presentation: "card" }} />
        <Stack.Screen name="transport/[jobId]" options={{ presentation: "card" }} />
        <Stack.Screen name="obd2/[vehicleId]" options={{ presentation: "card" }} />
        <Stack.Screen name="messages/[jobId]" options={{ presentation: "card", headerShown: false }} />
        <Stack.Screen name="referral" options={{ presentation: "card", headerShown: false }} />
        <Stack.Screen name="detailing" options={{ presentation: "modal", headerShown: false }} />
      </Stack>
      <AIAssistantWidget />
    </View>
  );
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    // Preload icon fonts so glyphs render correctly on first paint.
    // Without this, Android falls back to a CJK font and shows
    // Chinese-looking characters where icons should be.
    ...Ionicons.font,
    ...Feather.font,
    ...MaterialCommunityIcons.font,
  });

  // Set the native window background color BEFORE first paint so Android
  // doesn't flash white between the splash teardown and the first JS frame
  // (most visible on dark mode). Safe to call on every theme change.
  useEffect(() => {
    SystemUI.setBackgroundColorAsync(isDark ? colors.dark.background : colors.light.background)
      .catch(() => undefined);
  }, [isDark]);

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync().catch(() => undefined);
    }
  }, [fontsLoaded, fontError]);

  // On web, NEVER block the first paint on fonts. The Replit preview pane
  // and any browser will show system fallbacks instantly and the custom
  // fonts pop in when ready. Blocking the entire tree on a multi-MB icon
  // font bundle is what made the preview look like a white screen.
  //
  // On native (iOS/Android) we still gate briefly so Android doesn't fall
  // back to a CJK glyph for vector icons, but cap it at 1.5s with a hard
  // timeout so we never deadlock on a stalled font fetch.
  const [fontTimeout, setFontTimeout] = React.useState(Platform.OS === "web");
  useEffect(() => {
    if (Platform.OS === "web") return;
    const t = setTimeout(() => setFontTimeout(true), 1500);
    return () => clearTimeout(t);
  }, []);

  if (!fontsLoaded && !fontError && !fontTimeout) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.light.background }}>
        <ActivityIndicator size="large" color={colors.light.primary} />
        <Text style={{ marginTop: 12, color: colors.light.mutedForeground, fontSize: 13 }}>Loading fonts…</Text>
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <KeyboardProvider>
              <AuthProvider>
                {/* `style="auto"` follows system theme on iOS/Android.
                    `translucent` lets content draw under the status bar on
                    Android (works with edgeToEdgeEnabled in app.json). */}
                <StatusBar style="auto" translucent />
                <RootLayoutNav />
                {/* Android mileage prompt host — see app/transport/[jobId].tsx.
                    iOS uses Alert.prompt and web uses window.prompt; on Android
                    the AndroidMileagePrompt singleton calls into this host. */}
                <MileagePromptHost />
              </AuthProvider>
            </KeyboardProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
