import { CaptchaAction } from 'src/llm-connectors/llm-connector.js';
import { DOMHistoryElement } from '../dom/history-tree-processor/view.js';
import { DOMElementNode, DOMState } from '../dom/views.js';
import type { SelectorMap } from '../dom/views.js';

// ──────────────────────────────
// TabInfo
// ──────────────────────────────

export class TabInfo {
    pageId: number;
    url: string;
    title: string;

    constructor(pageId: number, url: string, title: string) {
        this.pageId = pageId;
        this.url = url;
        this.title = title;
    }

    // Similar to Pydantic's model_dump()
    toDict(): { [key: string]: any } {
        return {
            pageId: this.pageId,
            url: this.url,
            title: this.title,
        };
    }
}

// ──────────────────────────────
// BrowserState
// ──────────────────────────────

export class BrowserState extends DOMState {
    url: string;
    title: string;
    tabs: TabInfo[];
    screenshot?: string;
    captchaScreenshot?: string;
    captchaElem: DOMElementNode | null;
    pixelsAbove: number;
    pixelsBelow: number;
    browserErrors: string[];
    pendingActions: CaptchaAction[];
    pastActions: CaptchaAction[];

    constructor(
        url: string,
        title: string,
        tabs: TabInfo[],
        elementTree: DOMElementNode,
        selectorMap: SelectorMap,
        screenshot?: string,
        pixelsAbove: number = 0,
        pixelsBelow: number = 0,
        browserErrors: string[] = [],
        pendingActions: CaptchaAction[] = [],
        pastActions: CaptchaAction[] = []

    ) {
        super(elementTree, selectorMap);
        this.url = url;
        this.title = title;
        this.tabs = tabs;
        this.screenshot = screenshot;
        this.pixelsAbove = pixelsAbove;
        this.pixelsBelow = pixelsBelow;
        this.browserErrors = browserErrors;
        this.pendingActions = pendingActions;
        this.pastActions = pastActions;
    }
}

// ──────────────────────────────
// BrowserStateHistory
// ──────────────────────────────

export class BrowserStateHistory {
    url: string;
    title: string;
    tabs: TabInfo[];
    interactedElement: (DOMHistoryElement | null)[];
    screenshot?: string;

    constructor(
        url: string,
        title: string,
        tabs: TabInfo[],
        interactedElement: (DOMHistoryElement | null)[],
        screenshot?: string
    ) {
        this.url = url;
        this.title = title;
        this.tabs = tabs;
        this.interactedElement = interactedElement;
        this.screenshot = screenshot;
    }

    toDict(): { [key: string]: any } {
        return {
            url: this.url,
            title: this.title,
            tabs: this.tabs.map((tab) => tab.toDict()),
            interactedElement: this.interactedElement.map((el) =>
                el ? el.toDict() : null
            ),
            screenshot: this.screenshot,
        };
    }
}

// ──────────────────────────────
// Error classes
// ──────────────────────────────

export class BrowserError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'BrowserError';
    }
}

export class URLNotAllowedError extends BrowserError {
    constructor(message: string) {
        super(message);
        this.name = 'URLNotAllowedError';
    }
}
