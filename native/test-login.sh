#!/bin/bash
set -euo pipefail
project="$(cd "$(dirname "$0")/.." && pwd)"
scratch="$(mktemp -d "${TMPDIR:-/tmp}/muyu-login-tests.XXXXXX")"
trap 'rm -rf "$scratch"' EXIT
cd "$project"
xcrun swiftc -parse-as-library -swift-version 5 -framework ServiceManagement native/LoginItem.swift native/tests/LoginItemTests.swift -o "$scratch/LoginItemTests"
"$scratch/LoginItemTests"
