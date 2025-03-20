
import { DOMElementNode } from "../dom/views.js";

export class CssSelectorHelper {
    /**
     * Creates a CSS selector for a DOM element, handling various edge cases and special characters.
     *
     * @param element - The DOM element to create a selector for.
     * @param includeDynamicAttributes - Whether to include dynamic attributes (default: true).
     * @returns A valid CSS selector string.
     */
    public static enhancedCssSelectorForElement(
        element: DOMElementNode,
        includeDynamicAttributes: boolean = true
    ): string {
        try {
            // Get base selector from XPath.
            let cssSelector = this.convertSimpleXpathToCssSelector(element.xpath);

            // Handle class attributes.
            if (element.attributes["class"] && includeDynamicAttributes) {
                const validClassNamePattern = /^[a-zA-Z_][a-zA-Z0-9_-]*$/;
                const classes = element.attributes["class"].split(/\s+/);
                for (const className of classes) {
                    if (!className.trim()) continue;
                    if (validClassNamePattern.test(className)) {
                        cssSelector += `.${className}`;
                    }
                }
            }

            // Expanded set of safe attributes that are stable and useful for selection.
            const SAFE_ATTRIBUTES = new Set([
                "id",
                "name",
                "type",
                "placeholder",
                "aria-label",
                "aria-labelledby",
                "aria-describedby",
                "role",
                "for",
                "autocomplete",
                "required",
                "readonly",
                "alt",
                "title",
                "src",
                "href",
                "target",
            ]);

            if (includeDynamicAttributes) {
                const dynamicAttributes = [
                    "data-id",
                    "data-qa",
                    "data-cy",
                    "data-testid",
                ];
                dynamicAttributes.forEach((attr) => SAFE_ATTRIBUTES.add(attr));
            }

            // Handle other attributes.
            for (const [attribute, value] of Object.entries(element.attributes)) {
                if (attribute === "class") continue;
                if (!attribute.trim()) continue;
                if (!SAFE_ATTRIBUTES.has(attribute)) continue;

                // Escape special characters in attribute names.
                const safeAttribute = attribute.replace(/:/g, "\\:");

                if (value === "") {
                    cssSelector += `[${safeAttribute}]`;
                } else if (/[\"'<>`\n\r\t]/.test(value)) {
                    // Collapse whitespace and escape embedded double-quotes.
                    const collapsedValue = value.replace(/\s+/g, " ").trim();
                    const safeValue = collapsedValue.replace(/"/g, '\\"');
                    cssSelector += `[${safeAttribute}*="${safeValue}"]`;
                } else {
                    cssSelector += `[${safeAttribute}="${value}"]`;
                }
            }

            return cssSelector;
        } catch (error) {
            // Fallback to a basic selector.
            const tagName = element.tagName || "*";
            return `${tagName}[highlightIndex='${element.highlightIndex}']`;
        }
    }

    /**
     * Converts simple XPath expressions to CSS selectors.
     *
     * @param xpath - The XPath expression.
     * @returns The equivalent CSS selector.
     */
    public static convertSimpleXpathToCssSelector(xpath: string): string {
        if (!xpath) {
            return "";
        }

        // Remove leading slashes.
        xpath = xpath.replace(/^\/+/, "");
        const parts = xpath.split("/");
        const cssParts: string[] = [];

        for (let part of parts) {
            if (!part) continue;

            // Handle custom elements with colons by escaping them if no index notation.
            if (part.includes(":") && !part.includes("[")) {
                cssParts.push(part.replace(/:/g, "\\:"));
                continue;
            }

            // Handle index notation [n].
            if (part.includes("[")) {
                let basePart = part.substring(0, part.indexOf("["));
                if (basePart.includes(":")) {
                    basePart = basePart.replace(/:/g, "\\:");
                }
                const indexPart = part.substring(part.indexOf("["));
                // Split and remove any empty entries.
                const indices = indexPart
                    .split("]")
                    .filter((i) => i)
                    .map((i) => i.replace(/^\[/, "").trim());

                for (const idx of indices) {
                    try {
                        if (/^\d+$/.test(idx)) {
                            // Numeric indices are 1-based in CSS.
                            basePart += `:nth-of-type(${parseInt(idx, 10)})`;
                        } else if (idx === "last()") {
                            basePart += ":last-of-type";
                        } else if (idx.includes("position()")) {
                            if (idx.includes(">1")) {
                                basePart += ":nth-of-type(n+2)";
                            }
                        }
                    } catch (e) {
                        continue;
                    }
                }
                cssParts.push(basePart);
            } else {
                cssParts.push(part);
            }
        }

        return cssParts.join(" > ");
    }
}
