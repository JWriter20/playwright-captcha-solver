import { chromium } from 'playwright';
import { Browser } from './browser-adaptor/browser.js';
import { CaptchaAction, CaptchaActionState, CaptchaActionType, LLMConnector, WrappedSchema } from './llm-connectors/llm-connector.js';
import { GeminiConnector } from './llm-connectors/impl/gemini.js';
import { z } from 'zod';

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

    await context.refreshPage();

    const clickAction: CaptchaAction = {
        action: CaptchaActionType.Click,
        location: {
            x: "10%",
            y: "50%"
        },
        actionState: CaptchaActionState.CreatingAction,
    };

    let state = await context.getState();

    await context.solveCaptcha();

    state = await context.getState();

    // print iframe states
    // console.log(state)


    // Wait for a few seconds
    const waitTimeSeconds = 2000;
    console.log(`Waiting for ${waitTimeSeconds} seconds...`);
    await page.waitForTimeout(waitTimeSeconds * 1000);

    // Close the browser
    console.log('Closing browser...');
    await context.close();
}

async function queryGemini(query: string, imageBase64?: string, schema?: WrappedSchema<string>) {
    const connector = new GeminiConnector();
    const response = await connector.queryWithImage(query, imageBase64, schema);
    console.log('Gemini response:', response);
}

const testImage = "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"


// console.log(await queryGemini("Please describe the following image", testImage, z.object({ response: z.string() })));

// Execute the function
visitCaptchaSite()
    .then(() => console.log('Done!'))
    .catch(error => {
        console.error('Error occurred:', error);
        process.exit(1);
    });