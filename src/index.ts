import { chromium } from 'playwright';
import { Browser } from './browser-adaptor/browser.js';

async function visitCaptchaSite() {
    // Launch the browser
    const browser = await chromium.launch({ headless: false });
    const browserWrapper = new Browser({ headless: false }, browser);
    const context = await browserWrapper.newContext();
    await context.createNewTab();
    const page = await context.getCurrentPage();

    // Navigate to the specified URL
    console.log('Navigating to captcha demo site...');
    await page.goto('https://2captcha.com/demo/cloudflare-turnstile');

    const state = await context.getState();

    // Wait for a few seconds
    const waitTimeSeconds = 20;
    console.log(`Waiting for ${waitTimeSeconds} seconds...`);
    await page.waitForTimeout(waitTimeSeconds * 1000);

    // Close the browser
    console.log('Closing browser...');
    await context.close();
}

// Execute the function
visitCaptchaSite()
    .then(() => console.log('Done!'))
    .catch(error => {
        console.error('Error occurred:', error);
        process.exit(1);
    });