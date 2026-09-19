import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { View } from 'react-native';
import { C, Txt } from '../../components/pixel-ui';
import DiscoverScreen from '../../features/discovery/DiscoverScreen';
import ProfileScreen from '../../features/profile/ProfileScreen';
import QuestsScreen from '../../features/quests/QuestsScreen';
import { tabBarStyle, tabLabelStyle } from './theme';
import type { TabParams } from './types';

const Tab = createBottomTabNavigator<TabParams>();

const TABS: Record<keyof TabParams, { label: string; icon: string }> = {
  Discover: { label: 'DISCOVER', icon: '📡' },
  Quests: { label: 'QUESTS', icon: '🗺️' },
  Profile: { label: 'PROFILE', icon: '👾' },
};

export default function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false, // each screen draws its own pixel header
        tabBarStyle,
        tabBarLabelStyle: tabLabelStyle,
        tabBarActiveTintColor: C.gold,
        tabBarInactiveTintColor: C.dim,
        tabBarLabel: TABS[route.name].label,
        tabBarAccessibilityLabel: `${TABS[route.name].label} tab`,
        // The active tab is marked by a gold bar as well as colour.
        tabBarIcon: ({ focused }) => (
          <View style={{ alignItems: 'center' }}>
            <View style={{ height: 3, width: 28, marginBottom: 3, backgroundColor: focused ? C.gold : 'transparent' }} />
            <Txt size={16} style={{ lineHeight: 22 }}>{TABS[route.name].icon}</Txt>
          </View>
        ),
      })}>
      <Tab.Screen name="Discover" component={DiscoverScreen} />
      <Tab.Screen name="Quests" component={QuestsScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}
