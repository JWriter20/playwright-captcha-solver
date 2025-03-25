import { BrowserState } from "../browser-adaptor/view.js";
import { DOMBaseNode, DOMElementNode } from "../dom/views.js";
import type { ElementHandle, Page } from "playwright-core";

/**
 * The detection result interface.
 */
export interface CaptchaDetectionResult {
    present: boolean;
    element?: DOMElementNode;
    vendor?: 'recaptcha' | 'hcaptcha' | 'cloudflare';
    type?: string;
}

/**
 * Detects and classifies a captcha based on the given iframe src URL.
 * @param src The src URL of the iframe.
 * @returns A CaptchaDetectionResult indicating if a captcha is present and its details.
 */
export function detectCaptchaFromSrc(src: string): CaptchaDetectionResult {
    if (!src) return { present: false };

    // Check for reCAPTCHA iframes.https://www.google.com/recaptcha/api2/bframe?hl=en&v=bUO1BXI8H9PgjAPSW9hwuSeI&k=6LfD3PIbAAAAAJs_eEHvoOl75_83eXSqpPSRFJ_u
    if (src.includes('/recaptcha/api2') || src.includes('/recaptcha/enterprise')) {
        if (src.includes("/bframe")) {
            return {
                present: true,
                vendor: 'recaptcha',
                type: 'image',
            };
        } else if (src.includes("/anchor")) {
            const recaptchaType = src.includes('size=invisible') ? 'invisible' : 'checkbox';
            return {
                present: true,
                vendor: 'recaptcha',
                type: recaptchaType,
            };
        }
    }

    // Check for hCaptcha iframes.
    if (src.includes('hcaptcha.com')) {
        return {
            present: true,
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
            present: true,
            vendor: 'cloudflare',
            type: 'turnstile',
        };
    }

    return { present: false };
}

/**
 * Extracts all iframe element nodes from the BrowserState's element tree.
 * @param rootNode The root DOMElementNode of the element tree.
 * @returns An array of DOMElementNode objects representing iframe elements.
 */
export function getAllIframeNodes(rootNode: DOMElementNode): DOMElementNode[] {
    const iframes: DOMElementNode[] = [];

    /**
     * Recursively traverse the DOM tree.
     * @param node A DOMBaseNode (or DOMElementNode) to process.
     */
    function traverse(node: DOMBaseNode): void {
        if (node instanceof DOMElementNode) {
            if (node.tagName.toLowerCase() === "iframe") {
                iframes.push(node);
            }
            node.children.forEach(child => traverse(child));
        }
    }

    traverse(rootNode);

    return iframes;
}

/**
 * Examines a single DOMElementNode (which should be an iframe) and uses detectCaptchaFromSrc
 * to check its src attribute for known captcha vendors.
 */
function detectCaptchaFromIframe(node: DOMElementNode): CaptchaDetectionResult | null {
    if (node.tagName.toLowerCase() !== 'iframe') return null;

    // Check for visibility; adjust the property name if needed.
    const visible = (node as any).isVisible !== undefined ? (node as any).isVisible : true;
    if (!visible) return null;

    const src = node.attributes.src;
    if (!src) return null;

    // Use the new helper function to classify the captcha based on src.
    const result = detectCaptchaFromSrc(src);
    if (result.present) {
        result.element = node; // Attach the DOMElementNode that triggered detection.
        return result;
    }
    return null;
}

/**
 * Recursively searches the given array of DOMElementNode objects for a visible captcha iframe.
 * Returns the first detected captcha result including the associated node.
 */
export function detectVisibleCaptcha(nodes: DOMElementNode[]): CaptchaDetectionResult {
    for (const node of nodes) {
        if (node.tagName.toLowerCase() === 'iframe') {
            const result = detectCaptchaFromIframe(node);
            if (result) return result;
        }
        if (node.children && node.children.length > 0) {
            const childNodes = node.children as DOMElementNode[];
            const childResult = detectVisibleCaptcha(childNodes);
            if (childResult.present) return childResult;
        }
    }
    return { present: false };
}

/**
 * Detects captcha by extracting all iframe nodes from the given DOM tree and then searching for a visible captcha.
 */
export function detectCaptchas(root: DOMElementNode): CaptchaDetectionResult {
    const iframes = getAllIframeNodes(root);
    return detectVisibleCaptcha(iframes);
}

/**
 * Detects captcha from a given BrowserState by traversing its element tree.
 */
export function detectCaptchaFromState(state: BrowserState): CaptchaDetectionResult {
    const iframes = getAllIframeNodes(state.elementTree);
    return detectVisibleCaptcha(iframes);
}

export async function getCaptchaElmentHandle(page: Page) {
    try {
        // Get all iframes on the page
        const iframes = await page.$$('iframe');

        // Check each iframe
        for (const iframe of iframes) {
            // Check if the iframe is visible
            const isVisible = await iframe.isVisible();
            if (!isVisible) continue;

            // Get the src attribute
            const src = await iframe.getAttribute('src');
            if (!src) continue;

            // Use the existing detectCaptchaFromSrc function to check if this iframe contains a captcha
            const result = detectCaptchaFromSrc(src);

            const iFrameDimensions = await iframe.boundingBox();
            const isNotHidden = iFrameDimensions.width > 5 && iFrameDimensions.height > 5;

            // If a captcha is detected, return this iframe element handle
            if (result.present && isNotHidden) {
                return iframe;
            }
        }

        // If no captcha is found, return null
        return null;
    } catch (error) {
        console.error('Error detecting captcha element:', error);
        return null;
    }
}
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

