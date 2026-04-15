#!/usr/bin/env node
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const RECORDINGS_DIR = path.join(__dirname, "..", "recordings");
const flowName = process.argv[2];

let url;
let outputPath;

if (flowName) {
  const configPath = path.join(__dirname, "..", "flows", `${flowName}.config.json`);
  if (!fs.existsSync(configPath)) {
    console.error(`Error: Flow config not found: ${configPath}`);
    console.error("");
    console.error("Available flow configs:");
    const flowsDir = path.join(__dirname, "..", "flows");
    if (fs.existsSync(flowsDir)) {
      fs.readdirSync(flowsDir)
        .filter(f => f.endsWith(".config.json"))
        .forEach(f => console.error(`  ${f.replace(".config.json", "")}`));
    }
    process.exit(1);
  }
  const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  if (!config.loginUrl) {
    console.error(`Error: No loginUrl found in ${configPath}`);
    process.exit(1);
  }
  url = config.loginUrl;
  outputPath = path.join(RECORDINGS_DIR, `${flowName}-recording.js`);
} else {
  const { BASE_URL } = require("../testConfig");
  if (!BASE_URL || BASE_URL.trim() === "") {
    console.error("Error: BASE_URL is not set in testConfig.js");
    console.error("");
    console.error("Add your Bubble app URL, for example:");
    console.error('  const BASE_URL = "https://yourapp.bubbleapps.io";');
    console.error("  // or for test branch: https://yourapp.bubbleapps.io/version-test");
    console.error("");
    console.error("Then run: npm run record");
    process.exit(1);
  }
  url = BASE_URL;
  outputPath = path.join(RECORDINGS_DIR, "latest-recording.js");
}

if (!fs.existsSync(RECORDINGS_DIR)) {
  fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
}

console.log("Starting Playwright codegen at:", url);
console.log("Recording will be saved to:", outputPath);
console.log("Perform your flow in the browser, then stop recording to save.");
console.log("");

const child = spawn(
  "npx",
  [
    "playwright",
    "codegen",
    url,
    "-o",
    outputPath,
    "--target=javascript",
    "--test-id-attribute=id"
  ],
  {
    stdio: "inherit",
    shell: true,
    cwd: path.join(__dirname, "..")
  }
);

child.on("close", (code) => {
  if (code === 0) {
    console.log("");
    console.log("Recording saved to:", outputPath);
    if (flowName) {
      console.log("");
      const { generateFlow } = require("./generate-flow");
      generateFlow(flowName, { force: process.argv.includes("--force") });
    }
  }
  process.exit(code);
});
