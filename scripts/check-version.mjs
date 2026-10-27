import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const json = (path) => JSON.parse(readFileSync(`BlinkenBadge/${path}`, "utf8"));
const pkg = json("package.json");
const versions = [
  pkg.version,
  json("package-lock.json").version,
  json("package-lock.json").packages[""].version,
  json("src-tauri/tauri.conf.json").version,
  readFileSync("BlinkenBadge/src-tauri/Cargo.toml", "utf8").match(/^version = "([^"]+)"/m)?.[1],
  readFileSync("BlinkenBadge/src-tauri/Cargo.lock", "utf8").match(/name = "blinkenbadge"\nversion = "([^"]+)"/)?.[1],
];
for (const version of versions) assert.equal(version, pkg.version, "Manifest versions differ");
if (process.env.IS_TAG === "true") assert.equal(process.env.REF_NAME, `v${pkg.version}`, "Tag does not match manifests");
console.log(`Manifest versions match: ${pkg.version}`);
