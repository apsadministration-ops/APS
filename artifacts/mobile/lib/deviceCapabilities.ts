import { Linking, Platform } from "react-native";

export type CapabilityFailureReason =
  | "permission-denied"
  | "unavailable"
  | "error";

export type CapabilityResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      reason: CapabilityFailureReason;
      message: string;
      canAskAgain: boolean;
    };

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface LocationSubscriptionLike {
  remove: () => void;
}

export interface ForegroundLocationWatchOptions {
  distanceInterval?: number;
  timeInterval?: number;
}

const LOCATION_OPERATION_TIMEOUT_MS = 15_000;

function failure(
  reason: CapabilityFailureReason,
  message: string,
  canAskAgain = false,
): CapabilityResult<never> {
  return { ok: false, reason, message, canAskAgain };
}

/**
 * Native location calls can wait indefinitely when a provider is disabled or
 * a system permission dialog never settles. Keep screens responsive, and if a
 * watch subscription resolves after its timeout, remove it immediately so a
 * late native result cannot leak a live watcher.
 */
function withLocationTimeout<T>(
  operation: Promise<T>,
  timeoutMessage: string,
  onLateValue?: (value: T) => void,
): Promise<T> {
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const trackedOperation = operation.then((value) => {
    if (timedOut) {
      try {
        onLateValue?.(value);
      } catch {
        // Cleanup is best effort if a native subscription is already closed.
      }
    }
    return value;
  });
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      reject(new Error(timeoutMessage));
    }, LOCATION_OPERATION_TIMEOUT_MS);
  });

  return Promise.race([trackedOperation, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * Request foreground location only from a native runtime. Web uses the
 * browser geolocation API instead, so importing expo-location is avoided
 * there. This also gives screens one explicit permission-denied state to
 * render instead of silently submitting an unlocated job.
 */
export async function requestForegroundLocationPermission(): Promise<
  CapabilityResult<void>
> {
  if (Platform.OS === "web") {
    return { ok: true, value: undefined };
  }

  try {
    const Location = await import("expo-location");
    let permission = await withLocationTimeout(
      Location.getForegroundPermissionsAsync(),
      "Location permission check timed out.",
    );
    if (!permission.granted) {
      permission = await withLocationTimeout(
        Location.requestForegroundPermissionsAsync(),
        "Location permission request timed out.",
      );
    }

    if (!permission.granted) {
      return failure(
        "permission-denied",
        permission.canAskAgain
          ? "Location permission is needed to use your current position. You can allow it and try again."
          : "Location permission is disabled. Enable location access in device settings, or enter an address instead.",
        permission.canAskAgain,
      );
    }

    return { ok: true, value: undefined };
  } catch {
    return failure(
      "unavailable",
      "Location services are unavailable on this device. Enter an address or ZIP code instead.",
    );
  }
}

export async function getCurrentLocation(): Promise<CapabilityResult<Coordinates>> {
  if (Platform.OS === "web") {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      return failure(
        "unavailable",
        "This browser does not provide location services. Enter an address or ZIP code instead.",
      );
    }

    return await new Promise<CapabilityResult<Coordinates>>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (position) =>
          resolve({
            ok: true,
            value: {
              lat: position.coords.latitude,
              lng: position.coords.longitude,
            },
          }),
        () =>
          resolve(
            failure(
              "permission-denied",
              "Browser location is unavailable. Allow location access or enter an address instead.",
              false,
            ),
          ),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
      );
    });
  }

  const permission = await requestForegroundLocationPermission();
  if (!permission.ok) return permission;

  try {
    const Location = await import("expo-location");
    const location = await withLocationTimeout(
      Location.getCurrentPositionAsync({}),
      "Current location request timed out.",
    );
    return {
      ok: true,
      value: {
        lat: location.coords.latitude,
        lng: location.coords.longitude,
      },
    };
  } catch {
    return failure(
      "unavailable",
      "Your device could not provide a current position. Enter an address or ZIP code instead.",
    );
  }
}

/**
 * Watch location for active-job tracking. The watch is intentionally
 * foreground-only; background tracking needs a separate, justified native
 * build permission flow and is not silently substituted here.
 */
export async function watchForegroundLocation(
  onLocation: (coords: { latitude: number; longitude: number }) => void,
  options: ForegroundLocationWatchOptions = {},
): Promise<CapabilityResult<LocationSubscriptionLike>> {
  if (Platform.OS === "web") {
    return failure(
      "unavailable",
      "Live location sharing is unavailable in this browser. You can still update the job manually.",
    );
  }

  const permission = await requestForegroundLocationPermission();
  if (!permission.ok) return permission;

  try {
    const Location = await import("expo-location");
    const subscription = await withLocationTimeout(
      Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: options.timeInterval ?? 15000,
          distanceInterval: options.distanceInterval ?? 20,
        },
        (location) => {
          onLocation({
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
          });
        },
      ),
      "Live location setup timed out.",
      (lateSubscription) => lateSubscription.remove(),
    );
    return { ok: true, value: subscription };
  } catch {
    return failure(
      "unavailable",
      "Live location sharing is unavailable right now. You can still update the job manually.",
    );
  }
}

export type ImageLibraryResult =
  | { status: "selected"; uris: string[] }
  | { status: "cancelled" }
  | {
      status: "unavailable";
      message: string;
      canAskAgain: boolean;
    };

/**
 * Open the real device photo picker after checking its permission. The
 * dynamic import keeps web and Expo Go startup independent from native module
 * initialization; a permission denial is returned to the screen for visible
 * recovery UI rather than being treated as an empty/successful selection.
 */
export async function pickImageLibrary(): Promise<ImageLibraryResult> {
  try {
    const ImagePicker = await import("expo-image-picker");

    if (Platform.OS !== "web") {
      let permission = await ImagePicker.getMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      }
      if (!permission.granted) {
        return {
          status: "unavailable",
          message: permission.canAskAgain
            ? "Photo access is needed to attach images. Allow access and try again."
            : "Photo access is disabled. Enable photo access in device settings to attach images.",
          canAskAgain: permission.canAskAgain,
        };
      }
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      quality: 0.8,
    });

    if (result.canceled) return { status: "cancelled" };
    return {
      status: "selected",
      uris: result.assets.map((asset) => asset.uri),
    };
  } catch {
    return {
      status: "unavailable",
      message:
        "The photo picker is unavailable right now. You can continue without attaching photos.",
      canAskAgain: false,
    };
  }
}

export async function openAppSettings(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  try {
    await Linking.openSettings();
    return true;
  } catch {
    return false;
  }
}