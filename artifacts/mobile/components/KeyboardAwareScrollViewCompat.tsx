import type { KeyboardAwareScrollViewProps } from "react-native-keyboard-controller";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ScrollViewProps,
} from "react-native";
import { IS_EXPO_GO } from "@/lib/isExpoGo";

type Props = KeyboardAwareScrollViewProps & ScrollViewProps;

export function KeyboardAwareScrollViewCompat({
  children,
  keyboardShouldPersistTaps = "handled",
  ...props
}: Props) {
  // Web: react-native-keyboard-controller isn't needed; a plain ScrollView has
  // always been used here.
  if (Platform.OS === "web") {
    return (
      <ScrollView keyboardShouldPersistTaps={keyboardShouldPersistTaps} {...props}>
        {children}
      </ScrollView>
    );
  }

  // Expo Go: the keyboard-controller native module isn't bundled, so fall back
  // to React Native's built-in KeyboardAvoidingView. Real iOS/Android builds
  // (below) use the full library for the polished experience.
  if (IS_EXPO_GO) {
    return (
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView keyboardShouldPersistTaps={keyboardShouldPersistTaps} {...props}>
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // Native custom/store build: use the full keyboard-controller experience.
  // Lazy require so the native module is never loaded in Expo Go.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { KeyboardAwareScrollView } = require("react-native-keyboard-controller");
  return (
    <KeyboardAwareScrollView keyboardShouldPersistTaps={keyboardShouldPersistTaps} {...props}>
      {children}
    </KeyboardAwareScrollView>
  );
}
