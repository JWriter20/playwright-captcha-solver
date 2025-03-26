import type { Frame, Page } from 'playwright-core';
import dotenv from 'dotenv';
import type { CaptchaAction } from '../llm-connectors/llm-connector.js';
dotenv.config();

/**
 * Labels a captcha action (click, type, or drag) by injecting overlay elements
 * into the captcha iframe's document.
 *
 * @param frame - The Playwright Frame corresponding to the captcha iframe.
 * @param action - A CaptchaAction object.
 * @param index - A unique numeric index for labeling and color selection.
 * @returns The updated index (index+1).
 */
export async function labelCaptchaActionOnFrame(
    frame: Frame,
    action: CaptchaAction,
    index: number
): Promise<number> {
    return await frame.evaluate(
        ({ action, index }) => {
            // Repeated function, but passing it as an arg is more trouble than it's worth.
            async function getPageCoordinatesFromIframePercentage(
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
            const HIGHLIGHT_CONTAINER_ID = "captcha-highlight-container";

            async function labelCaptchaAction(
                action: CaptchaAction | null,
                index: number
            ): Promise<number> {
                if (!action) return index;
                // Create or get the overlay container.
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

                // Use the frame's viewport dimensions.
                const boundingBox = { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };

                const colors = ["#FF0000", "#0000FF", "#FFA500", "#800080"];
                const baseColor = colors[index % colors.length];
                const backgroundColor = baseColor + "1A"; // 10% opacity

                // If the action is captcha_solved, nothing to label.
                if (action.action === "captcha_solved") {
                    return index;
                }

                if (action.action === "click" || action.action === "type") {
                    const location = action.location;
                    const coords = await getPageCoordinatesFromIframePercentage(
                        boundingBox,
                        parseFloat(location.x),
                        parseFloat(location.y)
                    );
                    if (!coords) return index;
                    const { x: finalX, y: finalY } = coords;
                    // Create circle overlay.
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

                    // Create numeric label. For type actions, show the typed value.
                    const label = document.createElement("div");
                    label.textContent =
                        action.action === "type"
                            ? `${index} (${(action as any).value})`
                            : index.toString();
                    label.style.position = "fixed";
                    label.style.background = baseColor;
                    label.style.color = "white";
                    label.style.padding = "1px 4px";
                    label.style.borderRadius = "4px";
                    label.style.fontSize = "12px";
                    label.style.left = `${finalX + 12}px`;
                    label.style.top = `${finalY - 10}px`;
                    container.appendChild(label);

                    // Update overlay positions on window resize.
                    const updateClickPosition = async () => {
                        const newBoundingBox = { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
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
                    const { x: startX, y: startY } = startCoords;
                    const { x: endX, y: endY } = endCoords;

                    // Create start and end circles.
                    const startCircle = document.createElement("div");
                    startCircle.style.position = "fixed";
                    startCircle.style.width = "20px";
                    startCircle.style.height = "20px";
                    startCircle.style.borderRadius = "50%";
                    startCircle.style.border = `2px solid ${baseColor}`;
                    startCircle.style.backgroundColor = backgroundColor;
                    startCircle.style.left = `${startX - 10}px`;
                    startCircle.style.top = `${startY - 10}px`;
                    container.appendChild(startCircle);

                    const endCircle = document.createElement("div");
                    endCircle.style.position = "fixed";
                    endCircle.style.width = "20px";
                    endCircle.style.height = "20px";
                    endCircle.style.borderRadius = "50%";
                    endCircle.style.border = `2px solid ${baseColor}`;
                    endCircle.style.backgroundColor = backgroundColor;
                    endCircle.style.left = `${endX - 10}px`;
                    endCircle.style.top = `${endY - 10}px`;
                    container.appendChild(endCircle);

                    // Draw an arrow connecting start and end.
                    const dx = endX - startX;
                    const dy = endY - startY;
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    const arrow = document.createElement("div");
                    arrow.style.position = "fixed";
                    arrow.style.height = "2px";
                    arrow.style.backgroundColor = baseColor;
                    arrow.style.width = `${distance}px`;
                    arrow.style.left = `${startX}px`;
                    arrow.style.top = `${startY}px`;
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
                    arrowHead.style.left = `${endX - 5}px`;
                    arrowHead.style.top = `${endY - 10}px`;
                    container.appendChild(arrowHead);

                    // Label at the midpoint.
                    const midX = startX + dx / 2;
                    const midY = startY + dy / 2;
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

                    // Update positions on window resize.
                    const updateDragPosition = async () => {
                        const newBoundingBox = { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
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

            return labelCaptchaAction(action, index);
        },
        { action, index }
    );
}

/**
 * Labels a clickable element inside the captcha iframe by injecting a border overlay and numeric label.
 *
 * @param frame - The Playwright Frame corresponding to the captcha iframe.
 * @param elementSelector - A selector for the clickable element within the frame.
 * @param index - A unique numeric index for labeling.
 * @returns The updated index (index+1).
 */
export async function labelClickableElementOnFrame(
    frame: Frame,
    elementSelector: string,
    index: number
): Promise<number> {
    return await frame.evaluate(
        ({ elementSelector, index }) => {
            const HIGHLIGHT_CONTAINER_ID = "captcha-highlight-container";

            function measureDomOperation(fn: () => DOMRect, opName: string): DOMRect | null {
                try {
                    return fn();
                } catch (e) {
                    console.error(`Error during ${opName}:`, e);
                    return null;
                }
            }

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
            const element = document.querySelector(elementSelector);
            if (!element) return index;
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
            const backgroundColor = baseColor + "1A";
            const overlay = document.createElement("div");
            overlay.style.position = "fixed";
            overlay.style.border = `2px solid ${baseColor}`;
            overlay.style.backgroundColor = backgroundColor;
            overlay.style.pointerEvents = "none";
            overlay.style.boxSizing = "border-box";

            const top = rect.top;
            const left = rect.left;
            overlay.style.top = `${top}px`;
            overlay.style.left = `${left}px`;
            overlay.style.width = `${rect.width}px`;
            overlay.style.height = `${rect.height}px`;

            const label = document.createElement("div");
            label.className = "captcha-clickable-label";
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

            // Update positions on scroll/resize.
            const updatePositions = () => {
                const newRect = element.getBoundingClientRect();
                const newTop = newRect.top;
                const newLeft = newRect.left;
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
        },
        { elementSelector, index }
    );
}

/**
 * Removes all captcha overlay highlights from the captcha iframe.
 *
 * @param frame - The Playwright Frame corresponding to the captcha iframe.
 */
export async function removeHighlightsOnFrame(frame: Frame): Promise<void> {
    await frame.evaluate(() => {
        const container = document.getElementById("captcha-highlight-container");
        if (container) container.remove();
    });
}
