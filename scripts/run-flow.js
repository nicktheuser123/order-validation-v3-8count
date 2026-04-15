#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const flowsDir = path.join(__dirname, "..", "flows");
const flowName = process.argv[2];

if (!flowName) {
  const flows = fs.readdirSync(flowsDir)
    .filter((f) => f.endsWith(".flow.js"))
    .map((f) => f.replace(".flow.js", ""));

  console.log("Available flows:");
  flows.forEach((f) => console.log(`  - ${f}`));
  console.log("");
  console.log("Usage: npm run flow <flow-name>");
  process.exit(0);
}

const flowPath = path.join(flowsDir, `${flowName}.flow.js`);
if (!fs.existsSync(flowPath)) {
  console.error(`Flow not found: ${flowPath}`);
  process.exit(1);
}

require(flowPath);
