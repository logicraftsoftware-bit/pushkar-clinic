const preset = require('@react-native/jest-preset');
module.exports = {
  ...preset,
  testTimeout: 20000,
  moduleNameMapper: {
    ...preset.moduleNameMapper,
    '^lucide-react-native$':
      '<rootDir>/node_modules/lucide-react-native/dist/cjs/lucide-react-native.js',
  },
};
