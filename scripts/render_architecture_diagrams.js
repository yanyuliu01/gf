#!/usr/bin/env node
/* Render the maintained SVG architecture assets to PNG previews. */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const maintainedNames = [
  "product-interaction-architecture",
  "technical-architecture",
  "runtime-event-lifecycle",
  "emergence-validation-loop",
  "memory-affect-hybrid-architecture-v1",
  "memory-affect-runtime-loop-v1",
  "computable-world-architecture-v1",
  "world-interaction-structure-v1",
  "cognitive-wake-token-energy-v1",
];

const requestedNames = process.argv.slice(2);
const names = requestedNames.length > 0 ? requestedNames : maintainedNames;
const unknownNames = names.filter((name) => !maintainedNames.includes(name));
if (unknownNames.length > 0) {
  throw new Error(`Unknown diagram name(s): ${unknownNames.join(", ")}`);
}

const browserCandidates = [
  process.env.ARCHITECTURE_BROWSER_EXECUTABLE,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/microsoft-edge",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);

const executablePath = browserCandidates.find((candidate) => fs.existsSync(candidate));
if (!executablePath) {
  throw new Error(
    "No Edge/Chrome executable found. Set ARCHITECTURE_BROWSER_EXECUTABLE to render diagram previews.",
  );
}

for (const name of names) {
  const source = path.join(root, `${name}.svg`);
  const target = path.join(root, `${name}.png`);
  const svg = fs.readFileSync(source, "utf8");
  const width = Number(svg.match(/<svg[^>]*\bwidth="(\d+)"/)?.[1] ?? 1920);
  const height = Number(svg.match(/<svg[^>]*\bheight="(\d+)"/)?.[1] ?? 1200);
  const result = spawnSync(
    executablePath,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--no-first-run",
      "--no-default-browser-check",
      "--force-device-scale-factor=1",
      `--window-size=${width},${height}`,
      `--screenshot=${target}`,
      pathToFileURL(source).href,
    ],
    { stdio: "inherit" },
  );

  if (result.status !== 0 || !fs.existsSync(target)) {
    throw new Error(`Failed to render ${name}.svg`);
  }
}
