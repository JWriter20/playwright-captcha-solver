import * as fs from "fs";
import * as path from "path";
import { Page } from "playwright";
import {
    DOMBaseNode,
    DOMElementNode,
    DOMState,
    DOMTextNode,
    SelectorMap,
} from "./views.js";

// A simple interface for viewport dimensions.
export interface ViewportInfo {
    width: number;
    height: number;
}

// Optional helper for timing async functions.
async function timeExecutionAsync<T>(
    label: string,
    fn: () => Promise<T>
): Promise<T> {
    console.time(label);
    const result = await fn();
    console.timeEnd(label);
    return result;
}

export class DomService {
    page: Page;
    xpathCache: Record<string, unknown>;
    jsCode: string;
    // You can set this flag based on your logging level/environment.
    debugMode: boolean;

    constructor(page: Page) {
        this.page = page;
        this.xpathCache = {};
        // Read the JS code to be evaluated in the browser.
        this.jsCode = fs.readFileSync(
            path.join(__dirname, "buildDomTree.js"),
            "utf-8"
        );
        // For example, set debugMode if running in development.
        this.debugMode = process.env.NODE_ENV === "development";
    }

    async getClickableElements(
        highlightElements: boolean = true,
        focusElement: number = -1,
        viewportExpansion: number = 0
    ): Promise<DOMState> {
        // Wrap the DOM building steps with timing if desired.
        const [elementTree, selectorMap] = await timeExecutionAsync(
            "--get_clickable_elements",
            () => this._buildDomTree(highlightElements, focusElement, viewportExpansion)
        );
        return { element_tree: elementTree, selector_map: selectorMap };
    }

    async _buildDomTree(
        highlightElements: boolean,
        focusElement: number,
        viewportExpansion: number
    ): Promise<[DOMElementNode, SelectorMap]> {
        // Sanity check that the page can evaluate JavaScript.
        const evalResult = await this.page.evaluate(() => 1 + 1);
        if (evalResult !== 2) {
            throw new Error("The page cannot evaluate JavaScript code properly");
        }

        const args = {
            doHighlightElements: highlightElements,
            focusHighlightIndex: focusElement,
            viewportExpansion: viewportExpansion,
            debugMode: this.debugMode,
        };

        let evalPage: any;
        try {
            evalPage = await this.page.evaluate(this.jsCode, args);
        } catch (e) {
            console.error("Error evaluating JavaScript:", e);
            throw e;
        }

        if (this.debugMode && evalPage.perfMetrics) {
            console.debug(
                "DOM Tree Building Performance Metrics:\n",
                JSON.stringify(evalPage.perfMetrics, null, 2)
            );
        }

        return await timeExecutionAsync("--construct_dom_tree", () =>
            this._constructDomTree(evalPage)
        );
    }

    async _constructDomTree(
        evalPage: Record<string, any>
    ): Promise<[DOMElementNode, SelectorMap]> {
        const jsNodeMap: Record<string, any> = evalPage.map;
        const jsRootId = evalPage.rootId;

        const selectorMap: SelectorMap = {};
        const nodeMap: Record<string, DOMBaseNode> = {};

        for (const id in jsNodeMap) {
            if (Object.prototype.hasOwnProperty.call(jsNodeMap, id)) {
                const [node, childrenIds] = this._parseNode(jsNodeMap[id]);
                if (!node) continue;

                nodeMap[id] = node;

                if (
                    node instanceof DOMElementNode &&
                    node.highlight_index != null
                ) {
                    selectorMap[node.highlight_index] = node;
                }

                // Build the tree bottom up (children already processed).
                if (node instanceof DOMElementNode) {
                    for (const childId of childrenIds) {
                        if (!(childId in nodeMap)) continue;
                        const childNode = nodeMap[childId];
                        childNode.parent = node;
                        node.children.push(childNode);
                    }
                }
            }
        }

        const htmlToDict = nodeMap[String(jsRootId)];

        // (No need for explicit garbage collection in JavaScript)

        if (!htmlToDict || !(htmlToDict instanceof DOMElementNode)) {
            throw new Error("Failed to parse HTML to dictionary");
        }

        return [htmlToDict, selectorMap];
    }

    _parseNode(
        nodeData: Record<string, any>
    ): [DOMBaseNode | null, number[]] {
        if (!nodeData) return [null, []];

        // Process text nodes immediately.
        if (nodeData.type === "TEXT_NODE") {
            const textNode = new DOMTextNode(
                nodeData.text,
                nodeData.isVisible,
                null
            );
            return [textNode, []];
        }

        let viewportInfo: ViewportInfo | undefined;
        if (nodeData.viewport) {
            viewportInfo = {
                width: nodeData.viewport.width,
                height: nodeData.viewport.height,
            };
        }

        const elementNode = new DOMElementNode({
            tag_name: nodeData.tagName,
            xpath: nodeData.xpath,
            attributes: nodeData.attributes || {},
            children: [],
            is_visible: nodeData.isVisible || false,
            is_interactive: nodeData.isInteractive || false,
            is_top_element: nodeData.isTopElement || false,
            is_in_viewport: nodeData.isInViewport || false,
            highlight_index: nodeData.highlightIndex,
            shadow_root: nodeData.shadowRoot || false,
            parent: undefined,
            viewport_info: viewportInfo,
        });

        const childrenIds: number[] = nodeData.children || [];
        return [elementNode, childrenIds];
    }
}
