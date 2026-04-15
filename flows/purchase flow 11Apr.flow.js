const { run } = require("./_helpers/flowRunner");

run("purchase flow 11Apr", async (page, params, step) => {
  await step(1, "Navigate to page", async () => {
    await page.goto(params.loginUrl);
  });

  await step(2, "Execute flow actions", async () => {
  // ── Stage 1: Navigate to event ────────────────────────────────────────────
  await page.waitForLoadState('domcontentloaded');
  // ── Stage 2: Add tickets to cart ─────────────────────────────────────────
  await page.getByRole('button').click();
  await page.waitForTimeout(800);
  // Click ADD to add the Standard ticket type to cart
  await page.getByRole('button', { name: 'ADD' }).click();
  await page.waitForTimeout(500);
  // Set quantity to 4 via combobox (more stable than clicking '+' 3 extra times)
  // Original recording used: add button + #add-item x2 + button.nth(3) x2 // FRAGILE: positional selector — may break if layout changes
  // The nth(3) selector was fragile — PROCEED TO CHECKOUT div intercepted it.
  // Using selectOption is the robust equivalent.
  await page.getByRole('combobox').selectOption(params.4);
  await page.waitForTimeout(400);
  // Proceed to checkout (click the container — the inner button is covered by the overlay text)
  await page.locator('.cnpqe0').click(); // PROCEED TO CHECKOUT group container
  await page.waitForTimeout(3500);       // Bubble needs time to create the order
  // ── Stage 3: Fill contact info ────────────────────────────────────────────
  // Fill Full Name in the Contact Info section (first Full Name textbox on page)
  await page.getByRole('textbox', { name: 'Full Name' }).first().fill('test');
  // Fill Email with intentional typo (matches original recording's validation test)
  await page.getByRole('textbox', { name: 'Email Address' }).fill(params.emailAddress);
  // Check "The contact information is the same for all tickets" (copies info to all ticket fields)
  await page.getByText('The contact information is the same for all tickets').click();
  await page.waitForTimeout(400);
  // Validate contact info — expect an error because email is invalid
  await page.getByRole('button', { name: 'check' }).first().click();
  await page.waitForTimeout(600);
  // Fix email and re-validate
  await page.getByRole('textbox', { name: 'Email Address' }).fill(params.emailAddress2);
  await page.getByRole('button', { name: 'check' }).first().click();
  await page.waitForTimeout(600);
  // ── Stage 4: Agree and continue as guest ─────────────────────────────────
  // Agree to authorized cardholder terms
  await page.getByText('I am the authorized').click();
  await page.waitForTimeout(400);
  // Continue as guest (skip registration)
  await page.getByRole('button', { name: 'CONTINUE AS GUEST' }).click();
  await page.waitForTimeout(1500);
  // ── Stage 5: Accept Terms and Conditions ─────────────────────────────────
  // Click the ionic-toggle label for the T&C agreement on the payment page
  await page.locator('label').click(); // label.ionic-toggle for T&C checkbox
  await page.waitForTimeout(400);
  // Flow complete — PAY NOW button is now active on the payment page
  // (not clicking PAY NOW to avoid real payment)
  });
});
