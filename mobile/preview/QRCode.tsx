import React from 'react';
import { View } from 'react-native';
import genMatrix from 'react-native-qrcode-svg/src/genMatrix';
export default function QRCode({
  value,
  size = 100,
  color = '#071833',
}: {
  value: string;
  size?: number;
  color?: string;
}) {
  const matrix: number[][] = genMatrix(value, 'M');
  return (
    <View
      style={{ width: size, height: size, backgroundColor: '#fff', padding: 2 }}
    >
      <svg
        viewBox={`0 0 ${matrix.length} ${matrix.length}`}
        width="100%"
        height="100%"
      >
        {matrix.flatMap((row, y) =>
          row.map((cell, x) =>
            cell ? (
              <rect
                key={`${x}-${y}`}
                x={x}
                y={y}
                width="1"
                height="1"
                fill={color}
              />
            ) : null,
          ),
        )}
      </svg>
    </View>
  );
}
