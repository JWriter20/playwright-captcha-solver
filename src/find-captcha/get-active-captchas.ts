import type { Locator, Page } from "patchright"; // Assuming this is the correct import

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
        { selector: 'iframe[src*="cdn-cgi/challenge-platform"]', type: 'cdn-cgi' }
    ];

    // Function to evaluate a single locator
    const checkLocator = async (locator: { selector: string; type: string }): Promise<CaptchaDetectionResult | null> => {
        try {
            const iframe = page.locator(locator.selector).first();
            const src = await iframe.getAttribute('src', { timeout: 5000 });
            if (src) {
                const detection = detectCaptchaFromSrc(src);
                if (detection) {
                    return { frame: iframe, vendor: detection.vendor, type: detection.type };
                }
            }
            return null;
        } catch (error) {
            // console.warn(`No iframe found for ${locator.type}: ${error.message}`);
            return null;
        }
    };

    // Race all locators concurrently
    const results = await Promise.race([
        Promise.all(locators.map(checkLocator)).then(detections =>
            detections.filter((d): d is CaptchaDetectionResult => d !== null)
        ),
        // Early exit if Cloudflare is found
        new Promise<CaptchaDetectionResult[]>(resolve => {
            locators
                .filter(l => l.type === 'cloudflare' || l.type === 'cdn-cgi')
                .forEach(async locator => {
                    const result = await checkLocator(locator);
                    if (result && result.vendor === "cloudflare") {
                        resolve([result]); // Return immediately if Cloudflare is found
                    }
                });
        })
    ]);

    // Log results for debugging
    console.log('Detected CAPTCHA iframes:', results);

    return results;
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