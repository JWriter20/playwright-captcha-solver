import { chromium } from 'patchright';
import type { WrappedSchema } from './llm-connectors/llm-connector.js';
import { GeminiConnector } from './llm-connectors/impl/gemini.js';
import { solveCaptchas, wrapContextToForceOpenShadowRoots } from './solver/solve-captcha.js';

async function visitCaptchaSite() {
    // Launch the browser
    const browser = await chromium.launch({ headless: false });
    let context = await browser.newContext();
    // context = await wrapContextToForceOpenShadowRoots(context);
    const page = await context.newPage();

    // Navigate to the specified URL
    console.log('Navigating to captcha demo site...');
    await page.goto('https://www.google.com/recaptcha/api2/demo');

    // Example action
    // const pendingAction: CaptchaAction = {
    //     action: 'click',
    //     location: {
    //         x: '10%',
    //         y: '50%'
    //     },
    //     actionState: 'creatingAction',
    // };

    // const foundCaptcha = await waitForCaptchaIframes(page);
    // const contentFrameElem = foundCaptcha[0].frame;
    // const contentFrame = await contentFrameElem.contentFrame();

    // await labelCaptchaActionOnFrame(contentFrame, pendingAction, 1);
    await solveCaptchas(page);

    // Wait for a few seconds
    const waitTimeSeconds = 20;
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

// console.log(await queryGemini("Please describe the following image", testImage, z.object({ response: z.string() })));

// Execute the function
visitCaptchaSite()
    .then(() => console.log('Done!'))
    .catch(error => {
        console.error('Error occurred:', error);
        process.exit(1);
    });