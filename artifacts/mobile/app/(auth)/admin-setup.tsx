import {
  View, Text, Pressable, TextInput, StyleSheet, ActivityIndicator, Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";

export default function AdminSetupScreen() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [setupKey, setSetupKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const { login } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const domain = process.env.EXPO_PUBLIC_DOMAIN;

  const handleCreate = async () => {
    if (!name || !email || !password || !setupKey) {
      setError("All fields are required.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`https://${domain}/api/auth/admin-setup`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-setup-key": setupKey,
        },
        body: JSON.stringify({ name, email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to create admin account.");
        return;
      }
      await login(data.user, data.token);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <KeyboardAwareScrollViewCompat
        contentContainerStyle={{
          paddingTop: insets.top + 24,
          paddingBottom: insets.bottom + 20,
          paddingHorizontal: 24,
        }}
        bottomOffset={20}
      >
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={20} color={colors.primary} />
          <Text style={[styles.backText, { color: colors.primary }]}>Back to Login</Text>
        </Pressable>

        <View style={[styles.badge, { backgroundColor: colors.primary + "18" }]}>
          <Feather name="shield" size={32} color={colors.primary} />
        </View>

        <Text style={[styles.title, { color: colors.foreground }]}>Admin Setup</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          Create the platform administrator account. Requires the admin setup key.
        </Text>

        <View style={[styles.keyBox, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
          <Feather name="key" size={14} color={colors.mutedForeground} />
          <Text style={[styles.keyNote, { color: colors.mutedForeground }]}>
            The default setup key is{" "}
            <Text style={[styles.keyCode, { color: colors.primary }]}>aps-admin-setup</Text>
            {" "}— change it by setting{" "}
            <Text style={[styles.keyCode, { color: colors.primary }]}>ADMIN_SETUP_KEY</Text>
            {" "}in environment variables.
          </Text>
        </View>

        <View style={styles.form}>
          <Text style={[styles.label, { color: colors.foreground }]}>Setup Key</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.card, color: colors.foreground, borderColor: colors.primary }]}
            placeholder="Enter the admin setup key"
            placeholderTextColor={colors.mutedForeground}
            value={setupKey}
            onChangeText={setSetupKey}
            autoCapitalize="none"
            autoCorrect={false}
          />

          <Text style={[styles.label, { color: colors.foreground }]}>Full Name</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.card, color: colors.foreground, borderColor: colors.border }]}
            placeholder="Admin Name"
            placeholderTextColor={colors.mutedForeground}
            value={name}
            onChangeText={setName}
          />

          <Text style={[styles.label, { color: colors.foreground }]}>Email</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.card, color: colors.foreground, borderColor: colors.border }]}
            placeholder="admin@example.com"
            placeholderTextColor={colors.mutedForeground}
            keyboardType="email-address"
            autoCapitalize="none"
            value={email}
            onChangeText={setEmail}
          />

          <Text style={[styles.label, { color: colors.foreground }]}>Password</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.card, color: colors.foreground, borderColor: colors.border }]}
            placeholder="Strong password"
            placeholderTextColor={colors.mutedForeground}
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />

          {error ? <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}

          <Pressable
            style={[styles.button, { backgroundColor: colors.primary }]}
            onPress={handleCreate}
            disabled={loading}
          >
            {loading
              ? <ActivityIndicator color="white" />
              : <>
                <Feather name="shield" size={16} color="white" />
                <Text style={styles.buttonText}>Create Admin Account</Text>
              </>}
          </Pressable>
        </View>
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  backBtn: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 24 },
  backText: { fontSize: 15, fontWeight: "600" },
  badge: {
    width: 68,
    height: 68,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  title: { fontSize: 28, fontWeight: "800", marginBottom: 8 },
  subtitle: { fontSize: 14, lineHeight: 22, marginBottom: 20 },
  keyBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 24,
  },
  keyNote: { flex: 1, fontSize: 13, lineHeight: 20 },
  keyCode: { fontFamily: "monospace", fontWeight: "700" },
  form: { gap: 14 },
  label: { fontSize: 14, fontWeight: "600", marginBottom: -6 },
  input: {
    height: 52,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 16,
  },
  error: { fontSize: 14 },
  button: {
    height: 52,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 10,
    marginTop: 8,
  },
  buttonText: { fontSize: 16, fontWeight: "700", color: "white" },
});
