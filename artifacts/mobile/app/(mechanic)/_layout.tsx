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
        <Label>Dashboard</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="available">
        <Icon sf={{ default: "list.bullet.clipboard", selected: "list.bullet.clipboard.fill" }} />
        <Label>Available</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="active">
        <Icon sf={{ default: "play.circle", selected: "play.circle.fill" }} />
        <Label>Active</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="history">
        <Icon sf={{ default: "clock", selected: "clock.fill" }} />
        <Label>History</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="profile">
        <Icon sf={{ default: "person.circle", selected: "person.circle.fill" }} />
        <Label>Profile</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="progression">
        <Icon sf={{ default: "chart.line.uptrend.xyaxis", selected: "chart.line.uptrend.xyaxis" }} />
        <Label>Tier</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="amplification" hidden>
        <Icon sf={{ default: "bolt", selected: "bolt.fill" }} />
        <Label>Amplification</Label>
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
          title: "Dashboard",
          tabBarIcon: ({ color }) =>
            <Feather name="home" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="available"
        options={{
          title: "Available",
          tabBarIcon: ({ color }) =>
            <Feather name="list" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="active"
        options={{
          title: "Active",
          tabBarIcon: ({ color }) =>
            <Feather name="play-circle" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: "History",
          tabBarIcon: ({ color }) =>
            <Feather name="clock" size={22} color={color} />,
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
      <Tabs.Screen
        name="progression"
        options={{
          title: "Tier",
          tabBarIcon: ({ color }) =>
            <Feather name="award" size={22} color={color} />,
        }}
      />
      {/* Keep the route addressable without creating a web <a> for a null href. */}
      <Tabs.Screen name="amplification" options={{ tabBarButton: () => null }} />
    </Tabs>
  );
}

export default function TabLayout() {
  const { user, isLoading } = useAuth();
  if (isLoading) return null;
  if (!user) return <Redirect href="/(auth)/login" />;
  if (user.role !== "mechanic") {
    return <Redirect href={getRoleDestination(user.role) ?? "/(auth)/login"} />;
  }
  if (isLiquidGlassAvailableSafe()) {
    return <NativeTabLayout />;
  }
  return <ClassicTabLayout />;
}
