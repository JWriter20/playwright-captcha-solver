import { test, expect } from '@playwright/test';
import { detectVisibleCaptcha } from '../../src/find-captcha/get-active-captchas';

test.describe('Captcha Detection Tests', () => {
    test('should detect reCAPTCHA v2 on 2captcha demo page', async ({ page }) => {
        await page.goto('https://2captcha.com/demo/recaptcha-v2');
        await page.waitForLoadState('networkidle');

        const result = await detectVisibleCaptcha(page);

        expect(result.present).toBe(true);
        expect(result.vendor).toBe('recaptcha');
        expect(result.type).toBe('checkbox');
    });

    test('should detect Cloudflare Turnstile on demo page', async ({ page }) => {
        await page.goto('https://2captcha.com/demo/cloudflare-turnstile');
        await page.waitForSelector('body');

        const result = await detectVisibleCaptcha(page);

        expect(result.present).toBe(true);
        expect(result.vendor).toBe('turnstile');
    });

    test('should detect hCaptcha on demo page', async ({ page }) => {
        await page.goto('https://accounts.hcaptcha.com/demo');
        await page.waitForSelector('body');

        const result = await detectVisibleCaptcha(page);

        expect(result.present).toBe(true);
        expect(result.vendor).toBe('hcaptcha');
    });

    test('should not detect captcha on a page without captcha', async ({ page }) => {
        await page.goto('https://example.com');
        await page.waitForSelector('body');

        const result = await detectVisibleCaptcha(page);

        expect(result.present).toBe(false);
    });
});
