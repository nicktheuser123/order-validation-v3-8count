const { run } = require("./_helpers/flowRunner");

run("login", async (page, params, step) => {
  await step(1, "Navigate to page", async () => {
    await page.goto(params.loginUrl);
  });

  await step(2, "Execute flow actions", async () => {
  // Step 1: Navigate to the 8Count login page
  // Step 2: Dismiss the cookie consent banner
  await page.getByRole('button', { name: 'Continue...' }).click();
  // Step 3: Click "Log In" to switch to the login form
  await page.getByRole('button', { name: 'Log In' }).click();
  await page.waitForLoadState('networkidle');
  // Step 4: Fill in email address
  await page.getByRole('textbox', { name: 'Enter email' }).fill(params.email);
  // Step 5: Fill in password
  await page.getByRole('textbox', { name: 'Enter password' }).fill(params.password);
  // Step 6: Submit the login form
  await page.getByRole('button', { name: 'Log In' }).click();
  // Step 7: Wait for navigation to the Event Producer dashboard
  await page.waitForURL('**/eventproducer**', { timeout: 15000 });
  // Step 8: Verify login success — Producer Dashboard heading is visible
  });
});
