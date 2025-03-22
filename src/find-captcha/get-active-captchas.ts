import { BrowserState } from "../browser-adaptor/view.js";
import { DOMBaseNode, DOMElementNode } from "../dom/views.js";

/**
 * The detection result interface.
 */
export interface CaptchaDetectionResult {
    present: boolean;
    element?: DOMElementNode;
    vendor?: 'recaptcha' | 'hcaptcha' | 'cloudflare-turnstile';
    type?: string;
}

/**
 * Extracts all iframe element nodes from the BrowserState's element tree.
 * @param state The BrowserState instance containing the element tree.
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
 * This helper function examines a single DOMElementNode (which should be an iframe)
 * and checks its src attribute for known captcha vendors.
 */
function detectCaptchaFromIframe(node: DOMElementNode): CaptchaDetectionResult | null {
    if (node.tagName.toLowerCase() !== 'iframe') return null;

    // Check for visibility; adjust the property name if needed.
    const visible = (node as any).isVisible !== undefined ? (node as any).isVisible : true;
    if (!visible) return null;

    const src = node.attributes.src;
    if (!src) return null;

    // Check for reCAPTCHA iframes.
    if (src.includes('/recaptcha/api2/anchor') || src.includes('/recaptcha/enterprise/anchor')) {
        const recaptchaType = src.includes('size=invisible') ? 'invisible' : 'checkbox';
        return {
            present: true,
            element: node,
            vendor: 'recaptcha',
            type: recaptchaType,
        };
    }

    // Check for hCaptcha iframes.
    if (src.includes('hcaptcha.com')) {
        return {
            present: true,
            element: node,
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
            element: node,
            vendor: 'cloudflare-turnstile',
            type: 'turnstile',
        };
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

export function detectCaptchas(root: DOMElementNode): CaptchaDetectionResult {
    const iframes = getAllIframeNodes(root);
    return detectVisibleCaptcha(iframes);
}

export function detectCaptchaFromState(state: BrowserState): CaptchaDetectionResult {
    const iframes = getAllIframeNodes(state.elementTree);
    return detectVisibleCaptcha(iframes);
}
