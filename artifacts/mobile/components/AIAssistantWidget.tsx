import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { useGlobalSearchParams, useSegments } from "expo-router";
import {
  Gesture,
  GestureDetector,
} from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { assistantChat } from "@workspace/api-client-react";

type Role = "user" | "assistant";
interface ChatMessage {
  role: Role;
  content: string;
  urgency?: "low" | "medium" | "high" | null;
}

const BUBBLE_SIZE = 56;
const POSITION_KEY = "aps_assistant_pos_v1";
const VISIBLE_KEY = "aps_assistant_visible_v1";

interface DerivedContext {
  screen: string;
  vehicleId: number | null;
  jobId: number | null;
}

function useScreenContext(): DerivedContext {
  const segments = useSegments();
  const params = useGlobalSearchParams<{
    id?: string;
    vehicleId?: string;
    jobId?: string;
  }>();

  return useMemo(() => {
    const last = segments[segments.length - 1] ?? "";
    const screen = segments.filter((s) => !s.startsWith("(")).join("/") || "home";

    let vehicleId: number | null = null;
    let jobId: number | null = null;

    const idNum = params.id ? Number(params.id) : null;
    const vId = params.vehicleId ? Number(params.vehicleId) : null;
    const jId = params.jobId ? Number(params.jobId) : null;

    if (vId != null && !Number.isNaN(vId)) vehicleId = vId;
    if (jId != null && !Number.isNaN(jId)) jobId = jId;

    if (idNum != null && !Number.isNaN(idNum)) {
      // Disambiguate /vehicle/[id] vs /job/[id] by segment name.
      const segs = segments as readonly string[];
      if (segs.includes("vehicle")) vehicleId = idNum;
      else if (segs.includes("job")) jobId = idNum;
    }

    return { screen: screen || last || "home", vehicleId, jobId };
  }, [segments, params.id, params.vehicleId, params.jobId]);
}

function contextualPrompts(ctx: DerivedContext): string[] {
  if (ctx.jobId) {
    return [
      "Why do I need this repair?",
      "Is this urgent?",
      "Explain the parts in this job",
    ];
  }
  if (ctx.vehicleId) {
    return [
      "Summarize this vehicle's service history",
      "What maintenance is coming up?",
      "Any recurring issues on this VIN?",
    ];
  }
  return [
    "What is a CV axle?",
    "Why do brake pads wear out?",
    "How do I know if my struts are bad?",
  ];
}

function urgencyColor(urgency: ChatMessage["urgency"]): string | null {
  if (urgency === "high") return "#DC2626";
  if (urgency === "medium") return "#D97706";
  if (urgency === "low") return "#16A34A";
  return null;
}

export default function AIAssistantWidget() {
  const colors = useColors();
  const { user } = useAuth();
  const { width: winW, height: winH } = useWindowDimensions();
  const ctx = useScreenContext();

  const [expanded, setExpanded] = useState(false);
  const [visible, setVisible] = useState(true);
  const [hydrated, setHydrated] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<ScrollView | null>(null);

  // Position of the bubble (top-left). Default: bottom-right corner with margin.
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);

  // Hydrate position + visibility from AsyncStorage
  useEffect(() => {
    (async () => {
      try {
        const [posRaw, visRaw] = await Promise.all([
          AsyncStorage.getItem(POSITION_KEY),
          AsyncStorage.getItem(VISIBLE_KEY),
        ]);
        if (posRaw) {
          const { x, y } = JSON.parse(posRaw);
          if (typeof x === "number" && typeof y === "number") {
            tx.value = x;
            ty.value = y;
          } else {
            tx.value = winW - BUBBLE_SIZE - 16;
            ty.value = winH - BUBBLE_SIZE - 120;
          }
        } else {
          tx.value = winW - BUBBLE_SIZE - 16;
          ty.value = winH - BUBBLE_SIZE - 120;
        }
        if (visRaw === "false") setVisible(false);
      } catch {
        tx.value = winW - BUBBLE_SIZE - 16;
        ty.value = winH - BUBBLE_SIZE - 120;
      } finally {
        setHydrated(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-clamp position if the window resizes
  useEffect(() => {
    if (!hydrated) return;
    tx.value = Math.max(8, Math.min(tx.value, winW - BUBBLE_SIZE - 8));
    ty.value = Math.max(8, Math.min(ty.value, winH - BUBBLE_SIZE - 8));
  }, [winW, winH, hydrated, tx, ty]);

  const persistPosition = useCallback((x: number, y: number) => {
    AsyncStorage.setItem(POSITION_KEY, JSON.stringify({ x, y })).catch(() => {});
  }, []);

  const persistVisible = useCallback((v: boolean) => {
    AsyncStorage.setItem(VISIBLE_KEY, v ? "true" : "false").catch(() => {});
  }, []);

  const startX = useSharedValue(0);
  const startY = useSharedValue(0);

  const toggleExpanded = useCallback(() => {
    setExpanded((e) => !e);
  }, []);

  const composedGesture = useMemo(() => {
    const pan = Gesture.Pan()
      .minDistance(8)
      .onStart(() => {
        startX.value = tx.value;
        startY.value = ty.value;
      })
      .onUpdate((e) => {
        tx.value = startX.value + e.translationX;
        ty.value = startY.value + e.translationY;
      })
      .onEnd(() => {
        // Snap to nearest horizontal edge
        const snapLeft = 8;
        const snapRight = winW - BUBBLE_SIZE - 8;
        const target =
          tx.value + BUBBLE_SIZE / 2 < winW / 2 ? snapLeft : snapRight;
        tx.value = withSpring(target, { damping: 18, stiffness: 180 });
        ty.value = withSpring(
          Math.max(8, Math.min(ty.value, winH - BUBBLE_SIZE - 8)),
          { damping: 18, stiffness: 180 },
        );
        runOnJS(persistPosition)(target, ty.value);
      });

    // Tap fires the toggle. Use Race so a small movement starts a pan
    // instead of registering as a tap. On Android this is required
    // because <Pressable> swallows touches before GestureDetector sees
    // them — composing Tap + Pan inside GestureDetector fixes drag.
    const tap = Gesture.Tap().maxDistance(8).onEnd((_e, success) => {
      if (success) runOnJS(toggleExpanded)();
    });

    return Gesture.Race(pan, tap);
  }, [winW, winH, persistPosition, tx, ty, startX, startY, toggleExpanded]);

  const bubbleStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }],
  }));

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || sending) return;

      const userMsg: ChatMessage = { role: "user", content: trimmed };
      const history = messages.map((m) => ({ role: m.role, content: m.content }));
      setMessages((prev) => [...prev, userMsg]);
      setInput("");
      setSending(true);

      try {
        const result = await assistantChat({
          message: trimmed,
          history,
          context: {
            screen: ctx.screen,
            vehicleId: ctx.vehicleId,
            jobId: ctx.jobId,
          },
        });
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: result.reply, urgency: result.urgency ?? null },
        ]);
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Couldn't reach the assistant.";
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: `⚠️ ${msg}` },
        ]);
      } finally {
        setSending(false);
        setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
      }
    },
    [messages, sending, ctx.screen, ctx.vehicleId, ctx.jobId],
  );

  // Don't render until auth state known + position hydrated.
  if (!user || !hydrated) return null;
  if (!visible) {
    // Tiny revealer in the bottom-right corner so user can bring it back.
    return (
      <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
        <Pressable
          accessibilityLabel="Show AI Assistant"
          onPress={() => {
            setVisible(true);
            persistVisible(true);
          }}
          style={[
            styles.revealer,
            { backgroundColor: colors.primary, bottom: 24, right: 16 },
          ]}
        >
          <MaterialCommunityIcons name="creation" size={18} color={colors.primaryForeground} />
        </Pressable>
      </View>
    );
  }

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <GestureDetector gesture={composedGesture}>
        <Animated.View
          style={[
            styles.bubbleContainer,
            bubbleStyle,
            styles.bubble,
            { backgroundColor: colors.primary, shadowColor: "#000" },
          ]}
          accessibilityLabel={expanded ? "Close assistant" : "Open assistant"}
          accessibilityRole="button"
        >
          {expanded ? (
            <Feather name="x" size={26} color={colors.primaryForeground} />
          ) : (
            <MaterialCommunityIcons
              name="creation"
              size={26}
              color={colors.primaryForeground}
            />
          )}
        </Animated.View>
      </GestureDetector>

      {expanded ? (
        <View
          style={[
            styles.panel,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              shadowColor: "#000",
            },
          ]}
          pointerEvents="auto"
        >
          {/* Header */}
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <View style={styles.headerLeft}>
              <View style={[styles.iconBadge, { backgroundColor: colors.primary }]}>
                <MaterialCommunityIcons name="creation" size={14} color={colors.primaryForeground} />
              </View>
              <View>
                <Text style={[styles.headerTitle, { color: colors.foreground }]}>
                  APS Assistant
                </Text>
                <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>
                  {ctx.jobId
                    ? `Job #${ctx.jobId}`
                    : ctx.vehicleId
                      ? `Vehicle #${ctx.vehicleId}`
                      : "Ask anything about your car"}
                </Text>
              </View>
            </View>
            <View style={styles.headerActions}>
              {messages.length > 0 ? (
                <Pressable
                  onPress={() => setMessages([])}
                  accessibilityLabel="Clear chat"
                  style={styles.headerBtn}
                >
                  <Feather name="refresh-cw" size={18} color={colors.mutedForeground} />
                </Pressable>
              ) : null}
              <Pressable
                onPress={() => {
                  setExpanded(false);
                  setVisible(false);
                  persistVisible(false);
                }}
                accessibilityLabel="Hide assistant"
                style={styles.headerBtn}
              >
                <Feather name="eye-off" size={18} color={colors.mutedForeground} />
              </Pressable>
              <Pressable
                onPress={() => setExpanded(false)}
                accessibilityLabel="Minimize"
                style={styles.headerBtn}
              >
                <Feather name="minus" size={20} color={colors.mutedForeground} />
              </Pressable>
            </View>
          </View>

          {/* Messages */}
          <ScrollView
            ref={scrollRef}
            style={styles.messages}
            contentContainerStyle={{ padding: 12, gap: 8 }}
            keyboardShouldPersistTaps="handled"
          >
            {messages.length === 0 ? (
              <View style={styles.empty}>
                <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
                  Hi! I'm your APS Assistant.
                </Text>
                <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
                  Ask me to explain a part, justify a repair, or break down what your mechanic recommended.
                </Text>
                <View style={{ height: 12 }} />
                {contextualPrompts(ctx).map((p) => (
                  <Pressable
                    key={p}
                    onPress={() => sendMessage(p)}
                    style={[
                      styles.suggestion,
                      { backgroundColor: colors.muted, borderColor: colors.border },
                    ]}
                  >
                    <Text style={[styles.suggestionText, { color: colors.foreground }]}>
                      {p}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : (
              messages.map((m, i) => {
                const isUser = m.role === "user";
                const uColor = urgencyColor(m.urgency);
                return (
                  <View
                    key={i}
                    style={[
                      styles.msg,
                      isUser
                        ? {
                            alignSelf: "flex-end",
                            backgroundColor: colors.primary,
                          }
                        : {
                            alignSelf: "flex-start",
                            backgroundColor: colors.muted,
                            borderColor: colors.border,
                            borderWidth: 1,
                          },
                    ]}
                  >
                    {!isUser && uColor ? (
                      <View style={[styles.urgencyChip, { backgroundColor: uColor }]}>
                        <Text style={styles.urgencyText}>
                          {(m.urgency ?? "").toUpperCase()} URGENCY
                        </Text>
                      </View>
                    ) : null}
                    <Text
                      style={{
                        color: isUser ? colors.primaryForeground : colors.foreground,
                        fontSize: 14,
                        lineHeight: 20,
                      }}
                    >
                      {m.content}
                    </Text>
                  </View>
                );
              })
            )}
            {sending ? (
              <View
                style={[
                  styles.msg,
                  {
                    alignSelf: "flex-start",
                    backgroundColor: colors.muted,
                    borderColor: colors.border,
                    borderWidth: 1,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8,
                  },
                ]}
              >
                <ActivityIndicator size="small" color={colors.mutedForeground} />
                <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
                  Thinking…
                </Text>
              </View>
            ) : null}
          </ScrollView>

          {/* Input */}
          <View
            style={[
              styles.inputRow,
              { borderTopColor: colors.border, backgroundColor: colors.card },
            ]}
          >
            <TextInput
              value={input}
              onChangeText={setInput}
              placeholder="Ask about your car…"
              placeholderTextColor={colors.mutedForeground}
              style={[
                styles.input,
                {
                  color: colors.foreground,
                  backgroundColor: colors.muted,
                  borderColor: colors.border,
                },
              ]}
              editable={!sending}
              onSubmitEditing={() => sendMessage(input)}
              returnKeyType="send"
              multiline
            />
            <Pressable
              onPress={() => sendMessage(input)}
              disabled={!input.trim() || sending}
              style={[
                styles.sendBtn,
                {
                  backgroundColor:
                    !input.trim() || sending ? colors.muted : colors.primary,
                  opacity: !input.trim() || sending ? 0.6 : 1,
                },
              ]}
              accessibilityLabel="Send message"
            >
              <Feather
                name="arrow-up"
                size={18}
                color={
                  !input.trim() || sending
                    ? colors.mutedForeground
                    : colors.primaryForeground
                }
              />
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bubbleContainer: {
    position: "absolute",
    top: 0,
    left: 0,
    width: BUBBLE_SIZE,
    height: BUBBLE_SIZE,
    zIndex: 9999,
  },
  bubble: {
    width: BUBBLE_SIZE,
    height: BUBBLE_SIZE,
    borderRadius: BUBBLE_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 8,
  },
  revealer: {
    position: "absolute",
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    opacity: 0.7,
    elevation: 4,
  },
  panel: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: "70%",
    maxHeight: 640,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderBottomWidth: 0,
    overflow: "hidden",
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 16,
    zIndex: 9998,
    ...Platform.select({
      web: { maxWidth: 480, alignSelf: "flex-end", marginRight: 16 } as object,
      default: {},
    }),
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 12,
    borderBottomWidth: 1,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
  },
  iconBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    fontWeight: "700",
    fontSize: 15,
  },
  headerSub: {
    fontSize: 11,
    marginTop: 1,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  headerBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  messages: {
    flex: 1,
  },
  empty: {
    padding: 8,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 6,
  },
  emptySub: {
    fontSize: 13,
    lineHeight: 18,
  },
  suggestion: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 8,
  },
  suggestionText: {
    fontSize: 13,
    fontWeight: "500",
  },
  msg: {
    maxWidth: "85%",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 14,
  },
  urgencyChip: {
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    marginBottom: 6,
  },
  urgencyText: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    padding: 10,
    gap: 8,
    borderTopWidth: 1,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 100,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
});
