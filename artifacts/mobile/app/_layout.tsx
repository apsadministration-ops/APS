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
import { Platform, useColorScheme } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import colors from "@/constants/colors";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import AIAssistantWidget from "@/components/AIAssistantWidget";
import { MileagePromptHost } from "@/app/transport/[jobId]";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { setBaseUrl } from "@workspace/api-client-react";
import { Text, View } from "react-native";
import { IS_EXPO_GO } from "@/lib/isExpoGo";
import { API_CONFIGURATION_ERROR, getApiConfig } from "@/lib/apiConfig";
import { getRoleDestination } from "@/lib/roleDestination";

// Splash control is best-effort on web and in Expo Go; an unavailable native
// splash module must never become an unhandled startup rejection.
void SplashScreen.preventAutoHideAsync().catch(() => undefined);

const queryClient = new QueryClient();
const apiConfig = getApiConfig();

// react-native-keyboard-controller ships its own native code, which Expo Go
// does not bundle — importing/mounting it there crashes to a white screen. So
// we only load it outside Expo Go. In Expo Go we render children directly and
// rely on the KeyboardAvoidingView fallback in KeyboardAwareScrollViewCompat.
// Web and real iOS/Android builds keep the full provider.
function KeyboardProviderCompat({ children }: { children: React.ReactNode }) {
  if (IS_EXPO_GO) return <>{children}</>;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { KeyboardProvider } = require("react-native-keyboard-controller");
  return <KeyboardProvider>{children}</KeyboardProvider>;
}

// Needed for Expo to reach the API server correctly.  Do not initialize the
// generated client with `https://undefined` when build-time configuration is
// missing; the root layout shows a safe, visible error instead.
if (apiConfig.valid) {
  setBaseUrl(apiConfig.origin);
}

function ConfigurationErrorScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const theme = isDark ? colors.dark : colors.light;

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.background,
        justifyContent: "center",
        paddingHorizontal: 28,
      }}
    >
      <Text style={{ color: theme.foreground, fontSize: 22, fontWeight: "700", marginBottom: 10 }}>
        App configuration error
      </Text>
      <Text style={{ color: theme.mutedForeground, fontSize: 15, lineHeight: 22 }}>
        {API_CONFIGURATION_ERROR}
      </Text>
    </View>
  );
}

function RootLayoutNav() {
  const { user, isLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const colorScheme = useColorScheme();
  const pushStatus = usePushNotifications();
  const theme = colorScheme === "dark" ? colors.dark : colors.light;

  // Register push notification token and handle taps
  useEffect(() => {
    if (isLoading) return;

    const inAuthGroup = segments[0] === "(auth)";
    
    if (!user && !inAuthGroup) {
      router.replace("/(auth)/login");
    } else if (user && inAuthGroup) {
      const destination = getRoleDestination(user.role);
      if (destination) router.replace(destination);
    }
  }, [user, isLoading, segments]);

  if (isLoading) {
    return <View style={{ flex: 1 }} />;
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
      {user && pushStatus === "unavailable" ? (
        <View
          accessibilityRole="alert"
          style={{
            alignItems: "center",
            backgroundColor: theme.card,
            borderColor: theme.border,
            borderRadius: 10,
            borderWidth: 1,
            elevation: 3,
            flexDirection: "row",
            left: 12,
            paddingHorizontal: 12,
            paddingVertical: 9,
            position: "absolute",
            right: 12,
            shadowColor: theme.foreground,
            shadowOpacity: 0.12,
            shadowRadius: 8,
            top: 8,
            zIndex: 10,
          }}
        >
          <Text style={{ color: theme.mutedForeground, flex: 1, fontSize: 12 }}>
            Push notifications are unavailable in this runtime. Job updates remain available in the app.
          </Text>
        </View>
      ) : null}
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

  // On web, `useFonts` can hang indefinitely while loading the bundled icon
  // fonts — neither `fontsLoaded` nor `fontError` ever flips true. Gating the
  // render on it (`return null`) therefore leaves the entire app rendering
  // nothing forever: a permanent white screen. So on web we never block on
  // fonts (icon glyphs swap in once their @font-face resolves) and we hide the
  // splash on mount. Native keeps the gate so the splash covers the brief font
  // load and we avoid a fallback-glyph flash (e.g. Android CJK icons).
  useEffect(() => {
    if (Platform.OS === "web") {
      SplashScreen.hideAsync().catch(() => undefined);
    }
  }, []);

  if (Platform.OS !== "web" && !fontsLoaded && !fontError) {
    return null;
  }

  if (!apiConfig.valid) {
    return <ConfigurationErrorScreen />;
  }

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <KeyboardProviderCompat>
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
            </KeyboardProviderCompat>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
