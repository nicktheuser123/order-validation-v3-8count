const { run } = require("./_helpers/flowRunner");

run("purchase flow v2", async (page, params, step) => {
  await step(1, "Navigate to page", async () => {
    await page.goto(params.loginUrl);
  });

  await step(2, "Execute flow actions", async () => {
  // ── Stage 1: Navigate to event page ─────────────────────────────────────────
  await page.waitForLoadState('domcontentloaded');
  // ── Stage 2: Open ticket selector and add 3 tickets ─────────────────────────
  await page.getByRole('button').click();
  await page.waitForLoadState('domcontentloaded');
  // ADD button appears when ticket count is 0; becomes +/– after first add
  await page.getByRole('button', { name: 'ADD' }).click();
  await page.waitForTimeout(500);
  // Set quantity to 3 via the combobox — more stable than clicking the "add"
  // increment button twice, which is not yet visible immediately after ADD.
  await page.locator('select').selectOption(params.selectOption);
  // ── Stage 3: Proceed to checkout ────────────────────────────────────────────
  // TODO: The "PROCEED TO CHECKOUT" Bubble element wraps a hidden <button> that
  // is not visible to Playwright's accessibility tree, so normal .click() and
  // force:true both fail. A JS evaluate click on the container's parent works.
  // Recommended fix: add element ID "proceed-to-checkout" in the Bubble editor
  // to the outer container so it can be targeted with page.locator('#proceed-to-checkout').click().
  await page.evaluate(() => {
    const allDivs = Array.from(document.querySelectorAll('div'));
    const textDiv = allDivs.find(
      d => d.childNodes.length === 1 &&
           d.textContent && d.textContent.trim() === 'PROCEED TO CHECKOUT'
    );
    if (textDiv && textDiv.parentElement) {
      textDiv.parentElement.click();
    } else if (textDiv) {
      textDiv.click();
    }
  });
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);
  // ── Stage 4: Fill registration / contact info ────────────────────────────────
  // Contact Info section (first Full Name / Email Address on the page)
  await page.getByRole('textbox', { name: 'Full Name' }).first().fill('Abhishek');
  await page.getByRole('textbox', { name: 'Email Address' }).fill(params.emailAddress);
  // Check "The contact information is the same for all tickets"
  await page.getByText('The contact information is the same for all tickets').click();
  await page.waitForTimeout(1000);
  // Check "I am the authorized cardholder for this purchase…"
  await page.getByText('I am the authorized cardholder for this purchase').click();
  await page.waitForTimeout(500);
  // ── Stage 5: Submit as guest ─────────────────────────────────────────────────
  await page.getByRole('button', { name: 'CONTINUE AS GUEST' }).click();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000);
  // Expected result: Step 2 Payment page showing
  //   3 x Standard   $150.00
  //   Service Fee      $6.00
  //   Order Total    $156.00
  });
});
