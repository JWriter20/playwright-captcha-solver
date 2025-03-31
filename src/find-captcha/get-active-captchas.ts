import type { Locator, Page } from "patchright";

/**
 * The detection result interface.
 */
export interface CaptchaDetectionResult {
    frame: Locator;
    vendor: "recaptcha" | "hcaptcha" | "cloudflare";
    type: string;
}

/**
 * Detects and classifies a captcha based on the given iframe src URL.
 * @param src The src URL of the iframe.
 * @returns A CaptchaDetectionResult indicating if a captcha is present and its details.
 */
export function detectCaptchaFromSrc(src: string): { vendor: "recaptcha" | "hcaptcha" | "cloudflare"; type: string } | null {
    if (!src) return null;

    if (src.includes("/recaptcha/api2") || src.includes("/recaptcha/enterprise")) {
        if (src.includes("/bframe")) {
            return { vendor: "recaptcha", type: "image" };
        } else if (src.includes("/anchor")) {
            const recaptchaType = src.includes("size=invisible") ? "invisible" : "checkbox";
            return { vendor: "recaptcha", type: recaptchaType };
        }
    }

    if (src.includes("hcaptcha.com")) {
        return { vendor: "hcaptcha", type: "checkbox" };
    }

    if (src.includes("turnstile") || src.includes("challenges.cloudflare.com") || src.includes("cdn-cgi/challenge-platform")) {
        return { vendor: "cloudflare", type: "turnstile" };
    }

    return null;
}

/**
 * Races individual CAPTCHA iframe locators and returns results as soon as a Cloudflare one is found.
 * @param page The Playwright Page instance.
 * @returns Array of captcha detection results, prioritizing Cloudflare if found.
 */
export async function getCaptchaIframes(page: Page): Promise<CaptchaDetectionResult[]> {
    await page.waitForSelector("body");

    // Define individual locators for racing
    const locators = [
        { selector: 'iframe[src*="/recaptcha/"]', type: 'recaptcha' },
        { selector: 'iframe[src*="hcaptcha.com"]', type: 'hcaptcha' },
        { selector: 'iframe[src*="challenges.cloudflare.com"]', type: 'cloudflare' },
    ];

    // Function to evaluate a single locator
    const checkLocator = async (locator: { selector: string; type: string }): Promise<CaptchaDetectionResult[] | null> => {
        const iframeLocator = page.locator(locator.selector);
        const captchaResults: CaptchaDetectionResult[] = [];
        let index = 0;
        while (true) {
            try {
                const iframe = iframeLocator.nth(index);
                await iframe.waitFor({ timeout: 3000 });
                const isVisible = await iframe.isVisible();
                if (isVisible) {
                    const src = await iframe.getAttribute('src', { timeout: 5000 });
                    if (src) {
                        const detection = detectCaptchaFromSrc(src);
                        if (detection) {
                            captchaResults.push({ frame: iframe, vendor: detection.vendor, type: detection.type });
                        }
                    }
                }
                index++;
            } catch (error) {
                // console.log(`No more iframes found for ${locator.type}`);
                break;
            }
        }
        return captchaResults.length > 0 ? captchaResults : null;
    };

    // Race all locators concurrently
    const allPromises = await Promise.allSettled(locators.map(checkLocator));

    // Filter successful promises and non-null results, then flatten
    const results = allPromises
        .filter((result): result is PromiseFulfilledResult<CaptchaDetectionResult[] | null> =>
            result.status === 'fulfilled')
        .map(result => result.value)
        .filter((value): value is CaptchaDetectionResult[] => value !== null)
        .flat();

    // Log results for debugging
    console.log('Detected CAPTCHA iframes:', results);

    return results || []; // Ensure we always return an array
}

/**
 * Waits up to a specified time to detect captcha iframes, checking periodically for new iframes.
 * @param page - The Playwright Page instance to scan.
 * @param maxWait - Maximum time to wait in milliseconds (default: 3000ms).
 * @returns A Promise resolving to an array of CaptchaDetectionResult objects.
 */
export async function waitForCaptchaIframes(page: Page, maxWait: number = 3000): Promise<CaptchaDetectionResult[]> {
    const startTime = Date.now();

    while (true) {
        const results = await getCaptchaIframes(page);
        if (results.length > 0) return results;

        const elapsed = Date.now() - startTime;
        if (elapsed >= maxWait) return [];

        await new Promise((resolve) => setTimeout(resolve, 500));
    }
}

/**
 * Identifies new captcha frames that weren't present in a previous scan.
 * @param oldCaptchas - Array of previously detected captcha frames
 * @param newCaptchas - Array of currently detected captcha frames
 * @returns Array of captcha frames that appear in the new results but not in the old ones
 */
export async function getNewCaptchaFrames(
    oldCaptchas: CaptchaDetectionResult[],
    newCaptchas: CaptchaDetectionResult[]
): Promise<CaptchaDetectionResult[]> {
    if (oldCaptchas.length === 0) return newCaptchas;

    const newFrames: CaptchaDetectionResult[] = [];

    for (const newCaptcha of newCaptchas) {
        let isNew = true;
        const newSrc = await newCaptcha.frame.evaluate((iframe: HTMLIFrameElement) => iframe.src);

        for (const oldCaptcha of oldCaptchas) {
            const oldSrc = await oldCaptcha.frame.evaluate((iframe: HTMLIFrameElement) => iframe.src);
            if (newSrc === oldSrc && newCaptcha.vendor === oldCaptcha.vendor && newCaptcha.type === oldCaptcha.type) {
                isNew = false;
                break;
            }
        }

        if (isNew) newFrames.push(newCaptcha);
    }

    return newFrames;
}

/**
 * Captures a screenshot of a captcha iframe.
 * @param page The Playwright Page instance.
 * @param iframeLocator Locator for the iframe.
 * @returns Base64-encoded screenshot or empty string on failure.
 */
export const screenshotCaptcha = async (page: Page, iframeLocator: Locator): Promise<string> => {
    try {
        const bbox = await iframeLocator.boundingBox();
        if (!bbox) return "";

        const screenshot = await page.screenshot({
            clip: { x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height },
        });
        return screenshot.toString("base64");
    } catch (error) {
        console.error("Failed to take screenshot of captcha area:", error);
        return "";
    }
};

/**
 * Calculates absolute page coordinates from percentage coordinates within an iframe.
 * @param iframeBoundingBox Bounding box of the iframe.
 * @param xPercentage Horizontal percentage (0-100).
 * @param yPercentage Vertical percentage (0-100).
 * @returns Absolute page coordinates or null on failure.
 */
export async function getPageCoordinatesFromIframePercentage(
    iframeBoundingBox: { x: number; y: number; width: number; height: number },
    xPercentage: number,
    yPercentage: number
): Promise<{ x: number; y: number } | null> {
    try {
        if (!iframeBoundingBox) {
            console.error("Could not get bounding box of iframe");
            return null;
        }

        const xDecimal = xPercentage / 100;
        const yDecimal = yPercentage / 100;
        const pageX = iframeBoundingBox.x + iframeBoundingBox.width * xDecimal;
        const pageY = iframeBoundingBox.y + iframeBoundingBox.height * yDecimal;

        return { x: pageX, y: pageY };
    } catch (error) {
        console.error("Error calculating page coordinates from iframe percentage:", error);
        return null;
    }
}

/**
 * Checks if a locator is visible and has a minimum size of 5x5 pixels.
 * @param locator - The Playwright Locator to check
 * @param options - Optional configuration
 * @param options.timeout - Maximum time to wait in milliseconds (default: 5000)
 * @returns Promise<boolean> - True if visible and meets size requirements, false otherwise
 */
export async function isVisible(
    locator: Locator,
    options: { timeout?: number } = { timeout: 5000 }
): Promise<boolean> {
    try {
        // First check Playwright's built-in visibility
        const isPlaywrightVisible = await locator.isVisible({ timeout: options.timeout });
        if (!isPlaywrightVisible) {
            return false;
        }

        // Get the bounding box of the element
        const boundingBox = await locator.boundingBox({ timeout: options.timeout });

        // If no bounding box (e.g., element is detached), consider it not visible
        if (!boundingBox) {
            return false;
        }

        // Check if width or height is less than 5 pixels
        const { width, height } = boundingBox;
        if (width < 5 || height < 5) {
            return false;
        }

        return true;
    } catch (error) {
        console.warn(`Error checking visibility: ${error.message}`);
        return false;
    }
}