#!/usr/bin/env bash
# Brave build - identical to Firefox build but outputs Brave-compatible zip
. $(dirname $0)/commons.sh

print Y "Checking Brave manifest..."
python3 -m json.tool src/manifest.json > /dev/null || die "Invalid manifest.json"

print Y "Packing Brave extension (src/ -> brave-multi-account-containers.zip)..."
cd src || die
rm -f ../brave-multi-account-containers.zip
zip -r ../brave-multi-account-containers.zip . -x "*.git*" "*.DS_Store*" "*web-ext-artifacts*"
cd .. || die
print G "Done: brave-multi-account-containers.zip ($(du -h brave-multi-account-containers.zip | cut -f1))"

print Y "Validating with addons-linter (if installed)..."
if command -v npx &> /dev/null; then
  npx addons-linter src --warnings-as-errors 2>&1 | head -100 || true
fi

print G "Build complete. Load in Brave via brave://extensions -> Load unpacked -> select src/"
