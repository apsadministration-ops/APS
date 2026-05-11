/**
 * Cross-platform haptic feedback wrapper.
 *
 * - Native (iOS/Android): delegates to `expo-haptics`.
 * - Web / unsupported: no-op (never throws).
 *
 * Use these helpers throughout the app instead of importing `expo-haptics`
 * directly so we get one place to swap implementation, mute in tests, or
 * respect a "reduce motion / haptics off" user preference later.
 *
 *   import { tap, success, warning, error, selection } from "@/utils/haptics";
 *
 * Guidance:
 *   - tap:        non-destructive button press, navigation
 *   - selection:  picker / segmented control changes
 *   - success:    job accepted, payment captured, save confirmed
 *   - warning:    confirmation prompt, mild alert
 *   - error:      validation failure, server error
 */

import { Platform } from "react-native";
import * as Haptics from "expo-haptics";

const isNative = Platform.OS === "ios" || Platform.OS === "android";

function safe<T extends unknown[]>(fn: (...args: T) => Promise<unknown> | unknown) {
  return (...args: T): void => {
    if (!isNative) return;
    try {
      const r = fn(...args);
      if (r instanceof Promise) r.catch(() => undefined);
    } catch {
      // Haptics are best-effort UX; never let them break the UI.
    }
  };
}

export const tap        = safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
export const tapMedium  = safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
export const tapHeavy   = safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy));
export const selection  = safe(() => Haptics.selectionAsync());
export const success    = safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
export const warning    = safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));
export const error      = safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error));
