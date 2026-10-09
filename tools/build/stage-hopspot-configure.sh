#!/usr/bin/env bash
# Stage the Hopspot Configure page (browser Remote Control for screenless Hopspots) as a static
# site: the page, the browser SDK, the WebAssembly runtime, and the firmware it flashes for each
# supported board (RAK4631, Wio Tracker L1, XIAO nRF52840).
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
wasm_dir="$repo_root/prns-wasm"
page_dir="$wasm_dir/examples/hopspot-configure"
playground_dir="$wasm_dir/examples/browser-playground"
build_dir="$wasm_dir/target/browser-playground"
out_dir="${1:-$repo_root/target/hopspot-configure}"

# The playground build compiles the WebAssembly runtime and the TypeScript SDK this page reuses.
npm --prefix "$wasm_dir" run build:playground
boards=(rak4631 wio-tracker-l1 xiao-nrf52840)
for board in "${boards[@]}"; do
  bash "$repo_root/tools/build/hopspot-nrf52840.sh" "$board"
done

rm -rf -- "$out_dir"
mkdir -p "$out_dir/sdk" "$out_dir/pkg" "$out_dir/firmware"
cp "$page_dir/index.html" "$page_dir/styles.css" "$page_dir/app.js" "$out_dir/"
cp -R "$build_dir/prns-js/src/." "$out_dir/sdk/"
node "$repo_root/prns-js/scripts/stage-code.mjs"
cp "$repo_root/prns-js/dist/casework.js" "$out_dir/sdk/casework.js"
cp "$playground_dir/sdk/index.js" "$playground_dir/sdk/package.json" "$out_dir/sdk/"
cp "$build_dir/pkg/prns_wasm.js" "$build_dir/pkg/prns_wasm_bg.wasm" "$out_dir/pkg/"
for board in "${boards[@]}"; do
  cp "$repo_root/target/hopspot-$board/$board.uf2" "$out_dir/firmware/$board.uf2"
done
# GitHub Pages must serve the files as-is rather than through Jekyll.
touch "$out_dir/.nojekyll"

echo "staged Hopspot Configure at $out_dir"
