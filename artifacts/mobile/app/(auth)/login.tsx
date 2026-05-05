import { View, Text, Pressable, TextInput, StyleSheet, ActivityIndicator } from "react-native";
import { Link } from "expo-router";
import { useState } from "react";
import { useLogin } from "@workspace/api-client-react";
import { useAuth } from "@/context/AuthContext";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const loginMutation = useLogin();
  const { login } = useAuth();
  const insets = useSafeAreaInsets();
  const colors = useColors();

  const handleLogin = () => {
    if (!email || !password) return;
    
    loginMutation.mutate(
      { data: { email, password } },
      {
        onSuccess: async (data) => {
          await login(data.user, data.token);
        },
        onError: (err) => {
          console.error("Login failed", err);
        }
      }
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <KeyboardAwareScrollViewCompat
        contentContainerStyle={{
          paddingTop: insets.top + 40,
          paddingBottom: insets.bottom + 20,
          paddingHorizontal: 24,
        }}
        bottomOffset={20}
      >
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.foreground }]}>APS</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>Automotive Platform System</Text>
        </View>

        <View style={styles.form}>
          <Text style={[styles.label, { color: colors.foreground }]}>Email</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.card, color: colors.cardForeground, borderColor: colors.border }]}
            placeholder="Enter your email"
            placeholderTextColor={colors.mutedForeground}
            keyboardType="email-address"
            autoCapitalize="none"
            value={email}
            onChangeText={setEmail}
          />

          <Text style={[styles.label, { color: colors.foreground }]}>Password</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.card, color: colors.cardForeground, borderColor: colors.border }]}
            placeholder="Enter your password"
            placeholderTextColor={colors.mutedForeground}
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />

          {loginMutation.isError && (
            <Text style={[styles.error, { color: colors.destructive }]}>
              {loginMutation.error?.message || "Login failed. Please check your credentials."}
            </Text>
          )}

          <Pressable 
            style={[styles.button, { backgroundColor: colors.primary }]} 
            onPress={handleLogin}
            disabled={loginMutation.isPending}
          >
            {loginMutation.isPending ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>Sign In</Text>
            )}
          </Pressable>
        </View>

        <View style={styles.footer}>
          <Text style={[styles.footerText, { color: colors.mutedForeground }]}>Don't have an account?</Text>
          <Link href="/(auth)/register" asChild>
            <Pressable>
              <Text style={[styles.link, { color: colors.primary }]}>Sign Up</Text>
            </Pressable>
          </Link>
        </View>

        <View style={styles.adminRow}>
          <Link href="/(auth)/admin-setup" asChild>
            <Pressable>
              <Text style={[styles.adminLink, { color: colors.mutedForeground }]}>Admin Setup</Text>
            </Pressable>
          </Link>
        </View>
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { alignItems: "center", marginBottom: 48, marginTop: 24 },
  title: { fontSize: 48, fontWeight: "800", letterSpacing: -1 },
  subtitle: { fontSize: 16, fontWeight: "500", marginTop: 8 },
  form: { gap: 16 },
  label: { fontSize: 14, fontWeight: "600", marginBottom: -8 },
  input: {
    height: 52,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 16,
  },
  button: {
    height: 52,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 16,
  },
  buttonText: { fontSize: 16, fontWeight: "700" },
  error: { fontSize: 14, marginTop: 8 },
  footer: {
    flexDirection: "row",
    justifyContent: "center",
    marginTop: 48,
    gap: 8,
  },
  footerText: { fontSize: 14 },
  link: { fontSize: 14, fontWeight: "600" },
  adminRow: { alignItems: "center", marginTop: 20 },
  adminLink: { fontSize: 12 },
});
