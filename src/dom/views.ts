import { timeExecutionSync } from "./utils.js";
import { CoordinateSet, HashedDomElement, ViewportInfo } from "./history-tree-processor/view.js";
import { HistoryTreeProcessor } from "./history-tree-processor/service.js";
// To avoid circular imports, use type-only import:
import type { DOMElementNode as DOMElementNodeType } from "./views.js";

/**
 * Base class for DOM nodes.
 */
export class DOMBaseNode {
    is_visible: boolean;
    // Use null as default for parent (set later to avoid circular reference issues)
    parent: DOMElementNode | null;
    constructor(is_visible: boolean, parent: DOMElementNode | null = null) {
        this.is_visible = is_visible;
        this.parent = parent;
    }
}

/**
 * Represents a text node in the DOM.
 */
export class DOMTextNode extends DOMBaseNode {
    text: string;
    type: string = "TEXT_NODE";

    constructor(text: string, is_visible: boolean, parent: DOMElementNode | null = null) {
        super(is_visible, parent);
        this.text = text;
    }

    hasParentWithHighlightIndex(): boolean {
        let current = this.parent;
        while (current !== null) {
            if (current.highlightIndex !== undefined) {
                return true;
            }
            current = current.parent;
        }
        return false;
    }

    isParentInViewport(): boolean {
        return this.parent ? this.parent.is_in_viewport : false;
    }

    isParentTopElement(): boolean {
        return this.parent ? this.parent.is_top_element : false;
    }
}

/**
 * Represents an element node in the DOM.
 *
 * The xpath here is relative to the last root (shadow root, iframe, or document)
 * so that you can traverse up the tree via the `parent` property to resolve the full path.
 */
export class DOMElementNode extends DOMBaseNode {
    tagName: string;
    xpath: string;
    attributes: { [key: string]: string };
    children: DOMBaseNode[];
    is_interactive: boolean;
    is_top_element: boolean;
    is_in_viewport: boolean;
    shadow_root: boolean;
    highlightIndex: number | undefined;
    viewport_coordinates: CoordinateSet | undefined;
    page_coordinates: CoordinateSet | undefined;
    viewport_info: ViewportInfo | undefined;

    // Private field used to cache the hash
    private _hash?: HashedDomElement;
    cssSelector: string;

    constructor(options: {
        tagName: string;
        xpath: string;
        attributes: { [key: string]: string };
        children?: DOMBaseNode[];
        is_visible: boolean;
        is_interactive?: boolean;
        is_top_element?: boolean;
        is_in_viewport?: boolean;
        shadow_root?: boolean;
        highlightIndex?: number | undefined;
        viewport_coordinates?: CoordinateSet | undefined;
        page_coordinates?: CoordinateSet | undefined;
        viewport_info?: ViewportInfo | undefined;
        parent?: DOMElementNode | undefined;
    }) {
        super(options.is_visible, options.parent ?? null);
        this.tagName = options.tagName;
        this.xpath = options.xpath;
        this.attributes = options.attributes;
        this.children = options.children || [];
        this.is_interactive = options.is_interactive ?? false;
        this.is_top_element = options.is_top_element ?? false;
        this.is_in_viewport = options.is_in_viewport ?? false;
        this.shadow_root = options.shadow_root ?? false;
        this.highlightIndex = options.highlightIndex;
        this.viewport_coordinates = options.viewport_coordinates;
        this.page_coordinates = options.page_coordinates;
        this.viewport_info = options.viewport_info;
    }

    /**
     * Returns a string representation of the element, including its attributes
     * and extra info such as interactivity and viewport status.
     */
    toString(): string {
        let tagStr = `<${this.tagName}`;
        for (const key in this.attributes) {
            if (Object.prototype.hasOwnProperty.call(this.attributes, key)) {
                tagStr += ` ${key}="${this.attributes[key]}"`;
            }
        }
        tagStr += ">";
        const extras: string[] = [];
        if (this.is_interactive) extras.push("interactive");
        if (this.is_top_element) extras.push("top");
        if (this.shadow_root) extras.push("shadow-root");
        if (this.highlightIndex !== undefined)
            extras.push(`highlight:${this.highlightIndex}`);
        if (this.is_in_viewport) extras.push("in-viewport");
        if (extras.length > 0) {
            tagStr += ` [${extras.join(", ")}]`;
        }
        return tagStr;
    }

    /**
     * A cached hash of this DOM element.
     */
    get hash(): HashedDomElement {
        if (this._hash === undefined) {
            this._hash = HistoryTreeProcessor._hashDomElement(this);
        }
        return this._hash;
    }

    /**
     * Recursively collects all text from this node until a clickable element is encountered.
     * @param maxDepth Maximum recursion depth (-1 for unlimited)
     */
    getAllTextTillNextClickableElement(maxDepth: number = -1): string {
        const textParts: string[] = [];
        const collectText = (node: DOMBaseNode, currentDepth: number): void => {
            if (maxDepth !== -1 && currentDepth > maxDepth) return;
            // If we hit a highlighted element (other than self), skip this branch.
            if (node instanceof DOMElementNode && node !== this && node.highlightIndex !== undefined) {
                return;
            }
            if (node instanceof DOMTextNode) {
                textParts.push(node.text);
            } else if (node instanceof DOMElementNode) {
                for (const child of node.children) {
                    collectText(child, currentDepth + 1);
                }
            }
        };
        collectText(this, 0);
        return textParts.join("\n").trim();
    }

    /**
     * Converts the processed DOM content to a string representation of clickable elements.
     * Optionally includes a list of attributes for each clickable element.
     */
    clickableElementsToString(includeAttributes?: string[] | null): string {
        return timeExecutionSync("")(() => {
            const formattedText: string[] = [];
            const processNode = (node: DOMBaseNode, depth: number): void => {
                if (node instanceof DOMElementNode) {
                    if (node.highlightIndex !== undefined) {
                        let attributesStr = "";
                        const text = node.getAllTextTillNextClickableElement();
                        if (includeAttributes && includeAttributes.length > 0) {
                            const attributesSet = new Set<string>(
                                Object.entries(node.attributes)
                                    .filter(([key, value]) => includeAttributes.includes(key) && value !== node.tagName)
                                    .map(([_, value]) => String(value))
                            );
                            if (attributesSet.has(text)) {
                                attributesSet.delete(text);
                            }
                            attributesStr = Array.from(attributesSet).join(";");
                        }
                        let line = `[${node.highlightIndex}]<${node.tagName} `;
                        if (attributesStr) {
                            line += `${attributesStr}`;
                        }
                        if (text) {
                            line += attributesStr ? `>${text}` : `${text}`;
                        }
                        line += "/>";
                        formattedText.push(line);
                    }
                    // Process children recursively.
                    for (const child of node.children) {
                        processNode(child, depth + 1);
                    }
                } else if (node instanceof DOMTextNode) {
                    // Only add text if it does not have a parent with a highlight index and is visible.
                    if (!node.hasParentWithHighlightIndex() && node.is_visible) {
                        formattedText.push(node.text);
                    }
                }
            };
            processNode(this, 0);
            return formattedText.join("\n");
        })(); // Immediately invoke the function returned by timeExecutionSync.
    }

    /**
     * Searches for and returns a file upload element within this node’s subtree or among its siblings.
     * @param checkSiblings If true, also checks siblings (only on the initial call)
     */
    getFileUploadElement(checkSiblings: boolean = true): DOMElementNode | null {
        if (this.tagName === "input" && this.attributes["type"] === "file") {
            return this;
        }
        // Check children.
        for (const child of this.children) {
            if (child instanceof DOMElementNode) {
                const result = child.getFileUploadElement(false);
                if (result) {
                    return result;
                }
            }
        }
        // Check siblings only for the initial call.
        if (checkSiblings && this.parent) {
            for (const sibling of this.parent.children) {
                if (sibling !== this && sibling instanceof DOMElementNode) {
                    const result = sibling.getFileUploadElement(false);
                    if (result) {
                        return result;
                    }
                }
            }
        }
        return null;
    }
}

/**
 * A map from highlight index to clickable element.
 */
export type SelectorMap = Record<number, DOMElementNode>;

/**
 * A structure that holds the DOM tree and a selector map.
 */
export class DOMState {
    elementTree: DOMElementNode;
    selectorMap: SelectorMap;

    constructor(elementTree: DOMElementNode, selectorMap: SelectorMap) {
        this.elementTree = elementTree;
        this.selectorMap = selectorMap;
    }
}
