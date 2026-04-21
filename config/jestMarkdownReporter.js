/**
 * Custom Jest reporter that writes test results to test-results.md.
 * Runs alongside the default reporter (console output unchanged).
 *
 * Layout (per suite):
 *   1. Run header + summary table
 *   2. Overview table — one row per assertion (name, status, duration)
 *   3. Per-Order Results — one subsection per orderId, table of tests touching it
 *   4. Aggregate Results — table of tests with no orderId (reporting daily etc.)
 *   5. Failures — stack traces, only when there are failed assertions
 */

const fs = require("fs");
const path = require("path");
const { getStepsForTest, clear } = require("./testResultsLogger");

const NUM_EPSILON = 1e-6;

function isNumericLike(v) {
  if (typeof v === "number") return Number.isFinite(v);
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return true;
  return false;
}

function toNum(v) {
  return typeof v === "number" ? v : Number(v);
}

function fmtVal(v) {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

function statusBadge(status) {
  if (status === "passed") return "✅ Passed";
  if (status === "failed") return "❌ Failed";
  if (status === "skipped" || status === "pending" || status === "todo") return "⏭️ Skipped";
  return status;
}

function rowBadge(pass) {
  return pass ? "✅" : "❌";
}

function escapeCell(v) {
  return String(v).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

/**
 * Derive an { expected, actual, kind } triple from a step's details bag.
 * kind: "pair" (numeric compare), "presence" (truthy check), "none" (no comparable data).
 */
function extractPair(details) {
  const d = details || {};

  if (d.expected !== undefined && d.stored !== undefined) {
    return { expected: d.expected, actual: d.stored, kind: "pair" };
  }
  if (d.sumAddonGross !== undefined && d.storedOrderGross !== undefined) {
    return { expected: d.sumAddonGross, actual: d.storedOrderGross, kind: "pair" };
  }
  if (d.calculated !== undefined && d.stored !== undefined) {
    return { expected: d.calculated, actual: d.stored, kind: "pair" };
  }
  if (d.storedSum !== undefined && d.calculated !== undefined) {
    return { expected: d.calculated, actual: d.storedSum, kind: "pair" };
  }
  if (d.calculated !== undefined && d.reported !== undefined) {
    return { expected: d.calculated, actual: d.reported, kind: "pair" };
  }

  if (d.status !== undefined) return { expected: d.status, actual: "—", kind: "presence" };
  if (d.paymentMethod !== undefined) return { expected: d.paymentMethod, actual: "—", kind: "presence" };
  if (d.orderIdDisplay !== undefined) return { expected: d.orderIdDisplay, actual: "—", kind: "presence" };
  if (d.eventId !== undefined) return { expected: d.eventId, actual: "—", kind: "presence" };
  if (d.hasUser !== undefined || d.isGuest !== undefined) {
    const label = d.hasUser ? "user" : d.isGuest ? "guest" : "neither";
    return { expected: label, actual: "—", kind: d.hasUser || d.isGuest ? "presence" : "none" };
  }

  return { expected: "—", actual: "—", kind: "none" };
}

/**
 * Return true/false for whether a row reads as passing. Falls back to Jest's own
 * verdict when the step bag didn't carry a recognisable pair.
 */
function rowPass(pair, jestStatus) {
  if (pair.kind === "pair") {
    if (isNumericLike(pair.expected) && isNumericLike(pair.actual)) {
      return Math.abs(toNum(pair.expected) - toNum(pair.actual)) < NUM_EPSILON;
    }
    return String(pair.expected) === String(pair.actual);
  }
  if (pair.kind === "presence") {
    return pair.expected !== undefined && pair.expected !== null && pair.expected !== "" && pair.expected !== false;
  }
  return jestStatus === "passed";
}

/**
 * Given a single assertion + its recorded steps, return:
 *  { perOrder: Map<orderId, Array<row>>, aggregate: Array<row> }
 * Each row: { testName, label, expected, actual, pass }.
 */
function projectAssertion(assertion, steps, fieldCalculations) {
  const perOrder = new Map();
  const aggregate = [];
  const testName = assertion.title;

  const pushRow = (bucket, row) => bucket.push(row);

  for (const s of steps) {
    const details = s.details || {};
    const orderId = details.orderId;
    const pair = extractPair(details);
    const pass = rowPass(pair, assertion.status);
    const addonSuffix = details.addonId ? ` (addon ${String(details.addonId).slice(-8)})` : "";
    const row = {
      testName,
      label: `${testName}${addonSuffix}`,
      expected: pair.expected,
      actual: pair.actual,
      pass,
      kind: pair.kind
    };

    if (orderId) {
      if (!perOrder.has(orderId)) perOrder.set(orderId, []);
      pushRow(perOrder.get(orderId), row);
    } else {
      pushRow(aggregate, row);
    }
  }

  // Legacy fieldCalculations path — treat as aggregate rows.
  for (const fc of fieldCalculations || []) {
    if (fc.expected !== undefined || fc.actual !== undefined) {
      const pair = { expected: fc.expected, actual: fc.actual, kind: "pair" };
      aggregate.push({
        testName,
        label: `${testName} — ${fc.fieldName}`,
        expected: fc.expected,
        actual: fc.actual,
        pass: rowPass(pair, assertion.status),
        kind: "pair"
      });
    }
  }

  return { perOrder, aggregate };
}

class JestMarkdownReporter {
  constructor(globalConfig) {
    this._globalConfig = globalConfig;
    this._rootDir = globalConfig.rootDir || process.cwd();
    this._outputPath = path.join(this._rootDir, "test-results.md");
  }

  _resolveOutputPath(testResults) {
    if (!testResults || testResults.length === 0) return this._outputPath;
    const relativePaths = testResults.map((r) => path.relative(this._rootDir, r.testFilePath));
    const topDirs = new Set(relativePaths.map((p) => p.split(path.sep)[0]));
    if (topDirs.size === 1) {
      const topDir = [...topDirs][0];
      if (topDir !== "tests" && topDir !== ".") {
        return path.join(this._rootDir, topDir, "test-results.md");
      }
    }
    return this._outputPath;
  }

  onRunStart() {
    clear();
  }

  onRunComplete(_contexts, results) {
    const { testResults, startTime, numFailedTests, numPassedTests, numPendingTests } = results;
    const total = numPassedTests + numFailedTests + numPendingTests;
    const statusLine =
      total === 0
        ? "No tests run"
        : `${numPassedTests} passed, ${numFailedTests} failed${numPendingTests > 0 ? `, ${numPendingTests} skipped` : ""}`;
    const runDate = new Date(startTime).toLocaleString();

    const sections = [];
    sections.push(`# Test Results`);
    sections.push("");
    sections.push(`| **Run** | **Status** |`);
    sections.push(`|---------|------------|`);
    const overallIcon = numFailedTests > 0 ? "❌" : "✅";
    sections.push(`| ${runDate} | ${overallIcon} ${statusLine} |`);
    sections.push("");
    sections.push("---");
    sections.push("");

    if (testResults.length === 0) {
      sections.push("No test suites ran.");
      fs.writeFileSync(this._resolveOutputPath(testResults), sections.join("\n").trimEnd() + "\n", "utf8");
      return;
    }

    // Summary table
    sections.push("## Summary");
    sections.push("");
    sections.push("| Suite | Passed | Failed | Skipped | Total |");
    sections.push("|-------|--------|--------|---------|-------|");
    for (const fileResult of testResults) {
      const firstAncestor = fileResult.testResults[0]?.ancestorTitles?.[0];
      const suiteTitle = firstAncestor || path.basename(fileResult.testFilePath, ".test.js").replace(/-/g, " ");
      const passed = fileResult.testResults.filter((t) => t.status === "passed").length;
      const failed = fileResult.testResults.filter((t) => t.status === "failed").length;
      const skipped = fileResult.testResults.filter(
        (t) => t.status === "skipped" || t.status === "pending" || t.status === "todo"
      ).length;
      const suiteTotal = fileResult.testResults.length;
      sections.push(`| ${suiteTitle} | ${passed} | ${failed} | ${skipped} | ${suiteTotal} |`);
    }
    sections.push("");
    sections.push("---");
    sections.push("");

    for (const fileResult of testResults) {
      const firstAncestor = fileResult.testResults[0]?.ancestorTitles?.[0];
      const suiteTitle = firstAncestor || path.basename(fileResult.testFilePath, ".test.js").replace(/-/g, " ");
      sections.push(`## ${suiteTitle}`);
      sections.push("");

      // ── Overview ───────────────────────────────────────────────────────
      sections.push("### Overview");
      sections.push("");
      sections.push("| # | Test Case | Status | Duration |");
      sections.push("|---|-----------|--------|----------|");
      let rowNum = 1;
      for (const assertion of fileResult.testResults) {
        const { title, status, duration } = assertion;
        const durationStr = duration != null ? `${Math.round(duration)}ms` : "—";
        sections.push(`| ${rowNum} | ${escapeCell(title)} | ${statusBadge(status)} | ${durationStr} |`);
        rowNum++;
      }
      sections.push("");

      // ── Project steps into per-order + aggregate buckets ──────────────
      const perOrder = new Map(); // orderId → rows[]
      const aggregate = [];
      const failedAssertions = [];

      for (const assertion of fileResult.testResults) {
        const { fullName, status, failureMessages } = assertion;
        const { steps, fieldCalculations } = getStepsForTest(fileResult.testFilePath, fullName);
        const { perOrder: assertionPerOrder, aggregate: assertionAgg } = projectAssertion(
          assertion,
          steps,
          fieldCalculations
        );

        for (const [orderId, rows] of assertionPerOrder) {
          if (!perOrder.has(orderId)) perOrder.set(orderId, []);
          perOrder.get(orderId).push(...rows);
        }
        aggregate.push(...assertionAgg);

        if (status === "failed" && failureMessages && failureMessages.length > 0) {
          failedAssertions.push({ title: assertion.title, messages: failureMessages });
        }
      }

      // ── Per-Order Results ─────────────────────────────────────────────
      if (perOrder.size > 0) {
        sections.push("### Per-Order Results");
        sections.push("");
        for (const [orderId, rows] of perOrder) {
          sections.push(`#### Order ${orderId}`);
          sections.push("");
          sections.push("| Test | Expected | Actual | Status |");
          sections.push("|------|----------|--------|--------|");
          for (const row of rows) {
            sections.push(
              `| ${escapeCell(row.label)} | ${escapeCell(fmtVal(row.expected))} | ${escapeCell(fmtVal(row.actual))} | ${rowBadge(row.pass)} |`
            );
          }
          sections.push("");
        }
      }

      // ── Aggregate Results ─────────────────────────────────────────────
      if (aggregate.length > 0) {
        sections.push("### Aggregate Results");
        sections.push("");
        sections.push("| Test | Calculated | Reported | Status |");
        sections.push("|------|------------|----------|--------|");
        for (const row of aggregate) {
          sections.push(
            `| ${escapeCell(row.label)} | ${escapeCell(fmtVal(row.expected))} | ${escapeCell(fmtVal(row.actual))} | ${rowBadge(row.pass)} |`
          );
        }
        sections.push("");
      }

      // ── Failures ──────────────────────────────────────────────────────
      if (failedAssertions.length > 0) {
        sections.push("### Failures");
        sections.push("");
        for (const f of failedAssertions) {
          sections.push(`#### ${f.title}`);
          sections.push("");
          for (const msg of f.messages) {
            sections.push("```");
            sections.push(msg.trim());
            sections.push("```");
          }
          sections.push("");
        }
      }
    }

    fs.writeFileSync(this._resolveOutputPath(testResults), sections.join("\n").trimEnd() + "\n", "utf8");
    clear();
  }
}

module.exports = JestMarkdownReporter;
