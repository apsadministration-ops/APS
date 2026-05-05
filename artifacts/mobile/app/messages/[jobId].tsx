import {
  View, Text, StyleSheet, FlatList, TextInput, Pressable,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from "react-native";
import { useLocalSearchParams, Stack } from "expo-router";
import { useState, useEffect, useRef, useCallback } from "react";
import { useGetJob } from "@workspace/api-client-react";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";

interface ChatMessage {
  id: number;
  jobId: number;
  senderId: number;
  senderName: string;
  senderRole: string;
  content: string;
  createdAt: string;
}

function MessageBubble({ msg, isMe }: { msg: ChatMessage; isMe: boolean }) {
  const colors = useColors();
  const time = new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <View style={[styles.bubbleRow, isMe ? styles.bubbleRowMe : styles.bubbleRowThem]}>
      {!isMe && (
        <View style={[styles.avatar, { backgroundColor: colors.secondary }]}>
          <Text style={[styles.avatarText, { color: colors.secondaryForeground }]}>
            {msg.senderName.charAt(0).toUpperCase()}
          </Text>
        </View>
      )}
      <View style={styles.bubbleCol}>
        {!isMe && (
          <Text style={[styles.senderName, { color: colors.mutedForeground }]}>{msg.senderName}</Text>
        )}
        <View style={[
          styles.bubble,
          isMe
            ? { backgroundColor: colors.primary }
            : { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 },
        ]}>
          <Text style={[styles.bubbleText, { color: isMe ? "white" : colors.foreground }]}>
            {msg.content}
          </Text>
        </View>
        <Text style={[styles.timestamp, { color: colors.mutedForeground }]}>{time}</Text>
      </View>
    </View>
  );
}

export default function MessagesScreen() {
  const colors = useColors();
  const { user } = useAuth();
  const { jobId: rawId } = useLocalSearchParams<{ jobId: string }>();
  const jobId = parseInt(rawId, 10);
  const { data: job } = useGetJob(jobId, { query: { enabled: !!jobId } });

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const domain = process.env.EXPO_PUBLIC_DOMAIN;

  const fetchMessages = useCallback(async () => {
    try {
      const token = await AsyncStorage.getItem("auth_token");
      const res = await fetch(`https://${domain}/api/jobs/${jobId}/messages`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setMessages(data);
      }
    } catch { /* non-fatal */ }
    finally { setLoading(false); }
  }, [jobId, domain]);

  useEffect(() => {
    fetchMessages();
    pollingRef.current = setInterval(fetchMessages, 5000);
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, [fetchMessages]);

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages.length]);

  const sendMessage = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setDraft("");
    setSending(true);
    try {
      const token = await AsyncStorage.getItem("auth_token");
      const res = await fetch(`https://${domain}/api/jobs/${jobId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ content: text }),
      });
      if (res.ok) {
        const msg = await res.json();
        setMessages((prev) => [...prev, msg]);
      }
    } catch { /* non-fatal */ }
    finally { setSending(false); }
  };

  const otherName = user?.role === "customer" ? job?.mechanicName : job?.customerName;
  const title = otherName ? `Chat with ${otherName}` : "Job Chat";

  return (
    <>
      <Stack.Screen options={{
        title,
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.foreground,
        headerShown: true,
      }} />
      <KeyboardAvoidingView
        style={[styles.container, { backgroundColor: colors.background }]}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
      >
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : messages.length === 0 ? (
          <View style={styles.empty}>
            <View style={[styles.emptyIcon, { backgroundColor: colors.secondary }]}>
              <Feather name="message-circle" size={36} color={colors.mutedForeground} />
            </View>
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No messages yet</Text>
            <Text style={[styles.emptyDesc, { color: colors.mutedForeground }]}>
              Send the first message to start the conversation.
            </Text>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(m) => String(m.id)}
            renderItem={({ item }) => (
              <MessageBubble msg={item} isMe={item.senderId === user?.id} />
            )}
            contentContainerStyle={{ padding: 16, paddingBottom: 8 }}
            onLayout={() => listRef.current?.scrollToEnd({ animated: false })}
          />
        )}

        {/* Input bar */}
        <View style={[styles.inputBar, { backgroundColor: colors.background, borderTopColor: colors.border }]}>
          <TextInput
            style={[styles.input, { backgroundColor: colors.card, color: colors.foreground, borderColor: colors.border }]}
            placeholder="Type a message…"
            placeholderTextColor={colors.mutedForeground}
            value={draft}
            onChangeText={setDraft}
            multiline
            maxLength={1000}
            returnKeyType="default"
          />
          <Pressable
            style={[styles.sendBtn, { backgroundColor: draft.trim() ? colors.primary : colors.secondary }]}
            onPress={sendMessage}
            disabled={!draft.trim() || sending}
          >
            {sending
              ? <ActivityIndicator size="small" color="white" />
              : <Feather name="send" size={18} color={draft.trim() ? "white" : colors.mutedForeground} />}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 40 },
  emptyIcon: { width: 80, height: 80, borderRadius: 40, alignItems: "center", justifyContent: "center" },
  emptyTitle: { fontSize: 18, fontWeight: "700" },
  emptyDesc: { fontSize: 14, textAlign: "center", lineHeight: 22 },
  bubbleRow: { flexDirection: "row", marginBottom: 12, alignItems: "flex-end", gap: 8 },
  bubbleRowMe: { justifyContent: "flex-end" },
  bubbleRowThem: { justifyContent: "flex-start" },
  bubbleCol: { maxWidth: "75%", gap: 3 },
  avatar: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 14, fontWeight: "700" },
  senderName: { fontSize: 11, fontWeight: "600", marginLeft: 4 },
  bubble: { borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleText: { fontSize: 15, lineHeight: 22 },
  timestamp: { fontSize: 10, marginHorizontal: 4 },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
    padding: 12,
    paddingBottom: Platform.OS === "ios" ? 8 : 12,
    borderTopWidth: 1,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    maxHeight: 120,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
});
