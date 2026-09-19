import { DarkTheme, Theme } from '@react-navigation/native';
import { C, FONT } from '../../components/pixel-ui';

// The navigation chrome uses the same palette as the pixel UI, so nothing looks like a stock tab bar.
export const pixelTheme: Theme = {
  ...DarkTheme,
  dark: true,
  colors: { primary: C.gold, background: C.bg, card: C.panel, text: C.ink, border: C.ink, notification: C.pink },
};

export const tabBarStyle = {
  backgroundColor: C.panel,
  borderTopWidth: 3,
  borderTopColor: C.ink,
  elevation: 0,
  shadowOpacity: 0,
} as const;

export const tabLabelStyle = { fontFamily: FONT, fontSize: 8, marginTop: 2 } as const;
