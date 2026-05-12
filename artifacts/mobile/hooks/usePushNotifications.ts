import { useEffect, useRef } from "react";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { useRouter } from "expo-router";
import { useAuth } from "@/context/AuthContext";

// Push notification registration was removed from Expo Go in SDK 53.
// Calling getExpoPushTokenAsync / addNotificationReceivedListener inside
// Expo Go throws hard on Android. Detect and no-op in that env so the app
// boots; native notification flow still works in dev/preview/production builds.
const IS_EXPO_GO =
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

if (!IS_EXPO_GO) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

async function registerForPushNotificationsAsync(): Promise<string | null> {
  if (Platform.OS === "web") return null;

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== "granted") return null;

  try {
    const token = await Notifications.getExpoPushTokenAsync();
    return token.data;
  } catch {
    return null;
  }
}

export function usePushNotifications() {
  const { user } = useAuth();
  const router = useRouter();
  const notificationListener = useRef<Notifications.EventSubscription | null>(null);
  const responseListener = useRef<Notifications.EventSubscription | null>(null);

  useEffect(() => {
    if (!user) return;
    if (IS_EXPO_GO) return; // skip in Expo Go (push removed in SDK 53)

    // Register token and send to server
    registerForPushNotificationsAsync().then(async (pushToken) => {
      if (!pushToken) return;
      try {
        const AsyncStorage = (await import("@react-native-async-storage/async-storage")).default;
        const authToken = await AsyncStorage.getItem("auth_token");
        if (!authToken) return;
        const domain = process.env.EXPO_PUBLIC_DOMAIN;
        await fetch(`https://${domain}/api/users/me/push-token`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${authToken}`,
          },
          body: JSON.stringify({ token: pushToken }),
        });
      } catch {
        // Non-fatal
      }
    });

    // Listen for incoming notifications while app is foregrounded
    notificationListener.current = Notifications.addNotificationReceivedListener(() => {
      // Could update badge count or show in-app banner here
    });

    // Handle notification tap — navigate to the relevant screen
    responseListener.current = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as Record<string, unknown>;
      const jobId = data?.jobId;
      const screen = data?.screen;
      if (jobId && screen === "job") {
        router.push(`/job/${jobId}`);
      } else if (screen === "available") {
        if (user.role === "mechanic") {
          router.push("/(mechanic)/available");
        }
      }
    });

    return () => {
      notificationListener.current?.remove();
      responseListener.current?.remove();
    };
  }, [user]);
}
