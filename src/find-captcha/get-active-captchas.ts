import type { Page } from 'playwright';
import { EventEmitter } from 'events';

// Create an EventEmitter instance for captcha events.
export const captchaEventEmitter = new EventEmitter();

// Updated interface: now includes 'cloudflare-turnstile'
export interface CaptchaDetectionResult {
    present: boolean;
    vendor?: 'recaptcha' | 'hcaptcha' | 'cloudflare-turnstile';
    type?: string;
    details?: {
        iframe: string;
    };
}

/**
 * A wrapper function that returns an object containing our shared detection function.
 * Both the helper function `isVisible` and the main detection function are defined here,
 * so that they are available in the browser context.
 */
export function getDetectionFunctions() {
    function isVisible(elem: HTMLElement): boolean {
        const style = window.getComputedStyle(elem);
        return (
            (elem.offsetWidth > 0 || elem.offsetHeight > 0 || elem.getClientRects().length > 0) &&
            style.visibility !== 'hidden' &&
            style.display !== 'none'
        );
    }

    function detectCaptchaFromIframe(iframe: HTMLIFrameElement): any | null {
        if (!isVisible(iframe)) return null;

        // Check for reCAPTCHA iframes.
        if (
            iframe.src.includes('/recaptcha/api2/anchor') ||
            iframe.src.includes('/recaptcha/enterprise/anchor')
        ) {
            function getRecaptchaType(iframe: HTMLIFrameElement): string {
                if (iframe.src.includes('size=invisible')) {
                    const name = iframe.getAttribute('name');
                    let id = '';
                    if (name) {
                        const parts = name.split('-');
                        if (parts.length > 1) {
                            id = parts[1];
                        }
                    }
                    if (id) {
                        const challengeFrame = document.querySelector(
                            'iframe[src*="/recaptcha/"][src*="/bframe"][name="c-' + id + '"]'
                        ) as HTMLElement | null;
                        if (challengeFrame && isVisible(challengeFrame)) {
                            return 'invisible';
                        } else {
                            return 'score';
                        }
                    }
                    return 'invisible';
                }
                return 'checkbox';
            }
            return {
                vendor: 'recaptcha',
                type: getRecaptchaType(iframe),
                details: { iframe: iframe.outerHTML }
            };
        }

        // Check for hCaptcha iframes.
        if (iframe.src.includes('hcaptcha.com')) {
            return {
                vendor: 'hcaptcha',
                type: 'checkbox',
                details: { iframe: iframe.outerHTML }
            };
        }

        // New: Check for Cloudflare Turnstile iframes.
        // We look for typical substrings in the iframe URL.
        if (
            iframe.src.includes('turnstile') ||
            iframe.src.includes('challenges.cloudflare.com') ||
            iframe.src.includes('cdn-cgi/challenge-platform')
        ) {
            return {
                vendor: 'cloudflare-turnstile',
                type: 'turnstile',
                details: { iframe: iframe.outerHTML }
            };
        }

        return null;
    }

    return { detectCaptchaFromIframe };
}

/**
 * Checks the entire page for visible captcha iframes using the shared function.
 */
export async function detectVisibleCaptcha(page: Page): Promise<CaptchaDetectionResult> {
    await page.waitForLoadState('domcontentloaded');

    // Pass the detection functions as a string into the browser context.
    return await page.evaluate<CaptchaDetectionResult, string>((funcStr: string) => {
        // Recreate the detection functions by evaluating the wrapper.
        const getDetectionFunctions = eval('(' + funcStr + ')');
        const { detectCaptchaFromIframe } = getDetectionFunctions();

        // Check for reCAPTCHA iframes.
        const recaptchaIframes = Array.from(
            document.querySelectorAll(
                'iframe[src*="/recaptcha/api2/anchor"], iframe[src*="/recaptcha/enterprise/anchor"]'
            )
        );
        for (const iframe of recaptchaIframes) {
            const result = detectCaptchaFromIframe(iframe as HTMLIFrameElement);
            if (result) return { present: true, ...result };
        }
        // Check for hCaptcha iframes.
        const hcaptchaIframes = Array.from(document.querySelectorAll('iframe[src*="hcaptcha.com"]'));
        for (const iframe of hcaptchaIframes) {
            const result = detectCaptchaFromIframe(iframe as HTMLIFrameElement);
            if (result) return { present: true, ...result };
        }
        // New: Check for Cloudflare Turnstile iframes.
        const cloudflareIframes = Array.from(
            document.querySelectorAll(
                'iframe[src*="turnstile"], iframe[src*="challenges.cloudflare.com"], iframe[src*="cdn-cgi/challenge-platform"]'
            )
        );
        for (const iframe of cloudflareIframes) {
            const result = detectCaptchaFromIframe(iframe as HTMLIFrameElement);
            if (result) return { present: true, ...result };
        }
        return { present: false };
    }, getDetectionFunctions.toString());
}

/**
 * Attaches a listener for new iframes being added to the page.
 * For each new frame, the shared detection function is injected and used to check for a captcha.
 * If a captcha is detected, a "captchaDetected" event is emitted.
 */
export function attachIframeCaptchaListener(page: Page): void {
    page.on('frameattached', async (frame) => {
        try {
            const frameElementHandle = await frame.frameElement();

            // Pass both the iframe handle and the stringified detection functions to the page.
            const isCaptcha = await page.evaluate<boolean, { iframe: any; funcStr: string }>(
                (data) => {
                    const getDetectionFunctions = eval('(' + data.funcStr + ')');
                    const { detectCaptchaFromIframe } = getDetectionFunctions();
                    const result = detectCaptchaFromIframe(data.iframe as HTMLIFrameElement);
                    return result !== null;
                },
                { iframe: frameElementHandle, funcStr: getDetectionFunctions.toString() }
            );

            if (isCaptcha) {
                captchaEventEmitter.emit('captchaDetected', frame);
            }
        } catch (err) {
            console.error('Error processing new iframe:', err);
        }
    });
}
