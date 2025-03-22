import { test, expect, chromium } from '@playwright/test';
import { Browser } from '../../src/browser-adaptor/browser';
import { detectCaptchaFromState, detectCaptchas } from '../../src/find-captcha/get-active-captchas';

test.describe('Captcha Detection Tests with Custom Wrapper', () => {

    test('should detect reCAPTCHA v2 on 2captcha demo page', async () => {
        // Launch the browser with your custom wrapper
        const browser = await chromium.launch({ headless: false });
        const browserWrapper = new Browser({ headless: false }, browser);
        const context = await browserWrapper.newContext();
        await context.createNewTab();
        const page = await context.getCurrentPage();

        await page.goto('https://2captcha.com/demo/recaptcha-v2');
        await page.waitForLoadState('networkidle');

        // Retrieve the state from the context
        const state = await context.getState();

        // Pass both page and state into the detection function
        const result = detectCaptchaFromState(state);

        expect(result.present).toBe(true);
        expect(result.vendor).toBe('recaptcha');
        expect(result.type).toBe('checkbox');

        // Close the browser
        await browser.close();
    });

    test('should detect Cloudflare Turnstile on demo page', async () => {
        const browser = await chromium.launch({ headless: false });
        const browserWrapper = new Browser({ headless: false }, browser);
        const context = await browserWrapper.newContext();
        await context.createNewTab();
        const page = await context.getCurrentPage();

        await page.goto('https://2captcha.com/demo/cloudflare-turnstile');
        await page.waitForSelector('body');

        const state = await context.getState();
        const result = detectCaptchaFromState(state);

        expect(result.present).toBe(true);
        expect(result.vendor).toBe('cloudflare-turnstile');

        await browser.close();
    });

    test('should detect hCaptcha on demo page', async () => {
        const browser = await chromium.launch({ headless: false });
        const browserWrapper = new Browser({ headless: false }, browser);
        const context = await browserWrapper.newContext();
        await context.createNewTab();
        const page = await context.getCurrentPage();

        await page.goto('https://accounts.hcaptcha.com/demo');
        await page.waitForSelector('body');

        const state = await context.getState();
        const result = detectCaptchaFromState(state);

        expect(result.present).toBe(true);
        expect(result.vendor).toBe('hcaptcha');

        await browser.close();
    });

    test('should not detect captcha on a page without captcha', async () => {
        const browser = await chromium.launch({ headless: false });
        const browserWrapper = new Browser({ headless: false }, browser);
        const context = await browserWrapper.newContext();
        await context.createNewTab();
        const page = await context.getCurrentPage();

        await page.goto('https://example.com');
        await page.waitForSelector('body');

        const state = await context.getState();
        const result = detectCaptchaFromState(state);

        expect(result.present).toBe(false);

        await browser.close();
    });

});

