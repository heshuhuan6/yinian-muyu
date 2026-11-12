#!/bin/bash
set -euo pipefail
project="$(cd "$(dirname "$0")/.." && pwd)"
destination="${1:-$project/out/Muyu.app}"
scratch="${2:-${TMPDIR:-/tmp}/muyu-native-build}"
stage="$scratch/Muyu.app"
mkdir -p "$scratch"
cd "$project"
npm run build
mkdir -p "$stage/Contents/MacOS" "$stage/Contents/Resources"
cp native/Info.plist "$stage/Contents/Info.plist"
node native/embed.mjs "$stage/Contents/Resources"
cp LICENSE THIRD_PARTY_NOTICES.md "$stage/Contents/Resources/"
for architecture in arm64 x86_64; do
  xcrun swiftc -parse-as-library -swift-version 5 -O -target "$architecture-apple-macosx13.0" -framework AppKit -framework WebKit -framework ServiceManagement native/main.swift native/AppDelegate.swift native/LoginItem.swift native/Diagnostic.swift -o "$scratch/Muyu-$architecture"
done
xcrun lipo -create "$scratch/Muyu-arm64" "$scratch/Muyu-x86_64" -output "$stage/Contents/MacOS/Muyu"
xcrun swiftc -parse-as-library -O -framework AppKit native/Icon.swift -o "$scratch/icon-builder"
"$scratch/icon-builder" "$scratch/AppIcon.iconset"
xcrun iconutil -c icns "$scratch/AppIcon.iconset" -o "$stage/Contents/Resources/AppIcon.icns"
codesign --force --sign - --timestamp=none "$stage"
codesign --verify --deep --strict "$stage"
mkdir -p "$(dirname "$destination")"
ditto "$stage" "$destination"
codesign --verify --deep --strict "$destination"
printf 'Built %s\n' "$destination"
