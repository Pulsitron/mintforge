#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${SITES_ENV_READY:-}" != "1" ]]; then
  exec "${script_dir}/sites-env.sh" -- "$0" "$@"
fi

worker="${SITES_PROJECT_ROOT}/dist/server/index.js"
wrangler="${SITES_PROJECT_ROOT}/dist/server/wrangler.json"
source_hosting="${SITES_PROJECT_ROOT}/.openai/hosting.json"
hosting="${SITES_PROJECT_ROOT}/dist/.openai/hosting.json"

[[ -f "${worker}" ]] || {
  echo "Missing Cloudflare Worker entry: dist/server/index.js" >&2
  exit 66
}
[[ -f "${wrangler}" ]] || {
  echo "Missing Cloudflare Worker configuration: dist/server/wrangler.json" >&2
  exit 66
}
# Direct Cloudflare builds do not require a Sites manifest. If the source
# includes one, still ensure it is packaged for Sites deployments.
if [[ -f "${source_hosting}" && ! -f "${hosting}" ]]; then
  echo "Missing packaged Sites manifest: dist/.openai/hosting.json" >&2
  exit 66
fi

node --import "${script_dir}/register-cloudflare-loader.mjs" --input-type=module - "${worker}" "${wrangler}" "${hosting}" <<'NODE'
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const [workerPath, wranglerPath, hostingPath] = process.argv.slice(2);
JSON.parse(await readFile(wranglerPath, "utf8"));
try {
  JSON.parse(await readFile(hostingPath, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const workerUrl = pathToFileURL(workerPath);
workerUrl.searchParams.set("sites-validation", `${process.pid}-${Date.now()}`);
const worker = await import(workerUrl.href);
if (!worker.default || typeof worker.default.fetch !== "function") {
  throw new Error("dist/server/index.js must have an ESM default export with fetch(request, env, ctx)");
}
NODE

echo "Validated Cloudflare artifact: ESM Worker default.fetch and Wrangler configuration are present."
