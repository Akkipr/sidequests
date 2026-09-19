import { ReactNode, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleProp, Text, TextInput, TextInputProps, TextProps, View, ViewStyle } from 'react-native';

export const C = {
  bg: '#1b1b2f', panel: '#2e2e4f', ink: '#f4f4e8', dim: '#8a8aa8', shadow: '#000',
  gold: '#ffcc00', green: '#3ddc84', pink: '#ff5c8a', cyan: '#4cc9f0',
};
export const FONT = 'PressStart2P_400Regular';

export const Txt = ({ size = 10, color = C.ink, style, ...p }: TextProps & { size?: number; color?: string }) => (
  <Text {...p} style={[{ fontFamily: FONT, fontSize: size, lineHeight: size * 1.8, color }, style]} />
);

// ponytail: fixed top padding instead of react-native-safe-area-context; add it if notches clip the title.
export const Screen = ({ title, children }: { title: string; children: ReactNode }) => (
  <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: 16, paddingTop: 64, paddingBottom: 48, gap: 16 }}>
    <Txt size={16} color={C.gold}>{title}</Txt>
    {children}
  </ScrollView>
);

// Hard-edged box with a solid offset drop shadow, the classic 8-bit panel.
export const Panel = ({ children, color = C.panel, style }: { children: ReactNode; color?: string; style?: StyleProp<ViewStyle> }) => (
  <View style={[{ marginRight: 4, marginBottom: 4 }, style]}>
    <View style={{ position: 'absolute', top: 4, left: 4, right: -4, bottom: -4, backgroundColor: C.shadow }} />
    <View style={{ backgroundColor: color, borderWidth: 3, borderColor: C.ink, padding: 12, gap: 8 }}>{children}</View>
  </View>
);

// Pressing sinks the button into its shadow.
export function Btn({ label, onPress, color = C.gold, disabled, small }: {
  label: string; onPress: () => void; color?: string; disabled?: boolean; small?: boolean;
}) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label}
      style={{ marginRight: 4, marginBottom: 4, opacity: disabled ? 0.4 : 1 }}>
      {({ pressed }) => (
        <>
          <View style={{ position: 'absolute', top: 4, left: 4, right: -4, bottom: -4, backgroundColor: C.shadow }} />
          <View style={{
            backgroundColor: color, borderWidth: 3, borderColor: C.shadow, padding: small ? 8 : 14, alignItems: 'center',
            transform: pressed ? [{ translateX: 4 }, { translateY: 4 }] : [],
          }}>
            <Txt size={small ? 8 : 11} color={C.shadow}>{label}</Txt>
          </View>
        </>
      )}
    </Pressable>
  );
}

// Underlined text input in the panel style.
export const Field = (p: TextInputProps) => (
  <TextInput placeholder="_" placeholderTextColor={C.dim}
    style={{ fontFamily: FONT, fontSize: 14, color: C.gold, borderBottomWidth: 3, borderColor: C.ink, paddingVertical: 8 }} {...p} />
);

// Toggle chip for multi/single selects.
export const Chip = ({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) => (
  <Pressable onPress={onPress} accessibilityRole="checkbox" accessibilityState={{ checked: on }}
    style={{ borderWidth: 3, borderColor: on ? C.gold : C.dim, backgroundColor: on ? C.gold : 'transparent', padding: 10 }}>
    <Txt size={9} color={on ? C.shadow : C.ink}>{on ? '▶ ' : ''}{label}</Txt>
  </Pressable>
);

// Segmented HP-style bar.
export const Bar = ({ pct, color = C.green }: { pct: number; color?: string }) => (
  <View style={{ flexDirection: 'row', gap: 3, borderWidth: 3, borderColor: C.ink, padding: 3 }}>
    {Array.from({ length: 10 }, (_, i) => (
      <View key={i} style={{ flex: 1, height: 14, backgroundColor: i < Math.round(pct / 10) ? color : C.bg }} />
    ))}
  </View>
);

export function useBlink(ms = 500) {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const t = setInterval(() => setOn(v => !v), ms);
    return () => clearInterval(t);
  }, [ms]);
  return on;
}

export const Row = ({ children }: { children: ReactNode }) => (
  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{children}</View>
);
