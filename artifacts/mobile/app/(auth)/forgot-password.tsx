import { View, Text, Pressable, TextInput, StyleSheet, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { getApiUrl } from "@/lib/apiConfig";
import { classifyForgotPasswordResponse } from "@/lib/forgotPassword";

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const router = useRouter();

  const handleSubmit = async () => {
    if (!email.trim() || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(getApiUrl("/auth/forgot-password"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const outcome = classifyForgotPasswordResponse(res.status);
      if (outcome === "rate-limited") {
        setError("Too many requests. Please wait a few minutes and try again.");
      } else if (outcome === "success") {
        // Keep the response generic even when the account does not exist.
        setDone(true);
      } else {
        // Do not surface response bodies: they can disclose account details
        // and are not needed to explain a failed request.
        setError("We couldn't process that request. Please try again.");
      }
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
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
          <Text style={[styles.title, { color: colors.foreground }]}>Reset password</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            Enter your email and we'll send you a link to choose a new one.
          </Text>
        </View>

        {done ? (
          <View style={[styles.notice, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.noticeTitle, { color: colors.foreground }]}>Check your email</Text>
            <Text style={[styles.noticeBody, { color: colors.mutedForeground }]}>
              If an account exists for{" "}
              <Text style={{ color: colors.foreground, fontWeight: "600" }}>{email.trim()}</Text>, you'll
              get a reset link within a minute. The link expires in 1 hour.
            </Text>
            <Pressable
              style={[styles.button, { backgroundColor: colors.primary, marginTop: 20 }]}
              onPress={() => router.replace("/(auth)/login")}
            >
              <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>Back to sign in</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.form}>
            <Text style={[styles.label, { color: colors.foreground }]}>Email</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.card, color: colors.cardForeground, borderColor: colors.border }]}
              placeholder="you@example.com"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              value={email}
              onChangeText={setEmail}
              editable={!submitting}
            />

            {error && (
              <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text>
            )}

            <Pressable
              style={[styles.button, { backgroundColor: colors.primary, opacity: submitting ? 0.7 : 1 }]}
              onPress={handleSubmit}
              disabled={submitting}
            >
              {submitting ? (
                <ActivityIndicator color={colors.primaryForeground} />
              ) : (
                <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>Send reset link</Text>
              )}
            </Pressable>

            <Pressable style={styles.backRow} onPress={() => router.back()}>
              <Text style={[styles.link, { color: colors.primary }]}>Back to sign in</Text>
            </Pressable>
          </View>
        )}
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { marginBottom: 32, marginTop: 8 },
  title: { fontSize: 28, fontWeight: "800", letterSpacing: -0.5 },
  subtitle: { fontSize: 15, marginTop: 8, lineHeight: 22 },
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
  backRow: { alignItems: "center", marginTop: 20 },
  link: { fontSize: 14, fontWeight: "600" },
  notice: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 20,
  },
  noticeTitle: { fontSize: 18, fontWeight: "700", marginBottom: 8 },
  noticeBody: { fontSize: 14, lineHeight: 21 },
});
