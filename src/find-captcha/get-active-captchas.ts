import type { ElementHandle, Page } from "playwright-core";

/**
 * The detection result interface.
 */
export interface CaptchaDetectionResult {
    frame: ElementHandle<HTMLIFrameElement>;
    vendor: 'recaptcha' | 'hcaptcha' | 'cloudflare';
    type: string;
}

/**
 * Detects and classifies a captcha based on the given iframe src URL.
 * @param src The src URL of the iframe.
 * @returns A CaptchaDetectionResult indicating if a captcha is present and its details.
 */
export function detectCaptchaFromSrc(src: string): { vendor: 'recaptcha' | 'hcaptcha' | 'cloudflare', type: string } | null {
    if (!src) return null;

    // Check for reCAPTCHA iframes.
    if (src.includes('/recaptcha/api2') || src.includes('/recaptcha/enterprise')) {
        if (src.includes("/bframe")) {
            return {
                vendor: 'recaptcha',
                type: 'image',
            };
        } else if (src.includes("/anchor")) {
            const recaptchaType = src.includes('size=invisible') ? 'invisible' : 'checkbox';
            return {
                vendor: 'recaptcha',
                type: recaptchaType,
            };
        }
    }

    // Check for hCaptcha iframes.
    if (src.includes('hcaptcha.com')) {
        return {
            vendor: 'hcaptcha',
            type: 'checkbox',
        };
    }

    // Check for Cloudflare Turnstile iframes.
    if (
        src.includes('turnstile') ||
        src.includes('challenges.cloudflare.com') ||
        src.includes('cdn-cgi/challenge-platform')
    ) {
        return {
            vendor: 'cloudflare',
            type: 'turnstile',
        };
    }

    return null;
}

export async function getCaptchaIframes(page: Page): Promise<CaptchaDetectionResult[]> {
    await page.waitForSelector('body');
    // @ts-ignore
    const isExposed = await page.evaluate(() => typeof window.detectCaptchaFromSrc === 'function');
    if (!isExposed) {
        await page.exposeFunction('detectCaptchaFromSrc', detectCaptchaFromSrc);
    }

    // Evaluate a recursive function to collect all iframes in the DOM (including shadow roots and same-origin iframe docs).
    const iframeHandlesHandle = await page.evaluateHandle(() => {
        const iframes: HTMLElement[] = [];
        function traverse(node: Node | Document | ShadowRoot) {
            if (node.nodeType === Node.ELEMENT_NODE) {
                const element = node as HTMLElement;
                if (element.tagName.toLowerCase() === 'iframe') {
                    iframes.push(element);
                    // If the iframe’s content is accessible, traverse it as well.
                    const iframe = element as HTMLIFrameElement;
                    if (iframe.contentDocument) {
                        traverse(iframe.contentDocument);
                    }
                }
            }
            // If node has a shadow root, traverse it.
            if ('shadowRoot' in node && node.shadowRoot) {
                traverse(node.shadowRoot as ShadowRoot);
            }
            // Traverse child nodes.
            if ('childNodes' in node) {
                node.childNodes.forEach(child => traverse(child));
            }
        }

        traverse(document);
        return iframes;
    });

    // Get the array of ElementHandles from the JSHandle.
    const properties = await iframeHandlesHandle.getProperties();
    const iframeHandles: ElementHandle<HTMLIFrameElement>[] = [];
    for (const property of properties.values()) {
        const elementHandle = property.asElement();
        if (elementHandle) {
            iframeHandles.push(elementHandle);
        }
    }
    await iframeHandlesHandle.dispose();

    const results: CaptchaDetectionResult[] = [];
    for (const iframeHandle of iframeHandles) {
        // Get the iframe's src attribute.
        const src = await iframeHandle.evaluate(iframe => (iframe as HTMLIFrameElement).src);
        if (!src) continue;
        console.log('Detected iframe src:', src);

        const detection = detectCaptchaFromSrc(src);

        if (detection) {
            // Check the iframe's bounding box and viewport visibility
            const rect = await iframeHandle.boundingBox();
            if (rect && rect.width > 5 && rect.height > 5) {
                // Check if the iframe is in the viewport
                const isVisible = await iframeHandle.evaluate((iframe) => {
                    const rect = iframe.getBoundingClientRect();
                    const windowHeight = window.innerHeight || document.documentElement.clientHeight;
                    const windowWidth = window.innerWidth || document.documentElement.clientWidth;

                    // Check if any part of the iframe is visible in the viewport
                    return (
                        rect.top < windowHeight &&
                        rect.bottom > 0 &&
                        rect.left < windowWidth &&
                        rect.right > 0
                    );
                });

                if (isVisible) {
                    results.push({
                        type: detection.type,
                        vendor: detection.vendor,
                        frame: iframeHandle,
                    });
                }
            }
        }
    }

    return results;
}

/**
 * Waits up to a specified time to detect captcha iframes, checking periodically for new iframes.
 * @param page - The Puppeteer Page instance to scan.
 * @param maxWait - Maximum time to wait in milliseconds (default: 3000ms).
 * @returns A Promise resolving to an array of CaptchaDetectionResult objects.
 */
export async function waitForCaptchaIframes(page: Page, maxWait: number = 3000): Promise<CaptchaDetectionResult[]> {
    const startTime = Date.now();

    while (true) {
        // Call the existing function to get current captcha iframes
        const results = await getCaptchaIframes(page);

        // If captchas are found, return them immediately
        if (results.length > 0) {
            return results;
        }

        // Calculate elapsed time
        const elapsed = Date.now() - startTime;

        // If the maximum wait time is exceeded, return an empty array
        if (elapsed >= maxWait) {
            return [];
        }

        // Wait 500ms before the next check to allow for dynamic DOM updates
        await new Promise(resolve => setTimeout(resolve, 500));
    }
}

// Alternative function to capture area with potential overlays (unchanged)
export const screenshotCaptcha = async (page: Page, iframe: ElementHandle<HTMLIFrameElement>): Promise<string> => {
    try {
        // Get iframe position and dimensions
        const bbox = await iframe.boundingBox();
        if (!bbox) return '';

        // Take screenshot of that region of the page (including any overlays)
        const screenshot = await page.screenshot({
            clip: {
                x: bbox.x,
                y: bbox.y,
                width: bbox.width,
                height: bbox.height
            }
        });
        return screenshot.toString('base64');
    } catch (error) {
        console.error('Failed to take screenshot of captcha area:', error);
        return '';
    }
};
/**
 * Calculates absolute page coordinates from percentage coordinates within an iframe.
 * 
 * @param iframe - The Playwright ElementHandle for the iframe
 * @param xPercentage - The horizontal percentage position within the iframe (0-100)
 * @param yPercentage - The vertical percentage position within the iframe (0-100)
 * @returns The absolute {x, y} coordinates on the page, or null if the calculation fails
 */
export async function getPageCoordinatesFromIframePercentage(
    iframeBoundingBox: { x: number, y: number, width: number, height: number },
    xPercentage: number,
    yPercentage: number
): Promise<{ x: number, y: number } | null> {
    try {
        if (!iframeBoundingBox) {
            console.error('Could not get bounding box of iframe');
            return null;
        }

        // Convert percentages to decimals (0-1)
        const xDecimal = xPercentage / 100;
        const yDecimal = yPercentage / 100;

        // Calculate the absolute coordinates on the page
        const pageX = iframeBoundingBox.x + (iframeBoundingBox.width * xDecimal);
        const pageY = iframeBoundingBox.y + (iframeBoundingBox.height * yDecimal);

        return {
            x: pageX,
            y: pageY
        };
    } catch (error) {
        console.error('Error calculating page coordinates from iframe percentage:', error);
        return null;
    }
}

