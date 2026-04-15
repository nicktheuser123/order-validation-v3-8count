const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });

const TEST_RESULTS_DIR = path.join(__dirname, "..", "..", "test-results");

/**
 * Login helper — handles cookie banner + credential entry.
 */
async function login(page, loginUrl, email, password) {
  await page.goto(loginUrl);

  // Handle optional cookie banner
  const continueBtn = page.getByRole("button", { name: "Continue..." });
  if (await continueBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await continueBtn.click();
  }

  await page.getByRole("textbox", { name: "Enter email" }).fill(email);
  await page.getByRole("textbox", { name: "Enter password" }).fill(password);
  await page.getByRole("button", { name: "Log In" }).click();
  await page.waitForURL("**/eventproducer**", { timeout: 60000 });
}

/**
 * Run a parameterized flow with step tracking and structured failure output.
 * @param {string} flowName — matches flows/<flowName>.config.json
 * @param {(page: import('playwright').Page, params: object, step: Function) => Promise<void>} fn
 */
async function run(flowName, fn) {
  const configPath = path.join(__dirname, "..", `${flowName}.config.json`);
  if (!fs.existsSync(configPath)) {
    console.error(`Config not found: ${configPath}`);
    console.error(`Create ${flowName}.config.json in the flows/ directory.`);
    process.exit(1);
  }

  const params = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  console.log(`Running flow: ${flowName}`);
  console.log(`Config loaded from: ${configPath}`);

  // Ensure test-results directory exists
  if (!fs.existsSync(TEST_RESULTS_DIR)) {
    fs.mkdirSync(TEST_RESULTS_DIR, { recursive: true });
  }

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Step tracking state
  let currentStepIndex = 0;
  let currentStepName = "";
  let completedSteps = 0;
  let totalSteps = 0;

  /**
   * Step wrapper for trackable execution.
   * @param {number} index — step number
   * @param {string} name — human-readable step description
   * @param {() => Promise<void>} fn — async function to execute
   */
  async function step(index, name, stepFn) {
    currentStepIndex = index;
    currentStepName = name;
    totalSteps = Math.max(totalSteps, index);
    console.log(`  Step ${index}: ${name}...`);
    await stepFn();
    completedSteps = index;
    console.log(`  Step ${index}: ${name} — done`);
  }

  try {
    await fn(page, params, step);
    console.log(`\nFlow "${flowName}" completed successfully.`);

    // Clean up any previous failure artifacts
    const failureJsonPath = path.join(TEST_RESULTS_DIR, `${flowName}-failure.json`);
    if (fs.existsSync(failureJsonPath)) {
      fs.unlinkSync(failureJsonPath);
    }
  } catch (err) {
    const screenshotPath = path.join(TEST_RESULTS_DIR, `${flowName}-failure.png`);

    // Try to capture screenshot
    try {
      await page.screenshot({ path: screenshotPath, fullPage: true });
    } catch {
      // Page may already be closed
    }

    const failureInfo = {
      flowName,
      failedStep: currentStepIndex,
      failedStepName: currentStepName,
      error: err.message,
      screenshot: screenshotPath,
      completedSteps,
      totalSteps,
    };

    const failureJsonPath = path.join(TEST_RESULTS_DIR, `${flowName}-failure.json`);
    fs.writeFileSync(failureJsonPath, JSON.stringify(failureInfo, null, 2));

    console.error(`\nFlow "${flowName}" failed at step ${currentStepIndex} (${currentStepName}):`);
    console.error(`  Error: ${err.message}`);
    console.error(`  Screenshot: ${screenshotPath}`);
    console.error(`  Failure details: ${failureJsonPath}`);
    process.exitCode = 1;
  } finally {
    await context.close();
    await browser.close();
  }
}

module.exports = { run, login };
