import React from 'react';
import { View, type ViewProps } from 'react-native';
export function useSafeAreaInsets() {
  return { top: 0, left: 0, right: 0, bottom: 0 };
}
// Only the browser review shell uses this; native builds use the real safe-area library.
export function SafeAreaProvider({
  children,
}: React.PropsWithChildren<{ initialMetrics?: unknown }>) {
  return <View style={{ flex: 1 }}>{children}</View>;
}
export function SafeAreaView({
  edges: _edges,
  ...props
}: ViewProps & { edges?: string[] }) {
  return <View {...props} />;
}
