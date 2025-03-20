// view.ts

/**
 * Hash of the DOM element used as a unique identifier.
 */
export interface HashedDomElement {
    branch_path_hash: string;
    attributes_hash: string;
    xpath_hash: string;
    // Optionally add text_hash if needed.
    // text_hash?: string;
}

/**
 * A simple coordinate with x and y positions.
 */
export interface Coordinates {
    x: number;
    y: number;
}

/**
 * Set of coordinates describing the corners, center, and dimensions.
 */
export interface CoordinateSet {
    top_left: Coordinates;
    top_right: Coordinates;
    bottom_left: Coordinates;
    bottom_right: Coordinates;
    center: Coordinates;
    width: number;
    height: number;
}

/**
 * Information about the viewport.
 */
export interface ViewportInfo {
    width: number;
    height: number;
    scroll_x?: number;
    scroll_y?: number;
}

/**
 * Represents a history element extracted from the DOM.
 */
export class DOMHistoryElement {
    tagName: string;
    xpath: string;
    highlightIndex?: number;
    entire_parent_branch_path: string[];
    attributes: { [key: string]: string };
    shadow_root: boolean;
    css_selector?: string;
    page_coordinates?: CoordinateSet;
    viewport_coordinates?: CoordinateSet;
    viewport_info?: ViewportInfo;

    constructor(options: {
        tagName: string;
        xpath: string;
        highlightIndex?: number;
        entire_parent_branch_path: string[];
        attributes: { [key: string]: string };
        shadow_root?: boolean;
        css_selector?: string;
        page_coordinates?: CoordinateSet;
        viewport_coordinates?: CoordinateSet;
        viewport_info?: ViewportInfo;
    }) {
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
    toDict(): Record<string, any> {
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
