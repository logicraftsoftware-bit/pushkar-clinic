import React from 'react';
import { View, type ViewProps, type ViewStyle } from 'react-native';
export default function Gradient({
  colors,
  style,
  children,
  ...props
}: ViewProps & { colors: string[] }) {
  return (
    <View
      {...props}
      style={[
        style,
        {
          backgroundImage: `linear-gradient(160deg,${colors.join(',')})`,
        } as ViewStyle,
      ]}
    >
      {children}
    </View>
  );
}
