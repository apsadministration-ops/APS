import { BlurView } from "expo-blur";
import { Redirect, Tabs } from "expo-router";
import { Feather } from "@expo/vector-icons";
import React from "react";
import { Platform, StyleSheet, View, useColorScheme } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { getRoleDestination } from "@/lib/roleDestination";

export default function ShopOwnerTabLayout() {
  const { user, isLoading } = useAuth();
  const colors = useColors();
  const colorScheme = useColorScheme();
  const insets = useSafeAreaInsets();
  const isDark = colorScheme === "dark";
  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";

  if (isLoading) return null;
  if (!user) return <Redirect href="/(auth)/login" />;
  if (user.role !== "shop_owner") {
    return <Redirect href={getRoleDestination(user.role) ?? "/(auth)/login"} />;
  }

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        headerShown: true,
        headerStyle: { backgroundColor: colors.background },
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
            <BlurView intensity={100} tint={isDark ? "dark" : "light"} style={StyleSheet.absoluteFill} />
          ) : isWeb ? (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]} />
          ) : null,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Locations",
          tabBarIcon: ({ color }) => <Feather name="home" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="vehicles"
        options={{
          title: "Vehicles",
          tabBarIcon: ({ color }) => <Feather name="truck" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="post-job"
        options={{
          title: "Post Job",
          tabBarIcon: ({ color }) => <Feather name="plus-square" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="invoices"
        options={{
          title: "Invoices",
          tabBarIcon: ({ color }) => <Feather name="file-text" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="bookings"
        options={{
          title: "Bookings",
          // Keep the route addressable without creating a web <a> for a null href.
          tabBarButton: () => null,
          tabBarIcon: ({ color }) => <Feather name="calendar" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color }) => <Feather name="user" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="organizations"
        options={{
          title: "Organizations",
          // Keep organization management reachable from Profile without adding
          // another primary tab to the existing shop-owner workflow.
          tabBarButton: () => null,
          tabBarIcon: ({ color }) => <Feather name="briefcase" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="partner-vehicles"
        options={{
          title: "Partner operations",
          // The selected organization card is the intentional entry point.
          // Keep the existing Vehicles tab and its legacy workflow unchanged.
          tabBarButton: () => null,
          tabBarIcon: ({ color }) => <Feather name="truck" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="service-requests"
        options={{
          title: "Service requests",
          // The nested Stack owns list/new/detail headers; this parent route
          // remains a hidden tab container rather than a second header/tab.
          headerShown: false,
          // The dashboard card is the intentional entry point for this
          // organization-scoped workflow; keep the existing tabs unchanged.
          tabBarButton: () => null,
          tabBarIcon: ({ color }) => <Feather name="clipboard" size={22} color={color} />,
        }}
      />
    </Tabs>
  );
}
