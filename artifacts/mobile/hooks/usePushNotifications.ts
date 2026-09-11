import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { useRouter } from "expo-router";
import { useAuth } from "@/context/AuthContext";
import { getApiUrl } from "@/lib/apiConfig";
import { getPushFailureDiagnostic, inferExpoProjectId } from "@/lib/pushDiagnostics";

// Push notification registration was removed from Expo Go in SDK 53.
// Even *importing* `expo-notifications` on Android Expo Go logs a hard
// ERROR at module-load time and can crash the app. We therefore
// lazy-require the module and skip ALL push code in Expo Go. Native
// builds (EAS dev/preview/production) work normally.
const IS_EXPO_GO =
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

type EventSubscriptionLike = { remove: () => void };

export type PushNotificationStatus =
  | "checking"
  | "available"
  | "unavailable"
  | "not-applicable";

export function usePushNotifications(): PushNotificationStatus {
  const { user } = useAuth();
  const router = useRouter();
  const [status, setStatus] = useState<PushNotificationStatus>("checking");
  const notificationListener = useRef<EventSubscriptionLike | null>(null);
  const responseListener = useRef<EventSubscriptionLike | null>(null);

  useEffect(() => {
    if (!user) {
      setStatus("not-applicable");
      return;
    }
    if (IS_EXPO_GO || Platform.OS === "web") {
      // Push is an optional service. Surface its unavailable state instead of
      // pretending registration succeeded when this runtime cannot support it.
      setStatus("unavailable");
      return;
    }

    let cancelled = false;
    setStatus("checking");

    (async () => {
      // Lazy require so `expo-notifications` is never loaded in Expo Go.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Notifications = require("expo-notifications") as typeof import("expo-notifications");

      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowAlert: true,
          shouldPlaySound: true,
          shouldSetBadge: true,
          shouldShowBanner: true,
          shouldShowList: true,
        }),
      });

      // Register token and send to server
      try {
        const { status: existingStatus } = await Notifications.getPermissionsAsync();
        let finalStatus = existingStatus;
        if (existingStatus !== "granted") {
          const { status } = await Notifications.requestPermissionsAsync();
          finalStatus = status;
        }
        if (finalStatus !== "granted") {
          setStatus("unavailable");
          console.warn(
            "[push] registration unavailable",
            getPushFailureDiagnostic("permission"),
          );
          return;
        }

        const projectId = inferExpoProjectId(Constants);
        if (!projectId) {
          setStatus("unavailable");
          console.warn(
            "[push] registration unavailable",
            getPushFailureDiagnostic("project-id"),
          );
          return;
        }

        let token: { data?: string };
        try {
          token = await Notifications.getExpoPushTokenAsync({ projectId });
        } catch (error) {
          setStatus("unavailable");
          console.warn(
            "[push] registration unavailable",
            getPushFailureDiagnostic("token", error),
          );
          return;
        }
        const pushToken = token.data;
        if (cancelled || !pushToken) {
          setStatus("unavailable");
          return;
        }

        try {
          const AsyncStorage = (await import("@react-native-async-storage/async-storage")).default;
          const authToken = await AsyncStorage.getItem("auth_token");
          if (!authToken) {
            setStatus("unavailable");
            return;
          }
          const response = await fetch(getApiUrl("/users/me/push-token"), {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${authToken}`,
            },
            body: JSON.stringify({ token: pushToken }),
          });
          if (!response.ok) {
            setStatus("unavailable");
            console.warn(
              "[push] registration unavailable",
              getPushFailureDiagnostic("server", response.status),
            );
          } else {
            setStatus("available");
          }
        } catch {
          setStatus("unavailable");
          console.warn(
            "[push] registration unavailable",
            getPushFailureDiagnostic("server"),
          );
        }
      } catch {
        // Permission / token errors are non-fatal — app still works without push.
        setStatus("unavailable");
        console.warn(
          "[push] registration unavailable",
          getPushFailureDiagnostic("token"),
        );
        return;
      }

      if (cancelled) return;

      notificationListener.current = Notifications.addNotificationReceivedListener(() => {
        // Could update badge count or show in-app banner here
      });

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
    })().catch(() => {
      // Native module/listener setup can fail before token registration starts.
      // Keep push optional without allowing an unhandled startup rejection.
      setStatus("unavailable");
      console.warn("[push] registration unavailable", getPushFailureDiagnostic("native-setup"));
    });

    return () => {
      cancelled = true;
      notificationListener.current?.remove();
      responseListener.current?.remove();
    };
  }, [user, router]);

  return status;
}
