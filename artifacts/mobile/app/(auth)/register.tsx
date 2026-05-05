import { View, Text, Pressable, TextInput, StyleSheet, ActivityIndicator } from "react-native";
import { Link } from "expo-router";
import { useState } from "react";
import { useRegister, RegisterBodyRole } from "@workspace/api-client-react";
import { useAuth } from "@/context/AuthContext";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";

export default function RegisterScreen() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<RegisterBodyRole>("customer");
  
  const registerMutation = useRegister();
  const { login } = useAuth();
  const insets = useSafeAreaInsets();
  const colors = useColors();

  const handleRegister = () => {
    if (!email || !password || !name) return;
    
    registerMutation.mutate(
      { data: { name, email, password, role } },
      {
        onSuccess: async (data) => {
          await login(data.user, data.token);
        },
        onError: (err) => {
          console.error("Registration failed", err);
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
          <Text style={[styles.title, { color: colors.foreground }]}>Create Account</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>Join APS today</Text>
        </View>

        <View style={styles.form}>
          <Text style={[styles.label, { color: colors.foreground }]}>I am a...</Text>
          <View style={styles.roleContainer}>
            <Pressable 
              style={[
                styles.roleButton, 
                { backgroundColor: role === "customer" ? colors.primary : colors.card, borderColor: colors.border }
              ]} 
              onPress={() => setRole("customer")}
            >
              <Text style={[styles.roleText, { color: role === "customer" ? colors.primaryForeground : colors.foreground }]}>Customer</Text>
            </Pressable>
            <Pressable 
              style={[
                styles.roleButton, 
                { backgroundColor: role === "mechanic" ? colors.primary : colors.card, borderColor: colors.border }
              ]} 
              onPress={() => setRole("mechanic")}
            >
              <Text style={[styles.roleText, { color: role === "mechanic" ? colors.primaryForeground : colors.foreground }]}>Mechanic</Text>
            </Pressable>
          </View>

          <Text style={[styles.label, { color: colors.foreground }]}>Full Name</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.card, color: colors.cardForeground, borderColor: colors.border }]}
            placeholder="John Doe"
            placeholderTextColor={colors.mutedForeground}
            value={name}
            onChangeText={setName}
          />

          <Text style={[styles.label, { color: colors.foreground }]}>Email</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.card, color: colors.cardForeground, borderColor: colors.border }]}
            placeholder="john@example.com"
            placeholderTextColor={colors.mutedForeground}
            keyboardType="email-address"
            autoCapitalize="none"
            value={email}
            onChangeText={setEmail}
          />

          <Text style={[styles.label, { color: colors.foreground }]}>Password</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.card, color: colors.cardForeground, borderColor: colors.border }]}
            placeholder="Create a secure password"
            placeholderTextColor={colors.mutedForeground}
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />

          {registerMutation.isError && (
            <Text style={[styles.error, { color: colors.destructive }]}>
              {registerMutation.error?.message || "Registration failed. Please try again."}
            </Text>
          )}

          <Pressable 
            style={[styles.button, { backgroundColor: colors.primary }]} 
            onPress={handleRegister}
            disabled={registerMutation.isPending}
          >
            {registerMutation.isPending ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>Sign Up</Text>
            )}
          </Pressable>
        </View>

        <View style={styles.footer}>
          <Text style={[styles.footerText, { color: colors.mutedForeground }]}>Already have an account?</Text>
          <Link href="/(auth)/login" asChild>
            <Pressable>
              <Text style={[styles.link, { color: colors.primary }]}>Sign In</Text>
            </Pressable>
          </Link>
        </View>
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { alignItems: "center", marginBottom: 32, marginTop: 12 },
  title: { fontSize: 32, fontWeight: "700" },
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
  roleContainer: {
    flexDirection: "row",
    gap: 12,
  },
  roleButton: {
    flex: 1,
    height: 48,
    borderWidth: 1,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  roleText: {
    fontSize: 15,
    fontWeight: "600",
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
    marginTop: 32,
    gap: 8,
  },
  footerText: { fontSize: 14 },
  link: { fontSize: 14, fontWeight: "600" },
});
