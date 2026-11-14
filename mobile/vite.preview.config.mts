import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  root: path.resolve(__dirname, 'preview'),
  define: {
    __DEV__: 'true',
    'process.env.NODE_ENV': JSON.stringify('development'),
  },
  resolve: {
    alias: [
      {
        find: /^react-native-safe-area-context$/,
        replacement: path.resolve(__dirname, 'preview/SafeArea.tsx'),
      },
      {
        find: /^react-native-qrcode-svg$/,
        replacement: path.resolve(__dirname, 'preview/QRCode.tsx'),
      },
      { find: /^react-native$/, replacement: 'react-native-web' },
      {
        find: /^@react-navigation\/native$/,
        replacement: path.resolve(__dirname, 'preview/navigation.tsx'),
      },
      {
        find: /^react-native-linear-gradient$/,
        replacement: path.resolve(__dirname, 'preview/Gradient.tsx'),
      },
      {
        find: /^react-native-svg$/,
        replacement: path.resolve(__dirname, 'preview/Svg.tsx'),
      },
    ],
    extensions: [
      '.web.tsx',
      '.tsx',
      '.web.ts',
      '.ts',
      '.web.jsx',
      '.jsx',
      '.web.js',
      '.js',
      '.mjs',
      '.json',
    ],
  },
  server: {
    host: '127.0.0.1',
    port: 5181,
    fs: { allow: [path.resolve(__dirname)] },
  },
  build: { outDir: path.resolve(__dirname, 'preview-dist'), emptyOutDir: true },
});
