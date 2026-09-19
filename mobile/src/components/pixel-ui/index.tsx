import { ReactNode, useEffect, useState } from 'react';
import {
  AccessibilityInfo, Pressable, ScrollView, StyleProp, Text, TextInput, TextInputProps, TextProps, View, ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export const C = {
  bg: '#1b1b2f', panel: '#2e2e4f', ink: '#f4f4e8', dim: '#a3a3c2', shadow: '#000',
  gold: '#ffcc00', green: '#3ddc84', pink: '#ff5c8a', cyan: '#4cc9f0',
};
export const FONT = 'PressStart2P_400Regular';

const TOUCH = 44; // minimum touch target (pt)

export const Txt = ({ size = 10, color = C.ink, style, ...p }: TextProps & { size?: number; color?: string }) => (
  <Text {...p} maxFontSizeMultiplier={1.3} style={[{ fontFamily: FONT, fontSize: size, lineHeight: size * 1.8, color }, style]} />
);

// Screens draw their own pixel header (title + optional back) and respect the device's safe area.
export const Screen = ({ title, onBack, children }: { title: string; onBack?: () => void; children: ReactNode }) => {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 16, paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32, gap: 16 }}>
      {onBack && <Btn small color={C.dim} label="◀ BACK" onPress={onBack} />}
      <Txt size={16} color={C.gold} accessibilityRole="header">{title}</Txt>
      {children}
    </ScrollView>
  );
};

// Hard-edged box with a solid offset drop shadow, the classic 8-bit panel.
export const Panel = ({ children, color = C.panel, style }: { children: ReactNode; color?: string; style?: StyleProp<ViewStyle> }) => (
  <View style={[{ marginRight: 4, marginBottom: 4 }, style]}>
    <View style={{ position: 'absolute', top: 4, left: 4, right: -4, bottom: -4, backgroundColor: C.shadow }} />
    <View style={{ backgroundColor: color, borderWidth: 3, borderColor: C.ink, padding: 12, gap: 8 }}>{children}</View>
  </View>
);

// Pressing sinks the button into its shadow. `big` is the primary call to action.
export function Btn({ label, onPress, color = C.gold, disabled, small, big, hint }: {
  label: string; onPress: () => void; color?: string; disabled?: boolean; small?: boolean; big?: boolean; hint?: string;
}) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label}
      accessibilityHint={hint} accessibilityState={{ disabled: !!disabled }}
      style={{ marginRight: 4, marginBottom: 4, opacity: disabled ? 0.4 : 1 }}>
      {({ pressed }) => (
        <>
          <View style={{ position: 'absolute', top: 4, left: 4, right: -4, bottom: -4, backgroundColor: C.shadow }} />
          <View style={{
            backgroundColor: color, borderWidth: 3, borderColor: C.shadow, alignItems: 'center', justifyContent: 'center',
            padding: big ? 22 : small ? 8 : 14, minHeight: big ? 72 : TOUCH,
            transform: pressed ? [{ translateX: 4 }, { translateY: 4 }] : [],
          }}>
            <Txt size={big ? 14 : small ? 8 : 11} color={C.shadow} style={{ textAlign: 'center' }}>{label}</Txt>
          </View>
        </>
      )}
    </Pressable>
  );
}

// Toggle chip for multi/single selects. Selection shows a ▶ marker as well as the fill (not colour alone).
export const Chip = ({ label, on, onPress, radio }: { label: string; on: boolean; onPress: () => void; radio?: boolean }) => (
  <Pressable onPress={onPress} accessibilityRole={radio ? 'radio' : 'checkbox'} accessibilityLabel={label}
    accessibilityState={radio ? { selected: on } : { checked: on }}
    style={{ borderWidth: 3, borderColor: on ? C.gold : C.dim, backgroundColor: on ? C.gold : 'transparent', padding: 10, minHeight: TOUCH, justifyContent: 'center' }}>
    <Txt size={9} color={on ? C.shadow : C.ink}>{on ? '▶ ' : ''}{label}</Txt>
  </Pressable>
);

// Segmented HP-style bar.
export const Bar = ({ pct, color = C.green }: { pct: number; color?: string }) => (
  <View accessible accessibilityRole="progressbar" accessibilityLabel={`Compatibility ${pct} percent`}
    style={{ flexDirection: 'row', gap: 3, borderWidth: 3, borderColor: C.ink, padding: 3 }}>
    {Array.from({ length: 10 }, (_, i) => (
      <View key={i} style={{ flex: 1, height: 14, backgroundColor: i < Math.round(pct / 10) ? color : C.bg }} />
    ))}
  </View>
);

// Underlined text input in the panel style.
export const Field = (p: TextInputProps) => (
  <TextInput placeholder="_" placeholderTextColor={C.dim}
    style={{ fontFamily: FONT, fontSize: 14, color: C.gold, borderBottomWidth: 3, borderColor: C.ink, paddingVertical: 10, minHeight: TOUCH }} {...p} />
);

export const Row = ({ children }: { children: ReactNode }) => (
  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{children}</View>
);

// ---- motion: everything that blinks or animates goes through here, so "Reduce Motion" is respected ----
export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduced, () => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => sub.remove();
  }, []);
  return reduced;
}

// Steps 0..n-1 every `ms`; frozen at 0 under Reduce Motion.
export function useTicker(n: number, ms = 400) {
  const reduced = useReducedMotion();
  const [i, setI] = useState(0);
  useEffect(() => {
    if (reduced) return setI(0);
    const t = setInterval(() => setI(v => (v + 1) % n), ms);
    return () => clearInterval(t);
  }, [n, ms, reduced]);
  return i;
}

// Blinking cursor-style flag: on/off every `ms`; always on under Reduce Motion.
export function useBlink(ms = 500) {
  const reduced = useReducedMotion();
  const [on, setOn] = useState(true);
  useEffect(() => {
    if (reduced) return setOn(true);
    const t = setInterval(() => setOn(v => !v), ms);
    return () => clearInterval(t);
  }, [ms, reduced]);
  return on;
}
