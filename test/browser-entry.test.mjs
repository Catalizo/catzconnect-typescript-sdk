// The "catzconnect/push" entry must bundle for a browser / React Native app:
// no Node built-ins (node:crypto, Buffer) reachable from it. Run after
// `npm run build`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { PushDevicesApi, buildRegisterDevicePayload, pushTopics } from "../dist/push.mjs";
import * as main from "../dist/index.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

test("PushDevicesApi is exported from catzconnect/push and is the main entry's class", () => {
  assert.equal(typeof PushDevicesApi, "function");
  assert.equal(main.PushDevicesApi, PushDevicesApi);
  assert.equal(typeof buildRegisterDevicePayload, "function");
  assert.deepEqual(pushTopics(["news"]), ["news"]);
});

test("package.json maps ./push to the built files", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.exports["./push"].import, "./dist/push.mjs");
  assert.equal(pkg.exports["./push"].require, "./dist/push.js");
});

for (const entry of ["src/push.ts", "dist/push.mjs", "dist/push.js"]) {
  test(`${entry} bundles for the browser without Node built-ins`, async () => {
    const res = await build({
      entryPoints: [entry],
      absWorkingDir: root,
      bundle: true,
      platform: "browser",
      format: "esm",
      write: false,
      metafile: true,
      logLevel: "silent",
      // The app brings its own copy; it is browser-safe.
      external: ["libsodium-wrappers-sumo"],
    });
    const out = res.outputFiles.map((f) => f.text).join("\n");
    assert.doesNotMatch(out, /["']node:/, "a node: import is reachable");
    assert.doesNotMatch(out, /\bBuffer\b/, "Buffer is reachable");
    const inputs = Object.keys(res.metafile.inputs).join("\n");
    assert.doesNotMatch(inputs, /core\/(crypto|webhook)\.ts/);
  });
}
