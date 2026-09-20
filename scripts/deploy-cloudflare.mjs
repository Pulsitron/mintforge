import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
// Cloudflare build variables configure this deployment; no secrets are written.
const db = process.env.MINTFORGE_D1_DATABASE_ID;
if (
  !db ||
  !/^[-0-9a-f]{36}$/i.test(db) ||
  db === "00000000-0000-4000-8000-000000000000"
)
  throw new Error(
    "Set MINTFORGE_D1_DATABASE_ID to the DB you created for MintForge.",
  );
const root = process.cwd();
const config = JSON.parse(fs.readFileSync("dist/server/wrangler.json", "utf8"));
config.name = "mintforge";
config.main = path.join(root, "dist/server/index.js");
config.assets = { ...config.assets, directory: path.join(root, "dist/client") };
config.d1_databases = [
  {
    binding: "DB",
    database_name: "mintforge-uploads",
    database_id: db,
    migrations_dir: path.join(root, "drizzle"),
  },
];
config.keep_vars = true;
config.triggers = { ...config.triggers, crons: ["* * * * *"] };
fs.mkdirSync(".wrangler", { recursive: true });
const filename = path.join(root, ".wrangler/mintforge-deploy.json");
fs.writeFileSync(filename, JSON.stringify(config, null, 2));
if (process.argv.includes("--prepare-only")) {
  console.log("Prepared .wrangler/mintforge-deploy.json");
  process.exit(0);
}
const cli = path.join(root, "node_modules/wrangler/bin/wrangler.js");
for (const args of [
  ["d1", "migrations", "apply", "DB", "--remote", "--config", filename],
  ["deploy", "--config", filename],
]) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) process.exit(result.status || 1);
}
