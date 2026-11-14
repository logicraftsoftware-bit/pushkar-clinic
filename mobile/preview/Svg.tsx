import React from 'react';
import { StyleSheet } from 'react-native';
// Browser-only adapter for the vector primitives used by the native screens.
function shape(tag: string) {
  return React.forwardRef<SVGElement, Record<string, unknown>>(
    ({ children, style, ...props }, ref) =>
      React.createElement(
        tag,
        { ...props, ref, style: StyleSheet.flatten(style as never) },
        children as React.ReactNode,
      ),
  );
}
const Svg = shape('svg');
export default Svg;
export { Svg };
export const Circle = shape('circle'),
  Ellipse = shape('ellipse'),
  Rect = shape('rect'),
  Path = shape('path'),
  G = shape('g'),
  Defs = shape('defs'),
  LinearGradient = shape('linearGradient'),
  Stop = shape('stop'),
  Line = shape('line'),
  Polyline = shape('polyline'),
  Polygon = shape('polygon'),
  ClipPath = shape('clipPath'),
  Mask = shape('mask');
