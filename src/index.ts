import { chromium } from 'playwright';
import { Browser } from './browser-adaptor/browser.js';
import { CaptchaAction, LLMConnector } from './llm-connectors/llm-connector.js';
import { GeminiConnector } from './llm-connectors/impl/gemini.js';

async function visitCaptchaSite() {
    // Launch the browser
    const browser = await chromium.launch({ headless: false });
    const browserWrapper = new Browser({ headless: false }, browser);
    const context = await browserWrapper.newContext();
    await context.createNewTab();
    const page = await context.getCurrentPage();

    // Navigate to the specified URL
    console.log('Navigating to captcha demo site...');
    await page.goto('https://2captcha.com/demo/recaptcha-v2');

    const clickAction: CaptchaAction = {
        action: 'click',
        location: {
            x: "10%",
            y: "50%"
        },
        actionState: 'creatingAction',
    };

    let state = await context.getState();

    context.queueCaptchaAction(clickAction);

    await context.getState();
    console.log('State:', state);

    // Wait for a few seconds
    const waitTimeSeconds = 20;
    console.log(`Waiting for ${waitTimeSeconds} seconds...`);
    await page.waitForTimeout(waitTimeSeconds * 1000);

    // Close the browser
    console.log('Closing browser...');
    await context.close();
}

async function queryGemini(query: string) {
    const connector = new GeminiConnector();
    const response = await connector.query(query);
    console.log('Gemini response:', response);
}

// Execute the function
visitCaptchaSite()
    .then(() => console.log('Done!'))
    .catch(error => {
        console.error('Error occurred:', error);
        process.exit(1);
    });