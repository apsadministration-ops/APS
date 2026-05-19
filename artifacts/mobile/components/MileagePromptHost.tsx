import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useColors } from "@/hooks/useColors";

type PromptState = {
  open: boolean;
  title: string;
  resolve: (v: string | null) => void;
};

export const AndroidMileagePrompt = (() => {
  let setter: ((p: PromptState) => void) | null = null;
  return {
    register(s: typeof setter) { setter = s; },
    show(title: string, resolve: (v: string | null) => void) {
      if (setter) setter({ open: true, title, resolve });
      else resolve(null);
    },
  };
})();

export function MileagePromptHost() {
  const colors = useColors();
  const [state, setState] = useState<PromptState>({ open: false, title: "", resolve: () => {} });
  const [val, setVal] = useState("");
  useEffect(() => { AndroidMileagePrompt.register(setState); }, []);
  if (!state.open) return null;
  const close = (v: string | null) => {
    state.resolve(v);
    setState({ open: false, title: "", resolve: () => {} });
    setVal("");
  };
  return (
    <View style={hostStyles.overlay}>
      <View style={[hostStyles.box, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[hostStyles.title, { color: colors.foreground }]}>{state.title}</Text>
        <TextInput
          style={[hostStyles.input, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
          value={val} onChangeText={setVal} keyboardType="number-pad" autoFocus
          placeholder="Whole miles" placeholderTextColor={colors.mutedForeground}
        />
        <View style={hostStyles.btnRow}>
          <Pressable
            style={[hostStyles.btn, { backgroundColor: colors.background, borderColor: colors.border, borderWidth: 1 }]}
            onPress={() => close(null)}>
            <Text style={{ color: colors.foreground, fontWeight: "700" }}>Cancel</Text>
          </Pressable>
          <Pressable style={[hostStyles.btn, { backgroundColor: colors.primary }]} onPress={() => close(val)}>
            <Text style={{ color: "white", fontWeight: "700" }}>OK</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const hostStyles = StyleSheet.create({
  overlay: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", zIndex: 999,
  },
  box: { width: "85%", maxWidth: 360, padding: 18, borderRadius: 14, borderWidth: 1, gap: 12 },
  title: { fontSize: 15, fontWeight: "700" },
  input: { height: 46, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, fontSize: 16 },
  btnRow: { flexDirection: "row", gap: 8 },
  btn: { flex: 1, height: 44, borderRadius: 10, alignItems: "center", justifyContent: "center" },
});
