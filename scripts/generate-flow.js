#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const RECORDINGS_DIR = path.join(__dirname, "..", "recordings");
const FLOWS_DIR = path.join(__dirname, "..", "flows");

/**
 * Convert a label string to a camelCase param name.
 * Strips common prefixes like "Enter your ", "Enter ", then camelCases.
 */
function labelToParamName(label) {
  let cleaned = label
    .replace(/^Enter your\s+/i, "")
    .replace(/^Enter\s+/i, "")
    .replace(/\(.*?\)/g, "") // remove parenthesized content like (mins)
    .trim();

  // Extract parenthesized hint as suffix (e.g., "Cadence (mins)" → "cadenceMins")
  const parenMatch = label.match(/\((\w+)\)/);
  const suffix = parenMatch ? parenMatch[1] : "";

  // camelCase: split on spaces/non-alphanumeric, capitalize each word after first
  const words = cleaned
    .split(/[\s\-_]+/)
    .filter(Boolean)
    .map((w) => w.replace(/[^a-zA-Z0-9]/g, ""));

  if (suffix) words.push(suffix);

  const result = words
    .map((w, i) =>
      i === 0
        ? w.toLowerCase()
        : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
    )
    .join("");

  // Only accept valid JS identifiers; let callers provide context-specific fallbacks.
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(result) ? result : "";
}

/**
 * Check whether a snippet of code has balanced (), [], {} outside string literals.
 * Used to detect multi-line await statements that must be kept intact.
 */
function isBalanced(code) {
  let depth = 0;
  let inString = null;
  let escape = false;
  for (const ch of code) {
    if (escape) { escape = false; continue; }
    if (inString) {
      if (ch === "\\") { escape = true; continue; }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") { inString = ch; continue; }
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
  }
  return depth === 0;
}

/**
 * Parse a recording file and extract actions, parameterizing fill/setInputFiles/selectOption.
 * Returns { actions: string[], extractedParams: object }
 */
function parseRecording(recordingContent) {
  // Normalize multi-line function calls onto a single line before parsing.
  // Handles cases where Claude's stabilizer splits .fill(), .selectOption() etc. across lines:
  //   .fill(\n  'value'\n)  →  .fill('value')
  let normalized = recordingContent
    .replace(/\.\s*(fill|selectOption|setInputFiles)\s*\(\s*\n\s*(['"`])([\s\S]*?)\2\s*\)/g,
      (_, method, q, val) => `.${method}(${q}${val}${q})`)
    .replace(/\.goto\s*\(\s*(['"`])([\s\S]*?)\1\s*,\s*\{[\s\S]*?\}\s*\)/g,
      (_, q, url) => `.goto(${q}${url}${q})`);

  const lines = normalized.split("\n");
  const actions = [];
  const extractedParams = {};
  let inLogin = false;
  let loginDone = false;
  let skipUntilLoginClick = false;
  let firstGotoSkipped = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip boilerplate
    if (
      trimmed === "" ||
      trimmed.startsWith("const {") ||
      trimmed.startsWith("const browser") ||
      trimmed.startsWith("const context") ||
      trimmed.startsWith("const page") ||
      trimmed === "(async () => {" ||
      trimmed === "})();" ||
      trimmed.startsWith("await context.close()") ||
      trimmed.startsWith("await browser.close()") ||
      trimmed.startsWith("// -----")
    ) {
      continue;
    }

    // Skip require line
    if (trimmed.includes("require('playwright')") || trimmed.includes('require("playwright")')) {
      continue;
    }

    // Skip browser/context setup
    if (
      trimmed.includes("chromium.launch") ||
      trimmed.includes("browser.newContext") ||
      trimmed.includes("browser.newPage") ||
      trimmed.includes("context.newPage")
    ) {
      continue;
    }

    // Detect login block: starts with page.goto to a URL with "login" in the path (not domain)
    if (!loginDone && trimmed.includes("page.goto(")) {
      const urlMatch = trimmed.match(/page\.goto\(\s*['"]([^'"]+)['"]\s*\)/);
      if (urlMatch) {
        // Always extract the first goto URL as loginUrl
        if (!extractedParams.loginUrl) {
          extractedParams.loginUrl = urlMatch[1];
        }
        try {
          const urlPath = new URL(urlMatch[1]).pathname;
          if (urlPath.toLowerCase().includes("login")) {
            inLogin = true;
            skipUntilLoginClick = true;
            continue;
          }
        } catch {}
      }
    }

    // For non-login flows, skip the first page.goto (handled by the flow template)
    if (!loginDone && !inLogin && trimmed.includes("page.goto(") && !firstGotoSkipped) {
      // Extract loginUrl from first goto if not already set
      const urlMatch = trimmed.match(/page\.goto\(\s*['"]([^'"]+)['"]\s*\)/);
      if (urlMatch && !extractedParams.loginUrl) {
        extractedParams.loginUrl = urlMatch[1];
      }
      firstGotoSkipped = true;
      continue;
    }

    // Inside login block: extract email/password from fill() calls, then skip
    if (skipUntilLoginClick) {
      const loginFill = trimmed.match(/\.fill\(\s*'([^']*)'\s*\)/);
      if (loginFill) {
        const val = loginFill[1];
        if (val.includes("@") && !extractedParams.email) {
          extractedParams.email = val;
        } else if (!extractedParams.password) {
          extractedParams.password = val;
        }
      }
      if (trimmed.includes("'Log In'") || trimmed.includes('"Log In"')) {
        skipUntilLoginClick = false;
        inLogin = false;
        loginDone = true;
      }
      continue;
    }

    // Only process lines that look like await page.* actions or comments
    if (!trimmed.startsWith("await page.") && !trimmed.startsWith("//")) {
      continue;
    }

    // Multi-line await page.*(...) (e.g. page.evaluate(() => { ... })):
    // slurp subsequent lines until parens/braces balance, then emit the whole
    // block as a single pass-through action. Preserves relative indentation.
    if (trimmed.startsWith("await page.") && !isBalanced(trimmed)) {
      const baseIndent = line.match(/^\s*/)[0].length;
      const buffer = [line];
      let j = i + 1;
      while (j < lines.length && !isBalanced(buffer.join("\n"))) {
        buffer.push(lines[j]);
        j++;
      }
      actions.push(buffer.map((l) => "  " + l.slice(baseIndent)).join("\n"));
      i = j - 1;
      continue;
    }

    // Parameterize .fill() calls
    const fillMatch = trimmed.match(
      /^await page\.(getByRole\([^)]+,\s*\{\s*name:\s*'([^']+)'\s*\}\))\.(?:click|press|dblclick)\(\s*.*?\)\s*;?\s*$/
    );

    const fillValueMatch = trimmed.match(
      /^await page\.(getByRole\([^)]+,\s*\{\s*name:\s*'([^']+)'\s*\}\))\.fill\(\s*'([^']*)'\s*\)\s*;?\s*$/
    );

    if (fillValueMatch) {
      const [, selector, label, value] = fillValueMatch;
      const paramName = labelToParamName(label) || "inputValue";

      // Don't duplicate params — use a counter if name already taken with different value
      let finalParamName = paramName;
      if (extractedParams[paramName] !== undefined && extractedParams[paramName] !== value) {
        let counter = 2;
        while (extractedParams[`${paramName}${counter}`] !== undefined) counter++;
        finalParamName = `${paramName}${counter}`;
      }

      extractedParams[finalParamName] = value;
      actions.push(`  await page.${selector}.fill(params.${finalParamName});`);
      continue;
    }

    // Parameterize .fill() on generic selectors (like .nth(2))
    const genericFillMatch = trimmed.match(
      /^await page\.(.*?)\.fill\(\s*'([^']*)'\s*\)\s*;?\s*$/
    );
    if (genericFillMatch && !trimmed.includes("getByRole")) {
      // For generic selectors without a label, try to derive from context
      // Just pass through as-is since we can't derive a good param name
      actions.push(`  ${trimmed}`);
      continue;
    }

    // Parameterize .setInputFiles()
    const inputFilesMatch = trimmed.match(
      /^await page\.(.*?)\.setInputFiles\(\s*'([^']*)'\s*\)\s*;?\s*$/
    );
    if (inputFilesMatch) {
      const [, selector, filePath] = inputFilesMatch;
      extractedParams.imageFile = filePath;
      actions.push(`  await page.${selector}.setInputFiles(params.imageFile);`);
      continue;
    }

    // Parameterize .selectOption()
    const selectOptionMatch = trimmed.match(
      /^await page\.(.*?)\.selectOption\(\s*'([^']*)'\s*\)\s*;?\s*$/
    );
    if (selectOptionMatch) {
      const [, selector, value] = selectOptionMatch;
      // Derive param name from value
      const cleanValue = value.replace(/"/g, "");
      const paramName = labelToParamName(cleanValue) || "selectOption";
      extractedParams[paramName] = cleanValue;
      actions.push(`  await page.${selector}.selectOption(params.${paramName});`);
      continue;
    }

    // Also handle selectOption with double-quoted inner value: '"deposit"'
    const selectOptionQuotedMatch = trimmed.match(
      /^await page\.(.*?)\.selectOption\(\s*'"([^']*)"\s*'\)\s*;?\s*$/
    );
    if (selectOptionQuotedMatch) {
      const [, selector, value] = selectOptionQuotedMatch;
      const paramName = labelToParamName(value) || "selectOption";
      extractedParams[paramName] = value;
      actions.push(`  await page.${selector}.selectOption(params.${paramName});`);
      continue;
    }

    // Pass through other actions (clicks, navigation, etc.)
    actions.push(`  ${trimmed}`);
  }

  return { actions, extractedParams, hasLogin: loginDone };
}

/**
 * Flag fragile selectors with inline comments so they're visible in generated flows.
 * Also trims over-long getByText selectors.
 */
function stabilizeSelectors(actions) {
  return actions.map((line) => {
    const trimmed = line.trim();

    // Flag Bubble random IDs
    if (/#P\d+/.test(trimmed)) {
      return `${line} // FRAGILE: Bubble random ID — add a stable ID in Bubble editor`;
    }

    // Flag positional selectors
    if (/\.nth\(\d+\)/.test(trimmed)) {
      return `${line} // FRAGILE: positional selector — may break if layout changes`;
    }

    // Flag empty text filters
    if (/filter\(\{\s*hasText:\s*''\s*\}\)/.test(trimmed)) {
      return `${line} // FRAGILE: empty text filter`;
    }

    // Trim over-long getByText selectors
    const longTextMatch = trimmed.match(/getByText\('([^']{61,})'\)/);
    if (longTextMatch) {
      const fullText = longTextMatch[1];
      // Take first 40 chars as a keyword substring
      const short = fullText.substring(0, 40).trim();
      const replaced = line.replace(
        `getByText('${fullText}')`,
        `getByText('${short}', { exact: false })`
      );
      return `${replaced} // STABILIZED: trimmed long text selector`;
    }

    return line;
  });
}

/**
 * Remove redundant actions that codegen produces:
 * - Duplicate .click() before .fill() on the same element
 * - .press('Tab') between fields
 * - .click() on non-interactive text blocks (long getByText with no subsequent fill)
 */
function cleanRedundantActions(actions) {
  const cleaned = [];

  for (let i = 0; i < actions.length; i++) {
    const current = actions[i].trim();
    const next = i + 1 < actions.length ? actions[i + 1].trim() : "";

    // Skip .click() if the next action is .fill() on the same element
    if (current.includes(".click()") || current.includes(".click();")) {
      const clickSelector = current.match(/page\.(.*?)\.click/);
      const fillSelector = next.match(/page\.(.*?)\.fill/);
      if (clickSelector && fillSelector && clickSelector[1] === fillSelector[1]) {
        continue; // Skip the redundant click
      }
    }

    // Skip .press('Tab') between fields
    if (/\.press\(\s*['"]Tab['"]\s*\)/.test(current)) {
      continue;
    }

    // Skip .dblclick() if followed by .fill() on the same element
    if (current.includes(".dblclick()")) {
      const dblSelector = current.match(/page\.(.*?)\.dblclick/);
      const fillSelector = next.match(/page\.(.*?)\.fill/);
      if (dblSelector && fillSelector && dblSelector[1] === fillSelector[1]) {
        continue;
      }
    }

    // Skip .press('ControlOrMeta+a') before .fill() on the same element (select-all before overwrite)
    if (/\.press\(\s*['"]ControlOrMeta\+a['"]\s*\)/.test(current)) {
      const pressSelector = current.match(/page\.(.*?)\.press/);
      const fillSelector = next.match(/page\.(.*?)\.fill/);
      if (pressSelector && fillSelector && pressSelector[1] === fillSelector[1]) {
        continue;
      }
    }

    cleaned.push(actions[i]);
  }

  return cleaned;
}

/**
 * Generate a flow file and update config from a recording.
 * @param {string} flowName
 * @param {object} options
 * @param {boolean} options.force - Overwrite existing flow file
 */
function generateFlow(flowName, options = {}) {
  const recordingPath = path.join(RECORDINGS_DIR, `${flowName}-recording.js`);
  const flowPath = path.join(FLOWS_DIR, `${flowName}.flow.js`);
  const configPath = path.join(FLOWS_DIR, `${flowName}.config.json`);

  // Check recording exists
  if (!fs.existsSync(recordingPath)) {
    console.error(`Error: Recording not found: ${recordingPath}`);
    console.error(`Run: npm run record -- ${flowName}`);
    return false;
  }

  // Check if flow file already exists
  if (fs.existsSync(flowPath) && !options.force) {
    console.warn(`Warning: Flow file already exists: ${flowPath}`);
    console.warn(`Use --force to overwrite.`);
    return false;
  }

  const recordingContent = fs.readFileSync(recordingPath, "utf-8");
  const { actions: rawActions, extractedParams, hasLogin } = parseRecording(recordingContent);

  // Post-processing passes
  const cleaned = cleanRedundantActions(rawActions);
  const actions = stabilizeSelectors(cleaned);

  // Build the flow file content — adapt template based on whether login was detected
  let flowContent;
  if (hasLogin) {
    flowContent = `const { run, login } = require("./_helpers/flowRunner");

run("${flowName}", async (page, params, step) => {
  await step(1, "Login", async () => {
    await login(page, params.loginUrl, params.email, params.password);
  });

  await step(2, "Execute flow actions", async () => {
${actions.join("\n")}
  });
});
`;
  } else {
    flowContent = `const { run } = require("./_helpers/flowRunner");

run("${flowName}", async (page, params, step) => {
  await step(1, "Navigate to page", async () => {
    await page.goto(params.loginUrl);
  });

  await step(2, "Execute flow actions", async () => {
${actions.join("\n")}
  });
});
`;
  }

  // Ensure flows directory exists
  if (!fs.existsSync(FLOWS_DIR)) {
    fs.mkdirSync(FLOWS_DIR, { recursive: true });
  }

  // Write flow file
  fs.writeFileSync(flowPath, flowContent);
  console.log(`Generated flow: ${flowPath}`);

  // Update config.json — merge extracted params without overwriting existing keys
  let existingConfig = {};
  if (fs.existsSync(configPath)) {
    existingConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  }

  const mergedConfig = { ...existingConfig };

  // Ensure login fields exist — populate from extracted params if empty
  if (!mergedConfig.loginUrl) mergedConfig.loginUrl = extractedParams.loginUrl || "";
  if (!mergedConfig.email) mergedConfig.email = extractedParams.email || "";
  if (!mergedConfig.password) mergedConfig.password = extractedParams.password || "";

  // Add all other extracted params
  for (const [key, value] of Object.entries(extractedParams)) {
    if (!["loginUrl", "email", "password"].includes(key)) {
      mergedConfig[key] = value;
    }
  }

  fs.writeFileSync(configPath, JSON.stringify(mergedConfig, null, 2) + "\n");
  console.log(`Updated config: ${configPath}`);
  console.log(`Extracted ${Object.keys(extractedParams).length} param(s): ${Object.keys(extractedParams).join(", ") || "(none)"}`);

  return true;
}

// Standalone execution
if (require.main === module) {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const flowName = args.find((a) => !a.startsWith("--"));

  if (!flowName) {
    console.error("Usage: node scripts/generate-flow.js <flow-name> [--force]");
    process.exit(1);
  }

  const success = generateFlow(flowName, { force });
  process.exit(success ? 0 : 1);
}

module.exports = { generateFlow, parseRecording };
