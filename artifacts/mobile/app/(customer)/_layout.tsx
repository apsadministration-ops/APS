import { BlurView } from "expo-blur";
import { Redirect, Tabs } from "expo-router";
import { useAuth } from "@/context/AuthContext";
import { Feather } from "@expo/vector-icons";
import React from "react";
import { Platform, StyleSheet, View, useColorScheme } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";
import { getRoleDestination } from "@/lib/roleDestination";
import { IS_EXPO_GO } from "@/lib/isExpoGo";

// iOS-only modules. Loading them on Android Expo Go can crash the app
// silently because the native modules aren't shipped on Android. We
// lazy-require them inside the iOS-only NativeTabLayout component.
const isIOSPlatform = Platform.OS === "ios";

function isLiquidGlassAvailableSafe(): boolean {
  // NativeTabs and the glass-effect module are not shipped in Expo Go.
  // Keep the classic Tabs implementation there even on iOS 26.
  if (!isIOSPlatform || IS_EXPO_GO) return false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("expo-glass-effect") as typeof import("expo-glass-effect");
    return mod.isLiquidGlassAvailable();
  } catch {
    return false;
  }
}

function NativeTabLayout() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Icon, Label, NativeTabs } =
    require("expo-router/unstable-native-tabs") as typeof import("expo-router/unstable-native-tabs");
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="index">
        <Icon sf={{ default: "house", selected: "house.fill" }} />
        <Label>Home</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="vehicles">
        <Icon sf={{ default: "car", selected: "car.fill" }} />
        <Label>Vehicles</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="jobs">
        <Icon sf={{ default: "wrench.and.screwdriver", selected: "wrench.and.screwdriver.fill" }} />
        <Label>Jobs</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="profile">
        <Icon sf={{ default: "person", selected: "person.fill" }} />
        <Label>Profile</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

function ClassicTabLayout() {
  const colors = useColors();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        headerShown: true,
        headerStyle: {
          backgroundColor: colors.background,
        },
        headerTintColor: colors.foreground,
        tabBarStyle: {
          position: "absolute",
          backgroundColor: isIOS ? "transparent" : colors.background,
          borderTopWidth: isWeb ? 1 : 0,
          borderTopColor: colors.border,
          elevation: 0,
          paddingBottom: insets.bottom,
          ...(isWeb ? { height: 84 } : {}),
        },
        tabBarBackground: () =>
          isIOS ? (
            <BlurView
              intensity={100}
              tint={isDark ? "dark" : "light"}
              style={StyleSheet.absoluteFill}
            />
          ) : isWeb ? (
            <View
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: colors.background },
              ]}
            />
          ) : null,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color }) =>
            <Feather name="home" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="vehicles"
        options={{
          title: "Vehicles",
          tabBarIcon: ({ color }) =>
            <Feather name="truck" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="jobs"
        options={{
          title: "Jobs",
          tabBarIcon: ({ color }) =>
            <Feather name="tool" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color }) =>
            <Feather name="user" size={22} color={color} />,
        }}
      />
    </Tabs>
  );
}

export default function TabLayout() {
  const { user, isLoading } = useAuth();
  if (isLoading) return null;
  if (!user) return <Redirect href="/(auth)/login" />;
  if (user.role !== "customer") {
    return <Redirect href={getRoleDestination(user.role) ?? "/(auth)/login"} />;
  }
  if (isLiquidGlassAvailableSafe()) {
    return <NativeTabLayout />;
  }
  return <ClassicTabLayout />;
}
