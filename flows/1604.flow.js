const { runStagehand } = require("./_helpers/stagehandRunner");

runStagehand("1604", async (stagehand, page, params, step) => {
  await step(1, 'Navigate to the event landing page', async () => {
    await page.goto(params.baseUrl);
await page.waitForLoadState('domcontentloaded');
  });

  await step(2, 'Click the ticket purchase CTA button (Buy Tickets / Get Tickets)', async () => {
    await stagehand.act("click the purple gradient button to buy or get tickets, such as 'Buy Tickets' or 'Get Tickets'");
  });

  await step(3, 'Click the ADD button on the first available ticket type', async () => {
    await stagehand.act("click the 'ADD' button on the first ticket row to add a ticket");
  });

  await step(4, 'Verify quantity is set to 1 (default) and proceed', async () => {
    await stagehand.act("verify the ticket quantity is 1; if a quantity dropdown or control is visible, ensure it shows 1");
  });

  await step(5, 'Click PROCEED TO CHECKOUT button', async () => {
    await stagehand.act("click the 'PROCEED TO CHECKOUT' button");
await page.waitForTimeout(3000);
  });

  await step(6, 'Fill in Full Name on the registration form', async () => {
    await stagehand.act("type %fullName% into the Full Name input field", { variables: { fullName: params.fullName } });
  });

  await step(7, 'Fill in Email Address on the registration form', async () => {
    await stagehand.act("type %email% into the Email Address input field", { variables: { email: params.email } });
  });

  await step(8, 'Fill per-ticket registration fields if visible', async () => {
    const ticketFields = await stagehand.observe("are there per-ticket registration fields visible below the main registration form?");
if (ticketFields && ticketFields.length > 0) {
  await stagehand.act("fill in the Full Name field for each ticket with %fullName%", { variables: { fullName: params.fullName } });
  await stagehand.act("fill in the Email Address field for each ticket with %email%", { variables: { email: params.email } });
}
  });

  await step(9, 'Click the CONTINUE or REGISTER & SAVE INFO button', async () => {
    await stagehand.act("click the 'CONTINUE' or 'REGISTER & SAVE INFO' purple gradient button");
await page.waitForTimeout(2000);
  });

  await step(10, 'Handle Signup/Login popup if it appears', async () => {
    const popup = await stagehand.observe("is there a signup or login popup visible on the screen?");
if (popup && popup.length > 0) {
  await stagehand.act("type %email% into the email field in the signup or login popup", { variables: { email: params.email } });
  await stagehand.act("click the submit, sign up, or continue button in the signup or login popup");
  await page.waitForTimeout(3000);
}
  });

  await step(11, 'Handle questionnaire if it appears (conditional step)', async () => {
    const questionnaire = await stagehand.observe("is there a questionnaire or order questions form visible?");
if (questionnaire && questionnaire.length > 0) {
  await stagehand.act("answer all visible questions in the questionnaire form");
  await stagehand.act("click the 'CONTINUE' button to proceed past the questionnaire");
  await page.waitForTimeout(2000);
}
  });

  await step(12, 'Verify Full Name in checkout Confirm Order Details section', async () => {
    await stagehand.act("verify the Full Name field in the Confirm Order Details section shows %fullName%; if it is empty or incorrect, clear it and type %fullName%", { variables: { fullName: params.fullName } });
  });

  await step(13, 'Verify Email Address in checkout Confirm Order Details section', async () => {
    await stagehand.act("verify the Email Address field in the Confirm Order Details section shows %email%; if it is empty or incorrect, clear it and type %email%", { variables: { email: params.email } });
  });

  await step(14, 'Toggle the Terms and Conditions toggle to ON', async () => {
    await stagehand.act("click the Terms and Conditions toggle switch to enable it so that 'I agree to the Terms and Conditions' is accepted");
  });

  await step(15, 'Click the PAY NOW button', async () => {
    await stagehand.act("click the 'PAY NOW' or 'COMPLETE ORDER' purple gradient button");
await page.waitForTimeout(4000);
  });

  await step(16, 'Switch into the Authorize.NET iframe and fill in card details', async () => {
    const iframeElement = await page.waitForSelector('iframe', { timeout: 30000 });
const frame = await iframeElement.contentFrame();
await frame.waitForLoadState('domcontentloaded');

const cardInput = await frame.waitForSelector('input[id*="card"], input[name*="card"], input[placeholder*="card" i], input[id*="CardNum"]', { timeout: 15000 });
await cardInput.fill(params.cardNumber);

const expInput = await frame.waitForSelector('input[id*="exp"], input[name*="exp"], input[placeholder*="exp" i], input[id*="Expir"]', { timeout: 10000 });
await expInput.fill(params.expiration);

const cvvInput = await frame.waitForSelector('input[id*="cvv"], input[id*="ccv"], input[name*="cvv"], input[id*="Code"], input[placeholder*="cvv" i], input[placeholder*="security" i]', { timeout: 10000 });
await cvvInput.fill(params.cvv);
  });

  await step(17, 'Click the Pay/Submit button inside the Authorize.NET iframe', async () => {
    const iframeEl = await page.waitForSelector('iframe', { timeout: 15000 });
const frame2 = await iframeEl.contentFrame();
const submitBtn = await frame2.waitForSelector('button[type="submit"], input[type="submit"], button:has-text("Pay"), button:has-text("Submit")', { timeout: 10000 });
await submitBtn.click();
await page.waitForTimeout(5000);
  });

  await step(18, 'Wait for payment redirect and detect success or failure via URL parameter', async () => {
    try {
  await page.waitForURL(/success=yes/, { timeout: 60000 });
  console.log('Payment successful — success=yes detected in URL');
} catch (e) {
  const currentUrl = page.url();
  if (currentUrl.includes('success=no')) {
    console.log('Payment failed — success=no detected in URL');
  } else {
    console.log('Payment status unknown — URL:', currentUrl);
  }
}
  });

  await step(19, 'Confirm the order completion popup or confirmation view is shown', async () => {
    await page.waitForLoadState('domcontentloaded');
await stagehand.act("look for and acknowledge the 'Order completed' confirmation popup or confirmation view showing the event name and order summary");
  });
});
