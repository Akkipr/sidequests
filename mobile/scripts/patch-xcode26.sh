#!/bin/sh
# ponytail: Expo SDK 57's expo-modules-jsi targets a newer Swift than Xcode 26.3 (Swift 6.2.4) ships.
# Delete this script once Xcode is upgraded (needs a newer macOS) or Expo fixes it upstream.
H=$(find node_modules -path '*expo-modules-jsi/apple/Sources/ExpoModulesJSI-Cxx/include/RuntimeScheduler.h')
P=$(find node_modules -path '*expo-modules-jsi/apple/Package.swift')
# 1. Ctor ownership annotations added for Xcode 27; Swift 6.2 rejects them.
[ -n "$H" ] && perl -pi -e 's/SWIFT_RETURNS_RETAINED (RuntimeScheduler\()/$1/' $H
# 2. Swift 6.2 wrongly errors on its nonisolated(unsafe) captures. Swift 5 mode makes those warnings;
#    re-enable the Swift 6 features the code actually uses.
# Only patch once: re-running (every `npm install` does) would duplicate the feature flags and break the build.
[ -n "$P" ] && ! grep -q BareSlashRegexLiterals "$P" && perl -pi -e 's/swiftLanguageModes: \[\.v6\]/swiftLanguageModes: [.v5]/; s/(\.enableUpcomingFeature\("InferIsolatedConformances"\),)/$1 .enableUpcomingFeature("BareSlashRegexLiterals"), .enableUpcomingFeature("IsolatedDefaultValues"), .enableUpcomingFeature("GlobalActorIsolatedTypesUsability"),/' $P
exit 0
