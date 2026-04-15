#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const RECORDINGS_DIR = path.join(__dirname, "..", "recordings");

const FRAGILE_PATTERNS = [
  {
    name: "Bubble random ID",
    regex: /#P\d+/,
    advice: "Add an ID attribute to this element in the Bubble editor.",
  },
  {
    name: "Positional selector",
    regex: /\.nth\(\d+\)/,
    advice: "May break if page layout changes. Add an ID or find a label-based alternative.",
  },
  {
    name: "Over-specific text match",
    test: (line) => {
      const m = line.match(/getByText\('([^']+)'\)/);
      return m && m[1].length > 60;
    },
    advice: "Text selector is very long. Use a shorter, more stable substring.",
  },
  {
    name: "Empty text filter",
    regex: /filter\(\{\s*hasText:\s*''\s*\}\)/,
    advice: "Empty hasText filter matches everything. Use a specific text or remove.",
  },
];

/**
 * Guess a meaningful ID for a fragile selector based on surrounding context.
 */
function suggestId(lines, lineIndex) {
  const hints = [];

  // Look at the next 3 lines for context clues
  for (let offset = 1; offset <= 3 && lineIndex + offset < lines.length; offset++) {
    const next = lines[lineIndex + offset].trim();

    // Date gridcell click → date picker
    if (next.includes("gridcell")) {
      // Check if we've already seen a date picker suggestion
      const prevLines = lines.slice(0, lineIndex).join("\n");
      if (!prevLines.match(/#P\d+/)) {
        hints.push("start-date-picker");
      } else {
        hints.push("end-date-picker");
      }
      break;
    }

    // Next month button → date picker
    if (next.includes("Next month") || next.includes("Previous month")) {
      const prevLines = lines.slice(0, lineIndex).join("\n");
      const priorDatePickers = (prevLines.match(/#P\d+/g) || []).length;
      hints.push(priorDatePickers === 0 ? "start-date-picker" : "end-date-picker");
      break;
    }

    // Fill action → derive from fill value or label
    const fillMatch = next.match(/\.fill\(\s*['"]([^'"]+)['"]\s*\)/);
    if (fillMatch) {
      hints.push(fillMatch[1].toLowerCase().replace(/\s+/g, "-") + "-input");
      break;
    }

    // selectOption → derive from option value
    const selectMatch = next.match(/\.selectOption\(\s*['"]([^'"]+)['"]\s*\)/);
    if (selectMatch) {
      hints.push(selectMatch[1].toLowerCase().replace(/\s+/g, "-") + "-select");
      break;
    }
  }

  // Look at preceding line for label context
  if (hints.length === 0 && lineIndex > 0) {
    const prev = lines[lineIndex - 1].trim();
    const labelMatch = prev.match(/name:\s*'([^']+)'/);
    if (labelMatch) {
      hints.push(labelMatch[1].toLowerCase().replace(/\s+/g, "-"));
    }
  }

  return hints[0] || null;
}

function auditRecording(flowName) {
  const recordingPath = path.join(RECORDINGS_DIR, `${flowName}-recording.js`);

  if (!fs.existsSync(recordingPath)) {
    console.error(`Error: Recording not found: ${recordingPath}`);
    console.error(`Run: npm run record -- ${flowName}`);
    process.exit(1);
  }

  const content = fs.readFileSync(recordingPath, "utf-8");
  const lines = content.split("\n");
  const issues = [];
  let totalSelectors = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Only check action lines
    if (!line.startsWith("await page.")) continue;
    totalSelectors++;

    for (const pattern of FRAGILE_PATTERNS) {
      let matched = false;

      if (pattern.regex) {
        matched = pattern.regex.test(line);
      } else if (pattern.test) {
        matched = pattern.test(line);
      }

      if (matched) {
        const suggestion = suggestId(lines, i);
        issues.push({
          line: i + 1,
          code: line,
          type: pattern.name,
          advice: pattern.advice,
          suggestedId: suggestion,
        });
        break; // One issue per line
      }
    }
  }

  // Print report
  console.log(`\n=== Recording Audit: ${flowName} ===\n`);

  if (issues.length === 0) {
    console.log("No fragile selectors found. Recording is stable.\n");
    console.log(`STABLE SELECTORS: ${totalSelectors}/${totalSelectors} (100%)\n`);
    return;
  }

  console.log(`FRAGILE SELECTORS FOUND: ${issues.length}\n`);

  for (const issue of issues) {
    console.log(`  Line ${issue.line}: ${issue.code}`);
    console.log(`    -> ${issue.type}. ${issue.advice}`);
    if (issue.suggestedId) {
      console.log(`    -> Suggested ID: "${issue.suggestedId}"`);
    }
    console.log("");
  }

  const stableCount = totalSelectors - issues.length;
  const pct = totalSelectors > 0 ? Math.round((stableCount / totalSelectors) * 100) : 100;
  console.log(`STABLE SELECTORS: ${stableCount}/${totalSelectors} (${pct}%)\n`);

  // Categorize action items
  const bubbleIds = issues.filter((i) => i.type === "Bubble random ID");
  const positional = issues.filter((i) => i.type === "Positional selector");
  const other = issues.filter(
    (i) => i.type !== "Bubble random ID" && i.type !== "Positional selector"
  );

  if (bubbleIds.length > 0) {
    console.log(
      `ACTION REQUIRED: Add Bubble IDs for ${bubbleIds.length} element(s), then re-record.`
    );
    for (const b of bubbleIds) {
      if (b.suggestedId) {
        console.log(`  - "${b.suggestedId}" (line ${b.line})`);
      }
    }
  }
  if (positional.length > 0) {
    console.log(
      `RECOMMENDED: Review ${positional.length} positional selector(s) for stability.`
    );
  }
  if (other.length > 0) {
    console.log(`NOTE: ${other.length} other fragile selector(s) found.`);
  }
  console.log("");
}

// CLI
if (require.main === module) {
  const flowName = process.argv[2];
  if (!flowName) {
    console.error("Usage: npm run audit <flow-name>");
    console.error("       node scripts/audit-recording.js <flow-name>");
    process.exit(1);
  }
  auditRecording(flowName);
}

module.exports = { auditRecording };
