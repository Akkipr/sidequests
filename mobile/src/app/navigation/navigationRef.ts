import { createNavigationContainerRef } from '@react-navigation/native';
import type { RootParams } from './types';

// Lets the discovery lifecycle drive navigation without being rendered inside a screen.
export const navigationRef = createNavigationContainerRef<RootParams>();
