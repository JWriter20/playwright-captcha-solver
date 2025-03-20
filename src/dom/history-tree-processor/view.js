// view.ts
/**
 * Represents a history element extracted from the DOM.
 */
export class DOMHistoryElement {
    tagName;
    xpath;
    highlightIndex;
    entire_parent_branch_path;
    attributes;
    shadow_root;
    css_selector;
    page_coordinates;
    viewport_coordinates;
    viewport_info;
    constructor(options) {
        this.tagName = options.tagName;
        this.xpath = options.xpath;
        this.highlightIndex = options.highlightIndex;
        this.entire_parent_branch_path = options.entire_parent_branch_path;
        this.attributes = options.attributes;
        this.shadow_root = options.shadow_root ?? false;
        this.css_selector = options.css_selector;
        this.page_coordinates = options.page_coordinates;
        this.viewport_coordinates = options.viewport_coordinates;
        this.viewport_info = options.viewport_info;
    }
    /**
     * Returns a plain object representation of this DOM history element.
     */
    toDict() {
        return {
            tagName: this.tagName,
            xpath: this.xpath,
            highlightIndex: this.highlightIndex,
            entire_parent_branch_path: this.entire_parent_branch_path,
            attributes: this.attributes,
            shadow_root: this.shadow_root,
            css_selector: this.css_selector,
            // In this conversion the coordinate objects are already plain objects.
            page_coordinates: this.page_coordinates,
            viewport_coordinates: this.viewport_coordinates,
            viewport_info: this.viewport_info,
        };
    }
}
