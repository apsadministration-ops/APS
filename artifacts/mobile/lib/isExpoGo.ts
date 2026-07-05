import Constants, { ExecutionEnvironment } from "expo-constants";

/**
 * True when the app is running inside the Expo Go sandbox app (as opposed to a
 * custom dev/preview/production build, or the web bundle).
 *
 * Libraries that ship their own native code — e.g. react-native-keyboard-controller —
 * are NOT bundled into Expo Go, so importing or mounting them there crashes the
 * app to a white screen. Guard any such usage with this flag and fall back to a
 * pure-JS / built-in alternative when it is true. Real store builds are
 * unaffected and use the full native library.
 */
export const IS_EXPO_GO =
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
