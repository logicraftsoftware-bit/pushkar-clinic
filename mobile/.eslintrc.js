module.exports = {
  root: true,
  extends: '@react-native',
  rules: {
    // The reference screens use many small, state-dependent layout variants.
    'react-native/no-inline-styles': 'off',
  },
};
