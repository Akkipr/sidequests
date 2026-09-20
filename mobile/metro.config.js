// Sentry's Metro config wraps Expo's default and adds the debug IDs that let source maps be matched to builds.
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

module.exports = getSentryExpoConfig(__dirname);
