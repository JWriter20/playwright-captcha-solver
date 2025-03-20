export type CaptchaDetectionResult = {
    present: boolean;
    vendor?: 'recaptcha' | 'hcaptcha';
    // For reCAPTCHA we further classify as either a checkbox, invisible, or score-based challenge.
    type?: 'checkbox' | 'invisible' | 'score';
    details?: any;
};

/**
 * Checks if any visible captcha challenge is present in the page and classifies its type.
 * Looks for reCAPTCHA and hCaptcha.
 */
export async function detectVisibleCaptcha(): Promise<CaptchaDetectionResult> {
    await waitUntilDocumentReady();

    // Look for visible reCAPTCHA anchor iframes.
    const recaptchaIframes = Array.from(
        document.querySelectorAll<HTMLIFrameElement>(
            'iframe[src*="/recaptcha/api2/anchor"], iframe[src*="/recaptcha/enterprise/anchor"]'
        )
    ).filter(isVisible);

    if (recaptchaIframes.length > 0) {
        // For classification, pick the first detected recaptcha iframe.
        const recaptchaIframe = recaptchaIframes[0];
        const captchaType = getRecaptchaType(recaptchaIframe);
        return {
            present: true,
            vendor: 'recaptcha',
            type: captchaType,
            details: {
                iframe: recaptchaIframe.outerHTML
            }
        };
    }

    // Look for visible hCaptcha iframes.
    const hcaptchaIframes = Array.from(
        document.querySelectorAll<HTMLIFrameElement>(
            'iframe[src*="hcaptcha.com"]'
        )
    ).filter(isVisible);

    if (hcaptchaIframes.length > 0) {
        return {
            present: true,
            vendor: 'hcaptcha',
            // For hCaptcha, further type classification could be added if needed.
            type: 'checkbox',
            details: {
                iframe: hcaptchaIframes[0].outerHTML
            }
        };
    }

    return { present: false };
}

/**
 * Checks if the given element is visible.
 * (Element must have dimensions and not be hidden via CSS.)
 */
function isVisible(elem: HTMLElement): boolean {
    const style = window.getComputedStyle(elem);
    return (
        (elem.offsetWidth > 0 || elem.offsetHeight > 0 || elem.getClientRects().length > 0) &&
        style.visibility !== 'hidden' &&
        style.display !== 'none'
    );
}

/**
 * Returns a promise that resolves when the document is ready.
 */
function waitUntilDocumentReady(): Promise<void> {
    return new Promise((resolve) => {
        if (document.readyState === 'complete' || document.readyState === 'interactive') {
            resolve();
        } else {
            document.addEventListener('DOMContentLoaded', () => resolve());
        }
    });
}

/**
 * Determines the type of a reCAPTCHA challenge based on its iframe.
 *
 * For reCAPTCHA:
 * - If the iframe's URL contains "size=invisible", then the captcha may be invisible.
 *   We extract its id from the iframe's name (e.g. "a-841543e13666") and check if
 *   a corresponding challenge frame (bframe) exists and is visible.
 *   If a bframe is visible, we classify it as "invisible"; otherwise, we assume it's "score"-based.
 * - Otherwise, we classify it as a "checkbox" captcha.
 */
function getRecaptchaType(iframe: HTMLIFrameElement): 'checkbox' | 'invisible' | 'score' {
    if (iframe.src.includes('size=invisible')) {
        const name = iframe.getAttribute('name'); // e.g. "a-841543e13666"
        let id = '';
        if (name) {
            const parts = name.split('-');
            if (parts.length > 1) {
                id = parts[1];
            }
        }
        if (id) {
            // Look for the associated challenge frame (bframe) which uses the naming pattern "c-{id}"
            const challengeFrame = document.querySelector(
                `iframe[src*="/recaptcha/"][src*="/bframe"][name="c-${id}"]`
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
