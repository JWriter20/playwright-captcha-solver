import { test, expect } from '@playwright/test';
import { chromium } from 'patchright';
import { getCaptchaIframes, waitForCaptchaIframes } from '../../src/find-captcha/get-active-captchas.js';
import { wrapContextToForceOpenShadowRoots } from '../../src/solver/solve-captcha.js';

test.describe('Captcha Detection Tests with Custom Wrapper', () => {

    test('should detect reCAPTCHA v2 on 2captcha demo page', async () => {
        // Launch the browser with your custom wrapper
        const browser = await chromium.launch({ headless: false });
        let context = await browser.newContext();
        // context = await wrapContextToForceOpenShadowRoots(context);
        const page = await context.newPage();

        await page.goto('https://2captcha.com/demo/recaptcha-v2');
        await page.waitForLoadState('networkidle');

        const foundCaptcha = await waitForCaptchaIframes(page);

        expect(foundCaptcha.length).toBe(1);
        expect(foundCaptcha[0].vendor).toBe('recaptcha');
        expect(foundCaptcha[0].type).toBe('checkbox');

        // Close the browser
        await browser.close();
    });

    test('should detect Cloudflare Turnstile on demo page', async () => {
        // Launch the browser with your custom wrapper
        const browser = await chromium.launch({ headless: false });
        let context = await browser.newContext();
        // context = await wrapContextToForceOpenShadowRoots(context);
        const page = await context.newPage();

        await page.goto('https://2captcha.com/demo/cloudflare-turnstile');

        const foundCaptcha = await waitForCaptchaIframes(page);
        console.log(foundCaptcha);

        expect(foundCaptcha.length).toBe(1);
        expect(foundCaptcha[0].vendor).toBe('cloudflare');
        expect(foundCaptcha[0].type).toBe('turnstile');

        // Close the browser
        await browser.close();
    });

    test('should detect hCaptcha on demo page', async () => {
        // Launch the browser with your custom wrapper
        const browser = await chromium.launch({ headless: false });
        let context = await browser.newContext();
        // context = await wrapContextToForceOpenShadowRoots(context);
        const page = await context.newPage();

        await page.goto('https://accounts.hcaptcha.com/demo');
        await page.waitForSelector('body');

        const foundCaptcha = await waitForCaptchaIframes(page);

        expect(foundCaptcha.length).toBe(1);
        expect(foundCaptcha[0].vendor).toBe('hcaptcha');
        expect(foundCaptcha[0].type).toBe('checkbox');

        // Close the browser
        await browser.close();
    });

    test('should not detect captcha on a page without captcha', async () => {
        // Launch the browser with your custom wrapper
        const browser = await chromium.launch({ headless: false });
        let context = await browser.newContext();
        // context = await wrapContextToForceOpenShadowRoots(context);
        const page = await context.newPage();

        await page.goto('https://example.com');
        await page.waitForSelector('body');

        const foundCaptcha = await waitForCaptchaIframes(page);

        expect(foundCaptcha.length).toBe(0);

        // Close the browser
        await browser.close();
    });

});

