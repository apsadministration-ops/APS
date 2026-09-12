import { useFocusEffect } from "expo-router";
import { useCallback, useState, type ReactElement } from "react";
import { StyleSheet, View } from "react-native";

import { partnerRouteAccessibilityProps } from "@/lib/partnerRouteAccessibility";

type Props = {
  children: ReactElement;
};

export function PartnerFocusedScreenBoundary({ children }: Props) {
  const [isFocused, setIsFocused] = useState(false);

  useFocusEffect(
    useCallback(() => {
      setIsFocused(true);
      return () => setIsFocused(false);
    }, []),
  );

  return (
    <View
      style={[styles.screen, !isFocused && styles.inactiveScreen]}
      {...partnerRouteAccessibilityProps(isFocused)}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  inactiveScreen: { display: "none" },
  screen: { flex: 1 },
});