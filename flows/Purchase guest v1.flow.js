const { runStagehand } = require("./_helpers/stagehandRunner");

runStagehand("Purchase guest v1", async (stagehand, page, params, step) => {
  await step(1, 'Navigate to event landing page', async () => {
    await page.goto(params.baseUrl);
await page.waitForLoadState('networkidle');
  });

  await step(2, 'Click the ticket purchase CTA button (Buy Tickets / Get Tickets)', async () => {
    await stagehand.act('click the purple gradient button to buy or get tickets in the event info area');
await page.waitForLoadState('networkidle');
  });

  await step(3, 'Click the ADD button on the first available ticket type', async () => {
    await stagehand.act('click the ADD button on the first ticket type row');
await page.waitForTimeout(1000);
  });

  await step(4, 'Verify quantity is 1 (default) and proceed to checkout', async () => {
    await stagehand.act('scroll down to find the PROCEED TO CHECKOUT button');
await stagehand.act('click the PROCEED TO CHECKOUT button');
await page.waitForTimeout(3000);
  });

  await step(5, 'Fill in Full Name on registration form', async () => {
    await stagehand.act('type %fullName% into the Full Name input field', { variables: { fullName: params.fullName } });
  });

  await step(6, 'Fill in Email Address on registration form', async () => {
    await stagehand.act('type %email% into the Email Address input field', { variables: { email: params.email } });
  });

  await step(7, 'Fill per-ticket registration fields if visible', async () => {
    const perTicketFields = await stagehand.observe('Are there per-ticket registration name and email fields visible below the main registration form?');
if (perTicketFields && perTicketFields.length > 0) {
  await stagehand.act('fill in %fullName% for each per-ticket Full Name field', { variables: { fullName: params.fullName } });
  await stagehand.act('fill in %email% for each per-ticket Email Address field', { variables: { email: params.email } });
}
  });

  await step(8, 'Click the CONTINUE or REGISTER & SAVE INFO button', async () => {
    await stagehand.act('click the CONTINUE or REGISTER & SAVE INFO button (purple gradient button)');
await page.waitForTimeout(2000);
  });

  await step(9, 'Handle signup/login popup for guest user', async () => {
    const popup = await stagehand.observe('Is there a signup or login popup visible on the page?');
if (popup && popup.length > 0) {
  await stagehand.act('type %email% into the email field in the signup or login popup', { variables: { email: params.email } });
  await stagehand.act('click the continue, sign up, or submit button in the popup');
  await page.waitForTimeout(3000);
}
  });

  await step(10, 'Handle questionnaire if present', async () => {
    const questionnaire = await stagehand.observe('Is there a questionnaire or order questions form visible on the page?');
if (questionnaire && questionnaire.length > 0) {
  await stagehand.act('answer all visible questionnaire questions with appropriate responses');
  await stagehand.act('click the CONTINUE button to proceed past the questionnaire');
  await page.waitForTimeout(2000);
}
  });

  await step(11, 'Verify Full Name in checkout confirm order details section', async () => {
    await stagehand.act('find the Full Name input in the Confirm Order Details section and verify it shows Automated Guest; if empty or incorrect, clear it and type %fullName%', { variables: { fullName: params.fullName } });
  });

  await step(12, 'Verify Email Address in checkout confirm order details section', async () => {
    await stagehand.act('find the Email Address input in the Confirm Order Details section and verify it shows the correct email; if empty or incorrect, clear it and type %email%', { variables: { email: params.email } });
  });

  await step(13, 'Toggle the Terms and Conditions switch ON', async () => {
    await stagehand.act('click the Terms and Conditions toggle switch to turn it on so that I agree to the Terms and Conditions is enabled');
await page.waitForTimeout(500);
  });

  await step(14, 'Click the PAY NOW button', async () => {
    await stagehand.act('click the PAY NOW or COMPLETE ORDER button (purple gradient button in the payment section)');
await page.waitForTimeout(5000);
  });

  await step(15, 'Switch into the Authorize.NET iframe and fill card details', async () => {
    await page.waitForTimeout(3000);
const iframeElement = await page.waitForSelector('iframe', { timeout: 15000 });
const frame = await iframeElement.contentFrame();
await frame.waitForLoadState('networkidle');
await frame.waitForTimeout(2000);

const cardInput = await frame.waitForSelector('input[name="cardNumInput"], input[id*="card"], input[placeholder*="card" i], input[name*="card" i]', { timeout: 10000 });
await cardInput.click();
await cardInput.fill(params.cardNumber);

const expInput = await frame.waitForSelector('input[name="expDateInput"], input[id*="exp"], input[placeholder*="exp" i], input[name*="exp" i]', { timeout: 5000 });
await expInput.click();
await expInput.fill(params.expiration);

const cvvInput = await frame.waitForSelector('input[name="cvvInput"], input[id*="cvv"], input[placeholder*="cvv" i], input[name*="cvv" i], input[placeholder*="security" i]', { timeout: 5000 });
await cvvInput.click();
await cvvInput.fill(params.cvv);
  });

  await step(16, 'Submit the payment form inside the Authorize.NET iframe', async () => {
    const iframeElement2 = await page.waitForSelector('iframe', { timeout: 10000 });
const frame2 = await iframeElement2.contentFrame();
await frame2.waitForSelector('button[type="submit"], input[type="submit"], button:has-text("Pay"), button:has-text("Submit")', { timeout: 10000 });
await frame2.click('button[type="submit"], input[type="submit"], button:has-text("Pay"), button:has-text("Submit")');
await page.waitForTimeout(5000);
  });

  await step(17, 'Wait for redirect with success or failure URL parameter', async () => {
    await page.waitForURL(url => url.includes('success=yes') || url.includes('success=no'), { timeout: 30000 });
const currentUrl = page.url();
if (currentUrl.includes('success=yes')) {
  console.log('Payment successful! URL contains success=yes');
} else if (currentUrl.includes('success=no')) {
  console.log('Payment failed. URL contains success=no');
  throw new Error('Payment failed — success=no returned from Authorize.NET');
}
  });

  await step(18, 'Verify order completion confirmation', async () => {
    await page.waitForLoadState('networkidle');
await stagehand.observe('Is there an Order completed popup or confirmation view showing the event name, order summary, and purchased tickets?');
console.log('Order completion confirmed. Purchase flow completed successfully.');
  });
});
