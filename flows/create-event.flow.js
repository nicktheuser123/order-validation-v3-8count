const { run } = require("./_helpers/flowRunner");

run("create-event", async (page, params, step) => {
  await step(1, "Navigate to page", async () => {
    await page.goto(params.loginUrl);
  });

  await step(2, "Execute flow actions", async () => {
  // Step 1: Navigate to app
  // Step 2: Dismiss cookie notice
  await page.getByRole('button').click();
  // Step 3: Navigate to login
  await page.getByRole('button', { name: 'Log In' }).click();
  // Steps 4-5: Fill login form (removed redundant .click() before .fill())
  await page.getByRole('textbox', { name: 'Enter email' }).fill(params.email);
  await page.getByRole('textbox', { name: 'Enter password' }).fill(params.password);
  // Step 6: Submit login and wait for navigation
  await page.getByRole('button', { name: 'Log In' }).click();
  await page.waitForLoadState('domcontentloaded');
  // Step 7: Navigate to Events section
  // Note: networkidle times out on Bubble due to persistent polling — use domcontentloaded
  await page.getByRole('heading', { name: 'Events', exact: true }).click();
  await page.waitForLoadState('domcontentloaded');
  // Step 8: Click Create event
  await page.getByRole('heading', { name: 'Create event' }).click();
  await page.waitForLoadState('domcontentloaded');
  // Step 9: Fill event name (removed ControlOrMeta+a and Tab press)
  await page.getByRole('textbox', { name: 'Enter your event name' }).fill(params.eventName);
  // Steps 10-13: Select scoresheet classes IASF and Rental
  await page.getByRole('textbox', { name: 'Scoresheet Classes' }).click();
  await page.getByRole('treeitem', { name: 'IASF' }).click();
  await page.getByRole('list').click();
  await page.getByRole('treeitem', { name: 'Rental' }).click();
  // Step 14: Fill Max Teams (removed redundant .click())
  await page.getByRole('textbox').nth(2).fill('123'); // FRAGILE: positional selector — may break if layout changes
  // Step 15-16: Fill venue location and select autocomplete suggestion
  // (removed redundant .click() before .fill(); added networkidle wait)
  await page.getByRole('textbox', { name: 'Enter your venue location (' }).fill(params.venueLocation);
  await page.getByText('New York, NY, USA', { exact: true }).click();
  // Step 17: Open Start Date calendar using stable element ID
  await page.locator('#event-start-date').click();
  // Calendar defaults to current month; select the 18th
  await page.getByRole('gridcell', { name: '/18/2026' }).click();
  // Step 18: Open End Date calendar using stable element ID
  await page.locator('#event-end-date').click();
  // Select the 20th
  await page.getByRole('gridcell', { name: '/20/2026' }).click();
  // Step 19: Fill schedule cadence (removed redundant .click())
  await page.getByRole('textbox', { name: 'Cadence (mins)' }).fill(params.cadenceMins);
  // Step 20: Fill event description (removed redundant .click())
  await page.getByRole('textbox', { name: 'Enter your event description' }).fill(params.eventDescription);
  // Step 21: Fill venue name (removed redundant .click())
  await page.getByRole('textbox', { name: 'Enter your venue name' }).fill(params.venueName);
  // Step 22: Fill hotel name (removed redundant .click())
  await page.getByRole('textbox', { name: 'Enter name of the hotel' }).fill(params.nameOfTheHotel);
  // Step 23: Select payment collection terms
  await page.locator('#dropdownpadded').selectOption(params.fullPayment);
  // Step 24: Submit form and wait for navigation to events list
  await page.getByRole('button', { name: 'Create Event' }).click();
  await page.waitForLoadState('domcontentloaded');
  });
});
