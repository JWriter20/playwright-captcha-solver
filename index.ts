import { chromium } from 'playwright';

async function visitCaptchaSite() {
    // Launch the browser
    const browser = await chromium.launch({ headless: false });
    const page = await browser.newPage();

    // Navigate to the specified URL
    console.log('Navigating to captcha demo site...');
    await page.goto('https://2captcha.com/demo/cloudflare-turnstile');

    // Wait for a few seconds
    const waitTimeSeconds = 5;
    console.log(`Waiting for ${waitTimeSeconds} seconds...`);
    await page.waitForTimeout(waitTimeSeconds * 1000);

    // Close the browser
    console.log('Closing browser...');
    await browser.close();
}

// Execute the function
visitCaptchaSite()
    .then(() => console.log('Done!'))
    .catch(error => {
        console.error('Error occurred:', error);
        process.exit(1);
    });