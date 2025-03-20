// service.ts
import * as crypto from "crypto";
import { DOMHistoryElement, HashedDomElement } from "./view";
import { DOMElementNode } from "../views";
import { BrowserContext } from "playwright";
import { CssSelectorHelper } from "../browser-helper-funcs";

export class HistoryTreeProcessor {
    /**
     * Converts a DOM element to a history element.
     */
    static convertDomElementToHistoryElement(domElement: DOMElementNode): DOMHistoryElement {
        const parentBranchPath = HistoryTreeProcessor._getParentBranchPath(domElement);
        const cssSelector = CssSelectorHelper.enhancedCssSelectorForElement(domElement);
        return new DOMHistoryElement({
            tag_name: domElement.tag_name,
            xpath: domElement.xpath,
            highlight_index: domElement.highlight_index,
            entire_parent_branch_path: parentBranchPath,
            attributes: domElement.attributes,
            shadow_root: domElement.shadow_root,
            css_selector: cssSelector,
            page_coordinates: domElement.page_coordinates,
            viewport_coordinates: domElement.viewport_coordinates,
            viewport_info: domElement.viewport_info,
        });
    }

    /**
     * Searches the DOM tree for an element whose hash matches that of the given history element.
     */
    static findHistoryElementInTree(
        domHistoryElement: DOMHistoryElement,
        tree: DOMElementNode
    ): DOMElementNode | null {
        const hashedDomHistoryElement = HistoryTreeProcessor._hashDomHistoryElement(domHistoryElement);

        function processNode(node: DOMElementNode): DOMElementNode | null {
            if (node.highlight_index !== null && node.highlight_index !== undefined) {
                const hashedNode = HistoryTreeProcessor._hashDomElement(node);
                if (HistoryTreeProcessor._compareHashedDomElements(hashedNode, hashedDomHistoryElement)) {
                    return node;
                }
            }
            for (const child of node.children) {
                if (child instanceof DOMElementNode) {
                    const result = processNode(child);
                    if (result !== null) {
                        return result;
                    }
                }
            }
            return null;
        }

        return processNode(tree);
    }

    /**
     * Compares a history element with a DOM element by comparing their computed hashes.
     */
    static compareHistoryElementAndDomElement(
        domHistoryElement: DOMHistoryElement,
        domElement: DOMElementNode
    ): boolean {
        const hashedDomHistoryElement = HistoryTreeProcessor._hashDomHistoryElement(domHistoryElement);
        const hashedDomElement = HistoryTreeProcessor._hashDomElement(domElement);
        return HistoryTreeProcessor._compareHashedDomElements(hashedDomHistoryElement, hashedDomElement);
    }

    /**
     * Computes the hash for a DOM history element.
     */
    static _hashDomHistoryElement(domHistoryElement: DOMHistoryElement): HashedDomElement {
        const branchPathHash = HistoryTreeProcessor._parentBranchPathHash(domHistoryElement.entire_parent_branch_path);
        const attributesHash = HistoryTreeProcessor._attributesHash(domHistoryElement.attributes);
        const xpathHash = HistoryTreeProcessor._xpathHash(domHistoryElement.xpath);
        return { branch_path_hash: branchPathHash, attributes_hash: attributesHash, xpath_hash: xpathHash };
    }

    /**
     * Computes the hash for a DOM element.
     */
    static _hashDomElement(domElement: DOMElementNode): HashedDomElement {
        const parentBranchPath = HistoryTreeProcessor._getParentBranchPath(domElement);
        const branchPathHash = HistoryTreeProcessor._parentBranchPathHash(parentBranchPath);
        const attributesHash = HistoryTreeProcessor._attributesHash(domElement.attributes);
        const xpathHash = HistoryTreeProcessor._xpathHash(domElement.xpath);
        // Optionally, compute a text hash:
        // const textHash = HistoryTreeProcessor._textHash(domElement);
        return { branch_path_hash: branchPathHash, attributes_hash: attributesHash, xpath_hash: xpathHash };
    }

    /**
     * Builds an array of parent tag names for the given element.
     */
    static _getParentBranchPath(domElement: DOMElementNode): string[] {
        const parents: DOMElementNode[] = [];
        let currentElement: DOMElementNode = domElement;
        while (currentElement.parent !== null) {
            parents.push(currentElement);
            currentElement = currentElement.parent;
        }
        parents.reverse();
        return parents.map((parent) => parent.tag_name);
    }

    /**
     * Computes a SHA-256 hash of the parent branch path.
     */
    static _parentBranchPathHash(parentBranchPath: string[]): string {
        const parentBranchPathString = parentBranchPath.join("/");
        return crypto.createHash("sha256").update(parentBranchPathString).digest("hex");
    }

    /**
     * Computes a SHA-256 hash of the element's attributes.
     */
    static _attributesHash(attributes: { [key: string]: string }): string {
        const attributesString = Object.entries(attributes)
            .map(([key, value]) => `${key}=${value}`)
            .join("");
        return crypto.createHash("sha256").update(attributesString).digest("hex");
    }

    /**
     * Computes a SHA-256 hash of the element's xpath.
     */
    static _xpathHash(xpath: string): string {
        return crypto.createHash("sha256").update(xpath).digest("hex");
    }

    /**
     * Computes a SHA-256 hash of the element's text content.
     */
    static _textHash(domElement: DOMElementNode): string {
        const textString = domElement.getAllTextTillNextClickableElement();
        return crypto.createHash("sha256").update(textString).digest("hex");
    }

    /**
     * Compares two HashedDomElement objects for equality.
     */
    private static _compareHashedDomElements(a: HashedDomElement, b: HashedDomElement): boolean {
        return (
            a.branch_path_hash === b.branch_path_hash &&
            a.attributes_hash === b.attributes_hash &&
            a.xpath_hash === b.xpath_hash
        );
    }
}
