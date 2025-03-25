import type { Page } from "playwright";
import type { CaptchaAction } from "../llm-connectors/llm-connector.js";
import { detectCaptchaFromSrc, getPageCoordinatesFromIframePercentage } from "../find-captcha/get-active-captchas.js";
import type { CoordinateSet } from "./history-tree-processor/view.js";

export type Args = {
    doHighlightElements: boolean;
    focusHighlightIndex: number;
    viewportExpansion: number;
    debugMode: boolean;
    pendingActions: CaptchaAction[];
    pastActions: CaptchaAction[];
};

interface TimingStack {
    nodeProcessing: number[];
    treeTraversal: number[];
    highlighting: number[];
    current: number | null;
}

interface PerfMetrics {
    buildDomTreeCalls: number;
    timings: {
        buildDomTree: number;
        highlightElement: number;
        isInteractiveElement: number;
        isElementVisible: number;
        isTopElement: number;
        isInExpandedViewport: number;
        isTextNodeVisible: number;
        getEffectiveScroll: number;
    };
    cacheMetrics: {
        boundingRectCacheHits: number;
        boundingRectCacheMisses: number;
        computedStyleCacheHits: number;
        computedStyleCacheMisses: number;
        getBoundingClientRectTime: number;
        getComputedStyleTime: number;
        boundingRectHitRate: number;
        computedStyleHitRate: number;
        overallHitRate: number;
    };
    nodeMetrics: {
        totalNodes: number;
        processedNodes: number;
        skippedNodes: number;
    };
    buildDomTreeBreakdown: {
        totalTime: number;
        totalSelfTime: number;
        buildDomTreeCalls: number;
        domOperations: {
            [key: string]: number;
            getBoundingClientRect: number;
            getComputedStyle: number;
        };
        domOperationCounts: {
            [key: string]: number;
            getBoundingClientRect: number;
            getComputedStyle: number;
        };
        averageTimePerNode?: number;
        timeInChildCalls?: number;
    };
}

export interface DOMNodeData {
    tagName?: string;
    attributes?: Record<string, string | null>;
    xpath?: string;
    children?: string[];
    isVisible?: boolean;
    isTopElement?: boolean;
    isInteractive?: boolean;
    isInViewport?: boolean;
    pageCoordinates?: CoordinateSet;
    highlightIndex?: number;
    shadowRoot?: boolean;
    type?: "TEXT_NODE";
    text?: string;
}

type DomHashMap = Record<string, DOMNodeData | any>;

export interface DOMTreeMap {
    rootId: string | null;
    map: DomHashMap;
    perfMetrics?: PerfMetrics;
}

interface ScrollOffset {
    scrollX: number;
    scrollY: number;
}

async function buildDomTree(
    page: Page,
    args: Args = {
        doHighlightElements: true,
        focusHighlightIndex: -1,
        viewportExpansion: 0,
        debugMode: false,
        pendingActions: [],
        pastActions: [],
    }
): Promise<DOMTreeMap> {
    // @ts-ignore - This function will be exposed by the page.evaluate
    const isExposed = await page.evaluate(() => typeof window.detectCaptchaFromSrc === 'function');
    if (!isExposed) await page.exposeFunction('detectCaptchaFromSrc', detectCaptchaFromSrc);

    // @ts-ignore - This function will be exposed by the page.evaluate
    const coordinateTranslationExposed = await page.evaluate(() => typeof window.getPageCoordinatesFromIframePercentage === 'function');
    if (!coordinateTranslationExposed) await page.exposeFunction('getPageCoordinatesFromIframePercentage', getPageCoordinatesFromIframePercentage);

    return await page.evaluate((args: Args) => {

        const { doHighlightElements, focusHighlightIndex, viewportExpansion, debugMode } = args;
        let highlightIndex: number = 0; // Reset highlight index

        const TIMING_STACK: TimingStack = {
            nodeProcessing: [],
            treeTraversal: [],
            highlighting: [],
            current: null,
        };

        function pushTiming(type: keyof Omit<TimingStack, "current">): void {
            TIMING_STACK[type] = TIMING_STACK[type] || [];
            TIMING_STACK[type].push(performance.now());
        }

        function popTiming(type: keyof Omit<TimingStack, "current">): number {
            const start = TIMING_STACK[type].pop();
            if (start === undefined) return 0;
            const duration = performance.now() - start;
            return duration;
        }

        const PERF_METRICS: PerfMetrics | null = debugMode
            ? {
                buildDomTreeCalls: 0,
                timings: {
                    buildDomTree: 0,
                    highlightElement: 0,
                    isInteractiveElement: 0,
                    isElementVisible: 0,
                    isTopElement: 0,
                    isInExpandedViewport: 0,
                    isTextNodeVisible: 0,
                    getEffectiveScroll: 0,
                },
                cacheMetrics: {
                    boundingRectCacheHits: 0,
                    boundingRectCacheMisses: 0,
                    computedStyleCacheHits: 0,
                    computedStyleCacheMisses: 0,
                    getBoundingClientRectTime: 0,
                    getComputedStyleTime: 0,
                    boundingRectHitRate: 0,
                    computedStyleHitRate: 0,
                    overallHitRate: 0,
                },
                nodeMetrics: {
                    totalNodes: 0,
                    processedNodes: 0,
                    skippedNodes: 0,
                },
                buildDomTreeBreakdown: {
                    totalTime: 0,
                    totalSelfTime: 0,
                    buildDomTreeCalls: 0,
                    domOperations: {
                        getBoundingClientRect: 0,
                        getComputedStyle: 0,
                    },
                    domOperationCounts: {
                        getBoundingClientRect: 0,
                        getComputedStyle: 0,
                    },
                },
            }
            : null;

        function measureTime<T extends (...args: any[]) => any>(fn: T): T {
            if (!debugMode) return fn;
            return (function (this: any, ...args: Parameters<T>): ReturnType<T> {
                const start = performance.now();
                const result = fn.apply(this, args);
                const duration = performance.now() - start;
                return result;
            } as T);
        }

        function measureDomOperation<T>(operation: () => T, name: string): T {
            if (!debugMode) return operation();
            const start = performance.now();
            const result = operation();
            const duration = performance.now() - start;
            if (
                PERF_METRICS &&
                Object.prototype.hasOwnProperty.call(PERF_METRICS.buildDomTreeBreakdown.domOperations, name)
            ) {
                PERF_METRICS.buildDomTreeBreakdown.domOperations[name] += duration;
                PERF_METRICS.buildDomTreeBreakdown.domOperationCounts[name]++;
            }
            return result;
        }

        const DOM_CACHE = {
            boundingRects: new WeakMap<Element, DOMRect>(),
            computedStyles: new WeakMap<Element, CSSStyleDeclaration>(),
            clearCache: (): void => {
                DOM_CACHE.boundingRects = new WeakMap();
                DOM_CACHE.computedStyles = new WeakMap();
            },
        };

        function getCachedBoundingRect(element: Element | null): DOMRect | null {
            if (!element) return null;
            if (DOM_CACHE.boundingRects.has(element)) {
                if (debugMode && PERF_METRICS) {
                    PERF_METRICS.cacheMetrics.boundingRectCacheHits++;
                }
                return DOM_CACHE.boundingRects.get(element) || null;
            }
            if (debugMode && PERF_METRICS) {
                PERF_METRICS.cacheMetrics.boundingRectCacheMisses++;
            }
            let rect: DOMRect;
            if (debugMode) {
                const start = performance.now();
                rect = element.getBoundingClientRect();
                const duration = performance.now() - start;
                if (PERF_METRICS) {
                    PERF_METRICS.buildDomTreeBreakdown.domOperations.getBoundingClientRect += duration;
                    PERF_METRICS.buildDomTreeBreakdown.domOperationCounts.getBoundingClientRect++;
                }
            } else {
                rect = element.getBoundingClientRect();
            }
            if (rect) {
                DOM_CACHE.boundingRects.set(element, rect);
            }
            return rect;
        }

        function getCachedComputedStyle(element: Element | null): CSSStyleDeclaration | null {
            if (!element) return null;
            if (DOM_CACHE.computedStyles.has(element)) {
                if (debugMode && PERF_METRICS) {
                    PERF_METRICS.cacheMetrics.computedStyleCacheHits++;
                }
                return DOM_CACHE.computedStyles.get(element) || null;
            }
            if (debugMode && PERF_METRICS) {
                PERF_METRICS.cacheMetrics.computedStyleCacheMisses++;
            }
            let style: CSSStyleDeclaration;
            if (debugMode) {
                const start = performance.now();
                style = window.getComputedStyle(element);
                const duration = performance.now() - start;
                if (PERF_METRICS) {
                    PERF_METRICS.buildDomTreeBreakdown.domOperations.getComputedStyle += duration;
                    PERF_METRICS.buildDomTreeBreakdown.domOperationCounts.getComputedStyle++;
                }
            } else {
                style = window.getComputedStyle(element);
            }
            if (style) {
                DOM_CACHE.computedStyles.set(element, style);
            }
            return style;
        }

        const DOM_HASH_MAP: DomHashMap = {};
        const ID = { current: 0 };
        const HIGHLIGHT_CONTAINER_ID = "playwright-highlight-container";

        /**
         * Highlights a captcha action on the page.
         * 
         * @param action - The CaptchaAction (click or drag)
         * @param index - A unique index for coloring and labeling
         * @param parentIframe - (Optional) The iframe element containing the action
         * @returns The updated index (index+1)
         */
        async function highlightActionOverlay(
            action: CaptchaAction,
            index: number,
            parentIframe: HTMLIFrameElement | null = null
        ): Promise<number> {
            // Create or retrieve the overlay container in the top document.
            const container = document.getElementById(HIGHLIGHT_CONTAINER_ID) || (() => {
                const el = document.createElement("div");
                el.id = HIGHLIGHT_CONTAINER_ID;
                el.style.position = "fixed";
                el.style.pointerEvents = "none";
                el.style.top = "0";
                el.style.left = "0";
                el.style.width = "100%";
                el.style.height = "100%";
                el.style.zIndex = "2147483647";
                document.body.appendChild(el);
                return el;
            })();

            // Determine the bounding box: either the iframe's or the full window.
            const boundingBox = parentIframe
                ? parentIframe.getBoundingClientRect()
                : { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };

            // For highlighting, we use these fixed colors.
            const colors = ["#FF0000", "#0000FF", "#FFA500", "#800080"];
            const baseColor = colors[index % colors.length];
            const backgroundColor = baseColor + "1A"; // 10% opacity

            if (action.action === "click") {
                const location = action.location;
                // Use the helper to compute page coordinates from the percentage values.
                const coords = await getPageCoordinatesFromIframePercentage(
                    boundingBox,
                    parseFloat(location.x),
                    parseFloat(location.y)
                );
                if (!coords) return index;
                const { x: finalX, y: finalY } = coords;

                console.log("Highlighting click action at", finalX, finalY);

                // Create the circle overlay.
                const circle = document.createElement("div");
                circle.style.position = "fixed";
                circle.style.width = "20px";
                circle.style.height = "20px";
                circle.style.borderRadius = "50%";
                circle.style.border = `2px solid ${baseColor}`;
                circle.style.backgroundColor = backgroundColor;
                circle.style.left = `${finalX - 10}px`;
                circle.style.top = `${finalY - 10}px`;
                container.appendChild(circle);

                // Create the label.
                const label = document.createElement("div");
                label.textContent = index.toString();
                label.style.position = "fixed";
                label.style.background = baseColor;
                label.style.color = "white";
                label.style.padding = "1px 4px";
                label.style.borderRadius = "4px";
                label.style.fontSize = "12px";
                label.style.left = `${finalX + 12}px`;
                label.style.top = `${finalY - 10}px`;
                container.appendChild(label);

                // Update positions on window resize.
                const updateClickPosition = async () => {
                    const newBoundingBox = parentIframe
                        ? parentIframe.getBoundingClientRect()
                        : { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
                    const newCoords = await getPageCoordinatesFromIframePercentage(
                        newBoundingBox,
                        parseFloat(location.x),
                        parseFloat(location.y)
                    );
                    if (!newCoords) return;
                    circle.style.left = `${newCoords.x - 10}px`;
                    circle.style.top = `${newCoords.y - 10}px`;
                    label.style.left = `${newCoords.x + 12}px`;
                    label.style.top = `${newCoords.y - 10}px`;
                };
                window.addEventListener("resize", updateClickPosition);

            } else if (action.action === "drag") {
                const start = action.startLocation;
                const end = action.endLocation;
                const startCoords = await getPageCoordinatesFromIframePercentage(
                    boundingBox,
                    parseFloat(start.x),
                    parseFloat(start.y)
                );
                const endCoords = await getPageCoordinatesFromIframePercentage(
                    boundingBox,
                    parseFloat(end.x),
                    parseFloat(end.y)
                );
                if (!startCoords || !endCoords) return index;

                const { x: startFinalX, y: startFinalY } = startCoords;
                const { x: endFinalX, y: endFinalY } = endCoords;

                // Create start circle.
                const startCircle = document.createElement("div");
                startCircle.style.position = "fixed";
                startCircle.style.width = "20px";
                startCircle.style.height = "20px";
                startCircle.style.borderRadius = "50%";
                startCircle.style.border = `2px solid ${baseColor}`;
                startCircle.style.backgroundColor = backgroundColor;
                startCircle.style.left = `${startFinalX - 10}px`;
                startCircle.style.top = `${startFinalY - 10}px`;
                container.appendChild(startCircle);

                // Create end circle.
                const endCircle = document.createElement("div");
                endCircle.style.position = "fixed";
                endCircle.style.width = "20px";
                endCircle.style.height = "20px";
                endCircle.style.borderRadius = "50%";
                endCircle.style.border = `2px solid ${baseColor}`;
                endCircle.style.backgroundColor = backgroundColor;
                endCircle.style.left = `${endFinalX - 10}px`;
                endCircle.style.top = `${endFinalY - 10}px`;
                container.appendChild(endCircle);

                // Draw an arrow connecting start and end.
                const dx = endFinalX - startFinalX;
                const dy = endFinalY - startFinalY;
                const distance = Math.sqrt(dx * dx + dy * dy);
                const arrow = document.createElement("div");
                arrow.style.position = "fixed";
                arrow.style.height = "2px";
                arrow.style.backgroundColor = baseColor;
                arrow.style.width = `${distance}px`;
                arrow.style.left = `${startFinalX}px`;
                arrow.style.top = `${startFinalY}px`;
                const angle = Math.atan2(dy, dx) * (180 / Math.PI);
                arrow.style.transform = `rotate(${angle}deg)`;
                arrow.style.transformOrigin = "0 50%";
                container.appendChild(arrow);

                // Create an arrow head.
                const arrowHead = document.createElement("div");
                arrowHead.style.position = "fixed";
                arrowHead.style.width = "0";
                arrowHead.style.height = "0";
                arrowHead.style.borderLeft = "5px solid transparent";
                arrowHead.style.borderRight = "5px solid transparent";
                arrowHead.style.borderTop = `10px solid ${baseColor}`;
                arrowHead.style.left = `${endFinalX - 5}px`;
                arrowHead.style.top = `${endFinalY - 10}px`;
                container.appendChild(arrowHead);

                // Add a label at the midpoint.
                const midX = startFinalX + dx / 2;
                const midY = startFinalY + dy / 2;
                const label = document.createElement("div");
                label.textContent = index.toString();
                label.style.position = "fixed";
                label.style.background = baseColor;
                label.style.color = "white";
                label.style.padding = "1px 4px";
                label.style.borderRadius = "4px";
                label.style.fontSize = "12px";
                label.style.left = `${midX}px`;
                label.style.top = `${midY}px`;
                container.appendChild(label);

                // Update drag positions on window resize.
                const updateDragPosition = async () => {
                    const newBoundingBox = parentIframe
                        ? parentIframe.getBoundingClientRect()
                        : { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
                    const newStartCoords = await getPageCoordinatesFromIframePercentage(
                        newBoundingBox,
                        parseFloat(start.x),
                        parseFloat(start.y)
                    );
                    const newEndCoords = await getPageCoordinatesFromIframePercentage(
                        newBoundingBox,
                        parseFloat(end.x),
                        parseFloat(end.y)
                    );
                    if (!newStartCoords || !newEndCoords) return;

                    startCircle.style.left = `${newStartCoords.x - 10}px`;
                    startCircle.style.top = `${newStartCoords.y - 10}px`;
                    endCircle.style.left = `${newEndCoords.x - 10}px`;
                    endCircle.style.top = `${newEndCoords.y - 10}px`;

                    const newDx = newEndCoords.x - newStartCoords.x;
                    const newDy = newEndCoords.y - newStartCoords.y;
                    const newDistance = Math.sqrt(newDx * newDx + newDy * newDy);
                    arrow.style.width = `${newDistance}px`;
                    arrow.style.left = `${newStartCoords.x}px`;
                    arrow.style.top = `${newStartCoords.y}px`;
                    const newAngle = Math.atan2(newDy, newDx) * (180 / Math.PI);
                    arrow.style.transform = `rotate(${newAngle}deg)`;
                    arrowHead.style.left = `${newEndCoords.x - 5}px`;
                    arrowHead.style.top = `${newEndCoords.y - 10}px`;
                    const newMidX = newStartCoords.x + newDx / 2;
                    const newMidY = newStartCoords.y + newDy / 2;
                    label.style.left = `${newMidX}px`;
                    label.style.top = `${newMidY}px`;
                };
                window.addEventListener("resize", updateDragPosition);
            }

            return index + 1;
        }


        let highlightElement = (
            element: Element | null,
            index: number,
            parentIframe: Element | null = null
        ): number => {
            if (!element) return index;
            try {
                let container = document.getElementById(HIGHLIGHT_CONTAINER_ID);
                if (!container) {
                    container = document.createElement("div");
                    container.id = HIGHLIGHT_CONTAINER_ID;
                    container.style.position = "fixed";
                    container.style.pointerEvents = "none";
                    container.style.top = "0";
                    container.style.left = "0";
                    container.style.width = "100%";
                    container.style.height = "100%";
                    container.style.zIndex = "2147483647";
                    document.body.appendChild(container);
                }
                const rect = measureDomOperation(() => element.getBoundingClientRect(), "getBoundingClientRect");
                if (!rect) return index;
                const colors = [
                    "#FF0000",
                    "#00FF00",
                    "#0000FF",
                    "#FFA500",
                    "#800080",
                    "#008080",
                    "#FF69B4",
                    "#4B0082",
                    "#FF4500",
                    "#2E8B57",
                    "#DC143C",
                    "#4682B4",
                ];
                const colorIndex = index % colors.length;
                const baseColor = colors[colorIndex];
                const backgroundColor = baseColor + "1A"; // 10% opacity
                const overlay = document.createElement("div");
                overlay.style.position = "fixed";
                overlay.style.border = `2px solid ${baseColor}`;
                overlay.style.backgroundColor = backgroundColor;
                overlay.style.pointerEvents = "none";
                overlay.style.boxSizing = "border-box";

                let iframeOffset = { x: 0, y: 0 };
                if (parentIframe) {
                    const iframeRect = parentIframe.getBoundingClientRect();
                    iframeOffset.x = iframeRect.left;
                    iframeOffset.y = iframeRect.top;
                }
                const top = rect.top + iframeOffset.y;
                const left = rect.left + iframeOffset.x;
                overlay.style.top = `${top}px`;
                overlay.style.left = `${left}px`;
                overlay.style.width = `${rect.width}px`;
                overlay.style.height = `${rect.height}px`;

                const label = document.createElement("div");
                label.className = "playwright-highlight-label";
                label.style.position = "fixed";
                label.style.background = baseColor;
                label.style.color = "white";
                label.style.padding = "1px 4px";
                label.style.borderRadius = "4px";
                label.style.fontSize = `${Math.min(12, Math.max(8, rect.height / 2))}px`;
                label.textContent = index.toString();

                const labelWidth = 20;
                const labelHeight = 16;
                let labelTop = top + 2;
                let labelLeft = left + rect.width - labelWidth - 2;

                if (rect.width < labelWidth + 4 || rect.height < labelHeight + 4) {
                    labelTop = top - labelHeight - 2;
                    labelLeft = left + rect.width - labelWidth;
                }

                label.style.top = `${labelTop}px`;
                label.style.left = `${labelLeft}px`;

                container.appendChild(overlay);
                container.appendChild(label);

                const updatePositions = () => {
                    const newRect = element.getBoundingClientRect();
                    let newIframeOffset = { x: 0, y: 0 };
                    if (parentIframe) {
                        const iframeRect = parentIframe.getBoundingClientRect();
                        newIframeOffset.x = iframeRect.left;
                        newIframeOffset.y = iframeRect.top;
                    }
                    const newTop = newRect.top + newIframeOffset.y;
                    const newLeft = newRect.left + newIframeOffset.x;
                    overlay.style.top = `${newTop}px`;
                    overlay.style.left = `${newLeft}px`;
                    overlay.style.width = `${newRect.width}px`;
                    overlay.style.height = `${newRect.height}px`;

                    let newLabelTop = newTop + 2;
                    let newLabelLeft = newLeft + newRect.width - labelWidth - 2;
                    if (newRect.width < labelWidth + 4 || newRect.height < labelHeight + 4) {
                        newLabelTop = newTop - labelHeight - 2;
                        newLabelLeft = newLeft + newRect.width - labelWidth;
                    }
                    label.style.top = `${newLabelTop}px`;
                    label.style.left = `${newLabelLeft}px`;
                };

                window.addEventListener("scroll", updatePositions);
                window.addEventListener("resize", updatePositions);

                return index + 1;
            } finally {
                popTiming("highlighting");
            }
        };

        function getXPathTree(element: Element, stopAtBoundary = true): string {
            const segments: string[] = [];
            let currentElement: Node | null = element;

            while (currentElement && currentElement.nodeType === Node.ELEMENT_NODE) {
                if (
                    stopAtBoundary &&
                    (currentElement.parentNode instanceof ShadowRoot ||
                        currentElement.parentNode instanceof HTMLIFrameElement)
                ) {
                    break;
                }

                let index = 0;
                let sibling = currentElement.previousSibling;
                while (sibling) {
                    if (
                        sibling.nodeType === Node.ELEMENT_NODE &&
                        sibling.nodeName === currentElement.nodeName
                    ) {
                        index++;
                    }
                    sibling = sibling.previousSibling;
                }

                const tagName = (currentElement as Element).tagName.toLowerCase();
                const xpathIndex = index > 0 ? `[${index + 1}]` : "";
                segments.unshift(`${tagName}${xpathIndex}`);

                currentElement = currentElement.parentNode;
            }

            return segments.join("/");
        }

        let isTextNodeVisible = (textNode: Text): boolean => {
            try {
                const range = document.createRange();
                range.selectNodeContents(textNode);
                const rect = range.getBoundingClientRect();

                if (rect.width === 0 || rect.height === 0) {
                    return false;
                }

                const isInViewport = !(
                    rect.bottom < -viewportExpansion ||
                    rect.top > window.innerHeight + viewportExpansion ||
                    rect.right < -viewportExpansion ||
                    rect.left > window.innerWidth + viewportExpansion
                );

                const parentElement = textNode.parentElement;
                if (!parentElement) return false;

                try {
                    // @ts-ignore: checkVisibility may not exist on all elements
                    return isInViewport && parentElement.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
                } catch (e) {
                    const style = window.getComputedStyle(parentElement);
                    return (
                        isInViewport &&
                        style.display !== "none" &&
                        style.visibility !== "hidden" &&
                        style.opacity !== "0"
                    );
                }
            } catch (e) {
                console.warn("Error checking text node visibility:", e);
                return false;
            }
        }

        function isElementAccepted(element: Element | null): boolean {
            if (!element || !element.tagName) return false;
            const alwaysAccept = new Set(["body", "div", "main", "article", "section", "nav", "header", "footer"]);
            const tagName = element.tagName.toLowerCase();
            if (alwaysAccept.has(tagName)) return true;
            const leafElementDenyList = new Set(["svg", "script", "style", "link", "meta", "noscript", "template"]);
            return !leafElementDenyList.has(tagName);
        }

        let isElementVisible = (element: Element): boolean => {
            const style = getCachedComputedStyle(element);
            return (
                element instanceof HTMLElement &&
                element.offsetWidth > 0 &&
                element.offsetHeight > 0 &&
                style !== null &&
                style.visibility !== "hidden" &&
                style.display !== "none"
            );
        }

        let isInteractiveElement = (element: Element): boolean => {
            if (!element || element.nodeType !== Node.ELEMENT_NODE) {
                return false;
            }

            const isCookieBannerElement =
                typeof element.closest === "function" &&
                (element.closest('[id*="onetrust"]') ||
                    element.closest('[class*="onetrust"]') ||
                    element.closest('[data-nosnippet="true"]') ||
                    element.closest('[aria-label*="cookie"]'));

            if (isCookieBannerElement) {
                if (
                    element.tagName.toLowerCase() === "button" ||
                    element.getAttribute("role") === "button" ||
                    (element as HTMLElement).onclick ||
                    element.getAttribute("onclick") ||
                    (element.classList &&
                        (element.classList.contains("ot-sdk-button") ||
                            element.classList.contains("accept-button") ||
                            element.classList.contains("reject-button"))) ||
                    element.getAttribute("aria-label")?.toLowerCase().includes("accept") ||
                    element.getAttribute("aria-label")?.toLowerCase().includes("reject")
                ) {
                    return true;
                }
            }

            const interactiveElements = new Set([
                "a",
                "button",
                "details",
                "embed",
                "input",
                "menu",
                "menuitem",
                "object",
                "select",
                "textarea",
                "canvas",
                "summary",
                "dialog",
                "banner",
            ]);

            const interactiveRoles = new Set([
                "button-icon",
                "dialog",
                "button-text-icon-only",
                "treeitem",
                "alert",
                "grid",
                "progressbar",
                "radio",
                "checkbox",
                "menuitem",
                "option",
                "switch",
                "dropdown",
                "scrollbar",
                "combobox",
                "a-button-text",
                "button",
                "region",
                "textbox",
                "tabpanel",
                "tab",
                "click",
                "button-text",
                "spinbutton",
                "a-button-inner",
                "link",
                "menu",
                "slider",
                "listbox",
                "a-dropdown-button",
                "button-icon-only",
                "searchbox",
                "menuitemradio",
                "tooltip",
                "tree",
                "menuitemcheckbox",
            ]);

            const tagName = element.tagName.toLowerCase();
            const role = element.getAttribute("role");
            const ariaRole = element.getAttribute("aria-role");
            const tabIndex = element.getAttribute("tabindex");

            const hasAddressInputClass =
                element.classList &&
                (element.classList.contains("address-input__container__input") ||
                    element.classList.contains("nav-btn") ||
                    element.classList.contains("pull-left"));

            if (
                element.classList &&
                (element.classList.contains("dropdown-toggle") ||
                    element.getAttribute("data-toggle") === "dropdown" ||
                    element.getAttribute("aria-haspopup") === "true")
            ) {
                return true;
            }

            const hasInteractiveRole =
                hasAddressInputClass ||
                interactiveElements.has(tagName) ||
                interactiveRoles.has(role || "") ||
                interactiveRoles.has(ariaRole || "") ||
                (tabIndex !== null &&
                    tabIndex !== "-1" &&
                    element.parentElement?.tagName.toLowerCase() !== "body") ||
                element.getAttribute("data-action") === "a-dropdown-select" ||
                element.getAttribute("data-action") === "a-dropdown-button";

            if (hasInteractiveRole) return true;

            const isCookieBanner =
                (element.id &&
                    (element.id.toLowerCase().includes("cookie") ||
                        element.id.toLowerCase().includes("consent") ||
                        element.id.toLowerCase().includes("notice"))) ||
                (element.classList &&
                    (element.classList.contains("otCenterRounded") ||
                        element.classList.contains("ot-sdk-container"))) ||
                element.getAttribute("data-nosnippet") === "true" ||
                element.getAttribute("aria-label")?.toLowerCase().includes("cookie") ||
                element.getAttribute("aria-label")?.toLowerCase().includes("consent") ||
                (element.tagName.toLowerCase() === "div" &&
                    (element.id?.includes("onetrust") ||
                        (element.classList &&
                            (element.classList.contains("onetrust") ||
                                element.classList.contains("cookie") ||
                                element.classList.contains("consent")))));
            if (isCookieBanner) return true;

            const isInCookieBanner =
                typeof element.closest === "function" &&
                element.closest(
                    '[id*="cookie"],[id*="consent"],[class*="cookie"],[class*="consent"],[id*="onetrust"]'
                );

            if (
                isInCookieBanner &&
                (element.tagName.toLowerCase() === "button" ||
                    element.getAttribute("role") === "button" ||
                    (element.classList && element.classList.contains("button")) ||
                    (element as HTMLElement).onclick ||
                    element.getAttribute("onclick"))
            ) {
                return true;
            }

            const style = window.getComputedStyle(element);
            const hasClickHandler =
                (element as HTMLElement).onclick !== null ||
                element.getAttribute("onclick") !== null ||
                element.hasAttribute("ng-click") ||
                element.hasAttribute("@click") ||
                element.hasAttribute("v-on:click");

            function getEventListeners(el: Element): Record<string, any> {
                try {
                    // @ts-ignore
                    return window.getEventListeners?.(el) || {};
                } catch (e) {
                    const listeners: Record<string, any> = {};
                    const eventTypes = [
                        "click",
                        "mousedown",
                        "mouseup",
                        "touchstart",
                        "touchend",
                        "keydown",
                        "keyup",
                        "focus",
                        "blur",
                    ];
                    for (const type of eventTypes) {
                        const handler = (el as any)[`on${type}`];
                        if (handler) {
                            listeners[type] = [{ listener: handler, useCapture: false }];
                        }
                    }
                    return listeners;
                }
            }

            const listeners = getEventListeners(element);
            const hasClickListeners =
                listeners &&
                ((listeners.click && listeners.click.length > 0) ||
                    (listeners.mousedown && listeners.mousedown.length > 0) ||
                    (listeners.mouseup && listeners.mouseup.length > 0) ||
                    (listeners.touchstart && listeners.touchstart.length > 0) ||
                    (listeners.touchend && listeners.touchend.length > 0));

            const hasAriaProps =
                element.hasAttribute("aria-expanded") ||
                element.hasAttribute("aria-pressed") ||
                element.hasAttribute("aria-selected") ||
                element.hasAttribute("aria-checked");

            const isContentEditable =
                element.getAttribute("contenteditable") === "true" ||
                (element as HTMLElement).isContentEditable ||
                element.id === "tinymce" ||
                element.classList.contains("mce-content-body") ||
                (element.tagName.toLowerCase() === "body" && element.getAttribute("data-id")?.startsWith("mce_"));

            const isDraggable =
                (element as HTMLElement).draggable || element.getAttribute("draggable") === "true";

            return (
                hasAriaProps ||
                hasClickHandler ||
                hasClickListeners ||
                isDraggable ||
                isContentEditable
            );
        };

        let isTopElement = (element: Element): boolean => {
            const rect = getCachedBoundingRect(element);
            if (!rect) return true;
            const isInViewport =
                rect.left < window.innerWidth &&
                rect.right > 0 &&
                rect.top < window.innerHeight &&
                rect.bottom > 0;
            if (!isInViewport) {
                return true;
            }
            let doc = element.ownerDocument;
            if (doc !== window.document) {
                return true;
            }
            const shadowRoot = element.getRootNode();
            if (shadowRoot instanceof ShadowRoot) {
                const centerX = rect.left + rect.width / 2;
                const centerY = rect.top + rect.height / 2;
                try {
                    const topEl = measureDomOperation(
                        () => (shadowRoot as ShadowRoot).elementFromPoint(centerX, centerY),
                        "elementFromPoint"
                    );
                    if (!topEl) return false;
                    let current: Node | null = topEl;
                    while (current && current !== shadowRoot) {
                        if (current === element) return true;
                        current = (current as Element).parentElement;
                    }
                    return false;
                } catch (e) {
                    return true;
                }
            }
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            try {
                const topEl = document.elementFromPoint(centerX, centerY);
                if (!topEl) return false;
                let current: Node | null = topEl;
                while (current && current !== document.documentElement) {
                    if (current === element) return true;
                    current = (current as Element).parentElement;
                }
                return false;
            } catch (e) {
                return true;
            }
        }

        let isInExpandedViewport = (element: Element, viewportExpansion: number): boolean => {
            if (viewportExpansion === -1) {
                return true;
            }
            const rect = getCachedBoundingRect(element);
            if (!rect) return false;
            return !(
                rect.bottom < -viewportExpansion ||
                rect.top > window.innerHeight + viewportExpansion ||
                rect.right < -viewportExpansion ||
                rect.left > window.innerWidth + viewportExpansion
            );
        }

        let getEffectiveScroll = (element: Element): ScrollOffset => {
            let currentEl: Element | null = element;
            let scrollX = 0;
            let scrollY = 0;
            return measureDomOperation(() => {
                while (currentEl && currentEl !== document.documentElement) {
                    if (currentEl.scrollLeft || currentEl.scrollTop) {
                        scrollX += currentEl.scrollLeft;
                        scrollY += currentEl.scrollTop;
                    }
                    currentEl = currentEl.parentElement;
                }
                scrollX += window.scrollX;
                scrollY += window.scrollY;
                return { scrollX, scrollY };
            }, "scrollOperations");
        };

        function isInteractiveCandidate(element: Element | null): boolean {
            if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
            const tagName = element.tagName.toLowerCase();
            const interactiveElements = new Set(["a", "button", "input", "select", "textarea", "details", "summary"]);
            if (interactiveElements.has(tagName)) return true;
            const hasQuickInteractiveAttr =
                element.hasAttribute("onclick") ||
                element.hasAttribute("role") ||
                element.hasAttribute("tabindex") ||
                Array.from(element.attributes).some((attr) => attr.name.startsWith("aria-")) ||
                element.hasAttribute("data-action");
            return hasQuickInteractiveAttr;
        }

        function quickVisibilityCheck(element: Element): boolean {
            return (
                element instanceof HTMLElement &&
                element.offsetWidth > 0 &&
                element.offsetHeight > 0 &&
                !element.hasAttribute("hidden") &&
                element.style.display !== "none" &&
                element.style.visibility !== "hidden"
            );
        }

        function buildDomTree(node: Node, parentIframe: Element | null = null): string | null {
            if (debugMode && PERF_METRICS) PERF_METRICS.nodeMetrics.totalNodes++;

            if (!node || (node.nodeType === Node.ELEMENT_NODE && (node as Element).id === HIGHLIGHT_CONTAINER_ID)) {
                if (debugMode && PERF_METRICS) PERF_METRICS.nodeMetrics.skippedNodes++;
                return null;
            }

            if (node === document.body) {
                const nodeData: DOMNodeData = {
                    tagName: "body",
                    attributes: {},
                    xpath: "/body",
                    children: [],
                };

                node.childNodes.forEach((child) => {
                    const domElement = buildDomTree(child, parentIframe);
                    if (domElement) nodeData.children?.push(domElement);
                });

                const id = `${ID.current++}`;
                DOM_HASH_MAP[id] = nodeData;
                if (debugMode && PERF_METRICS) PERF_METRICS.nodeMetrics.processedNodes++;
                return id;
            }

            if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.TEXT_NODE) {
                if (debugMode && PERF_METRICS) PERF_METRICS.nodeMetrics.skippedNodes++;
                return null;
            }

            if (node.nodeType === Node.TEXT_NODE) {
                const textContent = node.textContent?.trim();
                if (!textContent) {
                    if (debugMode && PERF_METRICS) PERF_METRICS.nodeMetrics.skippedNodes++;
                    return null;
                }
                const parentElement = node.parentElement;
                if (!parentElement || parentElement.tagName.toLowerCase() === "script") {
                    if (debugMode && PERF_METRICS) PERF_METRICS.nodeMetrics.skippedNodes++;
                    return null;
                }
                const id = `${ID.current++}`;
                DOM_HASH_MAP[id] = {
                    type: "TEXT_NODE",
                    text: textContent,
                    isVisible: isTextNodeVisible(node as Text),
                };
                if (debugMode && PERF_METRICS) PERF_METRICS.nodeMetrics.processedNodes++;
                return id;
            }

            if (node.nodeType === Node.ELEMENT_NODE && !isElementAccepted(node as Element)) {
                if (debugMode && PERF_METRICS) PERF_METRICS.nodeMetrics.skippedNodes++;
                return null;
            }

            if (viewportExpansion !== -1) {
                const rect = getCachedBoundingRect(node as Element);
                const style = getCachedComputedStyle(node as Element);
                const isFixedOrSticky = style && (style.position === "fixed" || style.position === "sticky");
                const hasSize = (node as HTMLElement).offsetWidth > 0 || (node as HTMLElement).offsetHeight > 0;
                if (
                    !rect ||
                    (!isFixedOrSticky &&
                        !hasSize &&
                        (rect.bottom < -viewportExpansion ||
                            rect.top > window.innerHeight + viewportExpansion ||
                            rect.right < -viewportExpansion ||
                            rect.left > window.innerWidth + viewportExpansion))
                ) {
                    if (debugMode && PERF_METRICS) PERF_METRICS.nodeMetrics.skippedNodes++;
                    return null;
                }
            }

            const nodeData: DOMNodeData = {
                tagName: (node as Element).tagName.toLowerCase(),
                attributes: {},
                xpath: getXPathTree(node as Element, true),
                children: [],
            };

            if (
                isInteractiveCandidate(node as Element) ||
                (node as Element).tagName.toLowerCase() === "iframe" ||
                (node as Element).tagName.toLowerCase() === "body"
            ) {
                const attributeNames = (node as Element).getAttributeNames
                    ? (node as Element).getAttributeNames()
                    : [];
                attributeNames.forEach((name) => {
                    nodeData.attributes![name] = (node as Element).getAttribute(name);
                });
            }

            if (node.nodeType === Node.ELEMENT_NODE) {
                nodeData.isVisible = isElementVisible(node as Element);
                if (nodeData.isVisible) {
                    nodeData.isTopElement = isTopElement(node as Element);
                    if (nodeData.isTopElement) {
                        nodeData.isInteractive = isInteractiveElement(node as Element);
                        if (nodeData.isInteractive) {
                            nodeData.isInViewport = true;
                            nodeData.highlightIndex = highlightIndex++;

                            if (doHighlightElements) {
                                if (focusHighlightIndex >= 0) {
                                    if (focusHighlightIndex === nodeData.highlightIndex) {
                                        highlightElement(node as Element, nodeData.highlightIndex, parentIframe);
                                    }
                                } else {
                                    highlightElement(node as Element, nodeData.highlightIndex, parentIframe);
                                }
                            }
                        }
                    }
                }
            }

            if ((node as Element).tagName) {
                const tagName = (node as Element).tagName.toLowerCase();
                if (tagName === "iframe") {
                    // If this is the iframe containing the captcha, then we highlight any actions on it
                    try {
                        const frameSrc = (node as HTMLIFrameElement).src;
                        console.log("Checking iframe:", frameSrc);
                        const isCaptcha = detectCaptchaFromSrc(frameSrc);
                        if (isCaptcha) {
                            const boundingBox = (node as HTMLIFrameElement).getBoundingClientRect();
                            const captchaBoxHasDimensions = boundingBox.width > 5 && boundingBox.height > 5;
                            if (!captchaBoxHasDimensions) {
                                console.log("Captcha iframe is hidden");
                                return null;
                            }
                            nodeData.pageCoordinates = {
                                top_left: { x: boundingBox.left, y: boundingBox.top },
                                top_right: { x: boundingBox.right, y: boundingBox.top },
                                bottom_left: { x: boundingBox.left, y: boundingBox.bottom },
                                bottom_right: { x: boundingBox.right, y: boundingBox.bottom },
                                center: {
                                    x: boundingBox.left + boundingBox.width / 2,
                                    y: boundingBox.top + boundingBox.height / 2,
                                },
                                width: boundingBox.width,
                                height: boundingBox.height,
                            }
                            console.log("Detected captcha iframe:", frameSrc);
                            const pendingActions = args.pendingActions;
                            console.log("Pending actions:", pendingActions);
                            for (let i = 0; i < pendingActions.length; i++) {
                                const pendingAction = pendingActions[i];
                                highlightActionOverlay(pendingAction, highlightIndex++, node as HTMLIFrameElement);
                            }
                        }
                        const iframeDoc =
                            (node as HTMLIFrameElement).contentDocument ||
                            (node as HTMLIFrameElement).contentWindow?.document;
                        if (iframeDoc) {
                            iframeDoc.childNodes.forEach((child) => {
                                const domElement = buildDomTree(child, node as Element);
                                if (domElement) nodeData.children?.push(domElement);
                            });
                        }
                    } catch (e) {
                        console.warn("Unable to access iframe:", e);
                    }
                } else if (
                    (node as HTMLElement).isContentEditable ||
                    (node as Element).getAttribute("contenteditable") === "true" ||
                    (node as Element).id === "tinymce" ||
                    (node as Element).classList.contains("mce-content-body") ||
                    (tagName === "body" && (node as Element).getAttribute("data-id")?.startsWith("mce_"))
                ) {
                    node.childNodes.forEach((child) => {
                        const domElement = buildDomTree(child, parentIframe);
                        if (domElement) nodeData.children?.push(domElement);
                    });
                } else if ((node as Element).shadowRoot) {
                    nodeData.shadowRoot = true;
                    (node as Element).shadowRoot!.childNodes.forEach((child) => {
                        const domElement = buildDomTree(child, parentIframe);
                        if (domElement) nodeData.children?.push(domElement);
                    });
                } else {
                    node.childNodes.forEach((child) => {
                        const domElement = buildDomTree(child, parentIframe);
                        if (domElement) nodeData.children?.push(domElement);
                    });
                }
            }

            if (
                nodeData.tagName === "a" &&
                nodeData.children &&
                nodeData.children.length === 0 &&
                !nodeData.attributes?.href
            ) {
                if (debugMode && PERF_METRICS) PERF_METRICS.nodeMetrics.skippedNodes++;
                return null;
            }

            const id = `${ID.current++}`;
            DOM_HASH_MAP[id] = nodeData;
            if (debugMode && PERF_METRICS) PERF_METRICS.nodeMetrics.processedNodes++;
            return id;
        }

        // Wrap functions with performance measurement
        highlightElement = measureTime(highlightElement);
        isInteractiveElement = measureTime(isInteractiveElement);
        isElementVisible = measureTime(isElementVisible);
        isTopElement = measureTime(isTopElement);
        isInExpandedViewport = measureTime(isInExpandedViewport);
        isTextNodeVisible = measureTime(isTextNodeVisible);
        getEffectiveScroll = measureTime(getEffectiveScroll);

        const rootId = buildDomTree(document.body);


        // Clear cache before starting
        DOM_CACHE.clearCache();

        if (debugMode && PERF_METRICS) {
            Object.keys(PERF_METRICS.timings).forEach((key) => {
                PERF_METRICS!.timings[key as keyof typeof PERF_METRICS.timings] /= 1000;
            });
            Object.keys(PERF_METRICS.buildDomTreeBreakdown).forEach((key) => {
                // Only process number properties (not objects)
                if (key !== 'domOperations' && key !== 'domOperationCounts') {
                    const typedKey = key as 'totalTime' | 'totalSelfTime' | 'buildDomTreeCalls' | 'averageTimePerNode' | 'timeInChildCalls';
                    if (typeof PERF_METRICS!.buildDomTreeBreakdown[typedKey] === "number") {
                        // Safe to update the number property
                        PERF_METRICS!.buildDomTreeBreakdown[typedKey] = Number(PERF_METRICS!.buildDomTreeBreakdown[typedKey]) / 1000;
                    }
                }
            });
            if (PERF_METRICS.buildDomTreeBreakdown.buildDomTreeCalls > 0) {
                PERF_METRICS.buildDomTreeBreakdown.averageTimePerNode =
                    PERF_METRICS.buildDomTreeBreakdown.totalTime / PERF_METRICS.buildDomTreeBreakdown.buildDomTreeCalls;
            }
            PERF_METRICS.buildDomTreeBreakdown.timeInChildCalls =
                PERF_METRICS.buildDomTreeBreakdown.totalTime - PERF_METRICS.buildDomTreeBreakdown.totalSelfTime;

            Object.keys(PERF_METRICS.buildDomTreeBreakdown.domOperations).forEach((op) => {
                const time = PERF_METRICS!.buildDomTreeBreakdown.domOperations[op];
                const count = PERF_METRICS!.buildDomTreeBreakdown.domOperationCounts[op];
                if (count > 0) {
                    PERF_METRICS!.buildDomTreeBreakdown.domOperations[`${op}Average`] = time / count;
                }
            });

            const boundingRectTotal =
                PERF_METRICS.cacheMetrics.boundingRectCacheHits + PERF_METRICS.cacheMetrics.boundingRectCacheMisses;
            const computedStyleTotal =
                PERF_METRICS.cacheMetrics.computedStyleCacheHits + PERF_METRICS.cacheMetrics.computedStyleCacheMisses;

            if (boundingRectTotal > 0) {
                PERF_METRICS.cacheMetrics.boundingRectHitRate = PERF_METRICS.cacheMetrics.boundingRectCacheHits / boundingRectTotal;
            }
            if (computedStyleTotal > 0) {
                PERF_METRICS.cacheMetrics.computedStyleHitRate = PERF_METRICS.cacheMetrics.computedStyleCacheHits / computedStyleTotal;
            }
            if (boundingRectTotal + computedStyleTotal > 0) {
                PERF_METRICS.cacheMetrics.overallHitRate =
                    (PERF_METRICS.cacheMetrics.boundingRectCacheHits + PERF_METRICS.cacheMetrics.computedStyleCacheHits) /
                    (boundingRectTotal + computedStyleTotal);
            }
        }

        return debugMode && PERF_METRICS
            ? { rootId, map: DOM_HASH_MAP, perfMetrics: PERF_METRICS }
            : { rootId, map: DOM_HASH_MAP };
    }, args);
}

export default buildDomTree;