const { run } = require("./_helpers/flowRunner");

run("e2e-login-test", async (page, params, step) => {
  await step(1, "Navigate to page", async () => {
    await page.goto(params.loginUrl);
  });

  await step(2, "Execute flow actions", async () => {
  // Step 1: Navigate to 8count login page
  await page.waitForLoadState('networkidle');
  });
});
