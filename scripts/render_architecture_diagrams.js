#!/usr/bin/env node
/* Render the maintained SVG architecture assets to PNG previews. */

const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const names = [
  "product-interaction-architecture",
  "technical-architecture",
  "runtime-event-lifecycle",
  "emergence-validation-loop",
];

(async () => {
  const browserCandidates = [
    process.env.PLAYWRIGHT_BROWSER_EXECUTABLE,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ].filter(Boolean);
  const executablePath = browserCandidates.find((candidate) => fs.existsSync(candidate));
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  try {
    for (const name of names) {
      const page = await browser.newPage({ viewport: { width: 1920, height: 1200 } });
      const source = path.join(root, `${name}.svg`);
      await page.goto(pathToFileURL(source).href);
      await page.locator("svg").screenshot({ path: path.join(root, `${name}.png`) });
      await page.close();
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exit(1);
});
