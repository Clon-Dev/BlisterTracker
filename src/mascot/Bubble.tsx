// The kitten's speech bubble: text, optional source link and buttons, a tail pointing at the kitten.
import { useEffect, useRef } from "react";
import { Animated, Easing, Linking, Platform, Pressable, Text, View } from "react-native";
import { C, F, R, shadow, themedStyles } from "../theme";

const nativeDriver = Platform.OS !== "web";

export type BubbleButton = { label: string; primary?: boolean; onPress: () => void };
export type BubbleContent = { text: string; title?: string; source?: { name: string; url: string; label: string }; buttons?: BubbleButton[] };

/** `kittenSide`: where the kitten sits relative to the bubble (the tail points there). */
export function Bubble({ content, kittenSide, onHeight }: { content: BubbleContent; kittenSide: "left" | "right"; onHeight: (h: number) => void }) {
  const appear = useRef(new Animated.Value(0)).current;
  useEffect(() => { // once per bubble (each message is a new Bubble); a language switch only changes the text
    Animated.spring(appear, { toValue: 1, useNativeDriver: nativeDriver, speed: 16, bounciness: 7 }).start();
  }, [appear]);
  return (
    <Animated.View accessibilityLiveRegion="polite" onLayout={(e) => onHeight(e.nativeEvent.layout.height)}
      style={[st.bubble, shadow(1), {
        opacity: appear, transformOrigin: kittenSide === "left" ? "0% 80%" : "100% 80%",
        transform: [{ scale: appear.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }],
      }]}>
      <View style={[st.tail, kittenSide === "left" ? st.tailLeft : st.tailRight]} />
      <Text style={st.text}>
        {content.title && <Text style={{ color: C.primaryDeep, ...F.extrabold }}>{content.title} </Text>}
        {content.text}
      </Text>
      {content.source && (
        <Pressable onPress={() => Linking.openURL(content.source!.url)} accessibilityRole="link" hitSlop={6} style={{ alignSelf: "flex-start", marginTop: 4 }}>
          <Text style={[st.source]}>{content.source.label}: {content.source.name} ↗</Text>
        </Pressable>
      )}
      {!!content.buttons?.length && (
        <View style={st.buttons}>
          {content.buttons.map((b) => {
            const color = { color: b.primary ? C.white : C.primaryDeep };
            const { emoji, text } = splitEmoji(b.label);
            return (
              <Pressable key={b.label} onPress={b.onPress} accessibilityRole="button" accessibilityLabel={b.label}
                style={({ pressed }) => [st.button, b.primary ? st.primary : st.secondary, pressed && { opacity: 0.75 }]}>
                {/* Emoji and words as separate one-line texts: Android can measure an emoji a little narrower than it
                    draws it, which used to push the words onto a hidden second line (only the emoji showed). */}
                {emoji && <Text style={[st.buttonText, color]} numberOfLines={1} textBreakStrategy="simple">{emoji}</Text>}
                {!!text && <Text style={[st.buttonText, color]} numberOfLines={1} textBreakStrategy="simple">{text}</Text>}
              </Pressable>
            );
          })}
        </View>
      )}
    </Animated.View>
  );
}

/** A label's leading emoji ("💜 Herstory" → "💜", "Herstory"), if it starts with one. */
export function splitEmoji(label: string): { emoji: string | null; text: string } {
  const m = LEADING_EMOJI?.exec(label);
  return m ? { emoji: m[1], text: m[2] } : { emoji: null, text: label };
}
// Built once, guarded: an engine without Unicode property escapes just keeps labels whole.
const LEADING_EMOJI = (() => {
  try { return new RegExp("^(\\p{Extended_Pictographic}(?:\\uFE0F|\\u200D\\p{Extended_Pictographic})*)\\s*(.*)$", "su"); } catch { return null; }
})();

/** "…" while the kitten is on its way (the bubble opens again where it settles). */
export function TypingDots() {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.loop(Animated.timing(t, { toValue: 1, duration: 900, easing: Easing.linear, useNativeDriver: nativeDriver }));
    anim.start();
    return () => anim.stop();
  }, [t]);
  return (
    <View style={[st.dots, shadow(1)]}>
      {[0, 1, 2].map((i) => (
        <Animated.View key={i} style={[st.dot, {
          opacity: t.interpolate({ inputRange: [0, (i + 0.5) / 3.5, (i + 1.5) / 3.5, 1], outputRange: [0.35, 1, 0.35, 0.35] }),
        }]} />
      ))}
    </View>
  );
}

const st = themedStyles(() => ({
  bubble: { backgroundColor: C.card, borderRadius: 18, borderWidth: 1.5, borderColor: C.border, paddingHorizontal: 13, paddingVertical: 10 },
  tail: { position: "absolute" as const, bottom: 16, width: 13, height: 13, backgroundColor: C.card, borderColor: C.border, transform: [{ rotate: "45deg" }] },
  tailLeft: { left: -7.5, borderLeftWidth: 1.5, borderBottomWidth: 1.5 },
  tailRight: { right: -7.5, borderRightWidth: 1.5, borderTopWidth: 1.5 },
  text: { ...F.medium, fontSize: 14, lineHeight: 20, color: C.text },
  source: { ...F.semibold, fontSize: 12, color: C.muted },
  buttons: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 6, marginTop: 9 },
  button: { flexDirection: "row" as const, alignItems: "center" as const, gap: 5, flexShrink: 0, borderRadius: R.full, paddingHorizontal: 13, paddingVertical: 7 },
  primary: { backgroundColor: C.primary },
  secondary: { backgroundColor: C.primarySoft },
  buttonText: { ...F.bold, fontSize: 13 },
  dots: { flexDirection: "row" as const, gap: 4, backgroundColor: C.card, borderRadius: R.full, borderWidth: 1.5, borderColor: C.border, paddingHorizontal: 9, paddingVertical: 7 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.primary },
}));
