import { Alert, Platform } from "react-native";

export type ConfirmOptions = {
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
};

export function confirm(opts: ConfirmOptions): Promise<boolean> {
  const { title, message, confirmText = "OK", cancelText = "Cancel", destructive } = opts;
  return new Promise((resolve) => {
    if (Platform.OS === "web") {
      if (typeof window === "undefined") {
        resolve(false);
        return;
      }
      const text = message ? `${title}\n\n${message}` : title;
      resolve(window.confirm(text));
      return;
    }
    Alert.alert(
      title,
      message,
      [
        { text: cancelText, style: "cancel", onPress: () => resolve(false) },
        {
          text: confirmText,
          style: destructive ? "destructive" : "default",
          onPress: () => resolve(true),
        },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

export function alertMessage(title: string, message?: string): Promise<void> {
  return new Promise((resolve) => {
    if (Platform.OS === "web") {
      if (typeof window === "undefined") {
        resolve();
        return;
      }
      window.alert(message ? `${title}\n\n${message}` : title);
      resolve();
      return;
    }
    Alert.alert(title, message, [{ text: "OK", onPress: () => resolve() }], {
      cancelable: true,
      onDismiss: () => resolve(),
    });
  });
}
