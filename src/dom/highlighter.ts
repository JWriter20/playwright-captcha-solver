import type { Frame, Page, Locator } from "patchright"; // Note: Changed from "patchright" to "playwright" assuming a typo
import dotenv from 'dotenv';
import type { CaptchaAction } from '../llm-connectors/llm-connector.js';
dotenv.config();

const HIGHLIGHT_CONTAINER_ID = "captcha-highlight-container";

/**
 * Ensures the highlight container exists on the main page.
 * @param page - The Playwright Page object.
 */
async function ensureHighlightContainer(page: Page): Promise<void> {
    await page.evaluate((containerId) => {
        let container = document.getElementById(containerId);
        if (!container) {
            container = document.createElement("div");
            container.id = containerId;
            container.style.position = "fixed";
            container.style.pointerEvents = "none";
            container.style.top = "0";
            container.style.left = "0";
            container.style.width = "100%";
            container.style.height = "100%";
            container.style.zIndex = "2147483647";
            document.body.appendChild(container);
        }
    }, HIGHLIGHT_CONTAINER_ID);
}

/**
 * Retrieves the bounding box of the iframe on the main page.
 * @param page - The Playwright Page object.
 * @param frame - The Playwright Frame object corresponding to the iframe.
 * @returns The bounding box { x, y, width, height } or null if unavailable.
 */
async function getFramePosition(page: Page, frame: Frame): Promise<{ x: number, y: number, width: number, height: number } | null> {
    const frameElement = await frame.frameElement();
    if (!frameElement) return null;
    const box = await frameElement.boundingBox();
    return box;
}

/**
 * Labels a captcha action (click, type, or drag) by injecting overlay elements into the main page.
 * @param frame - The Playwright Frame corresponding to the captcha iframe.
 * @param action - A CaptchaAction object specifying the action to label.
 * @param index - A unique numeric index for labeling and color selection.
 * @param page - The Playwright Page to attach the overlay to (defaults to frame's page).
 * @returns The updated index (index + 1).
 */
export async function labelCaptchaActionOnFrame(
    frame: Frame,
    action: CaptchaAction,
    index: number,
    page: Page = frame.page()
): Promise<number> {
    // Ensure the highlight container exists on the main page
    await ensureHighlightContainer(page);

    // Get the iframe's position and dimensions relative to the main page
    const frameBox = await getFramePosition(page, frame);
    if (!frameBox) return index; // Return early if frame position cannot be determined

    return await page.evaluate(
        ({ action, index, frameBox }) => {
            const container = document.getElementById("captcha-highlight-container");
            if (!container) return index;

            /**
             * Converts percentage coordinates within the iframe to absolute page coordinates.
             * @param iframeBox - The iframe's bounding box on the page.
             * @param xPercentage - X position as a percentage of iframe width.
             * @param yPercentage - Y position as a percentage of iframe height.
             * @returns Absolute { x, y } coordinates on the page or null on error.
             */
            function getPageCoordinatesFromIframePercentage(
                iframeBox: { x: number, y: number, width: number, height: number },
                xPercentage: number,
                yPercentage: number
            ): { x: number, y: number } | null {
                try {
                    const xDecimal = xPercentage / 100;
                    const yDecimal = yPercentage / 100;
                    const pageX = iframeBox.x + (iframeBox.width * xDecimal);
                    const pageY = iframeBox.y + (iframeBox.height * yDecimal);
                    return { x: pageX, y: pageY };
                } catch (error) {
                    console.error('Error calculating page coordinates:', error);
                    return null;
                }
            }

            if (!action || action.action === "captcha_solved") {
                return index; // No labeling needed for solved captchas
            }

            const colors = ["#FF0000", "#0000FF", "#FFA500", "#800080"];
            const baseColor = colors[index % colors.length];
            const backgroundColor = baseColor + "1A"; // 10% opacity

            if (action.action === "click" || action.action === "type") {
                const location = action.location;
                const coords = getPageCoordinatesFromIframePercentage(
                    frameBox,
                    parseFloat(location.x),
                    parseFloat(location.y)
                );
                if (!coords) return index;

                // Create circle overlay
                const circle = document.createElement("div");
                circle.style.position = "fixed";
                circle.style.width = "20px";
                circle.style.height = "20px";
                circle.style.borderRadius = "50%";
                circle.style.border = `2px solid ${baseColor}`;
                circle.style.backgroundColor = backgroundColor;
                circle.style.left = `${coords.x - 10}px`;
                circle.style.top = `${coords.y - 10}px`;
                container.appendChild(circle);

                // Create label
                const label = document.createElement("div");
                label.textContent = action.action === "type"
                    ? `${index} (${(action as any).value})`
                    : index.toString();
                label.style.position = "fixed";
                label.style.background = baseColor;
                label.style.color = "white";
                label.style.padding = "1px 4px";
                label.style.borderRadius = "4px";
                label.style.fontSize = "12px";
                label.style.left = `${coords.x + 12}px`;
                label.style.top = `${coords.y - 10}px`;
                container.appendChild(label);
            } else if (action.action === "drag") {
                const startCoords = getPageCoordinatesFromIframePercentage(
                    frameBox,
                    parseFloat(action.startLocation.x),
                    parseFloat(action.startLocation.y)
                );
                const endCoords = getPageCoordinatesFromIframePercentage(
                    frameBox,
                    parseFloat(action.endLocation.x),
                    parseFloat(action.endLocation.y)
                );
                if (!startCoords || !endCoords) return index;

                // Create start circle
                const startCircle = document.createElement("div");
                startCircle.style.position = "fixed";
                startCircle.style.width = "20px";
                startCircle.style.height = "20px";
                startCircle.style.borderRadius = "50%";
                startCircle.style.border = `2px solid ${baseColor}`;
                startCircle.style.backgroundColor = backgroundColor;
                startCircle.style.left = `${startCoords.x - 10}px`;
                startCircle.style.top = `${startCoords.y - 10}px`;
                container.appendChild(startCircle);

                // Create end circle
                const endCircle = document.createElement("div");
                endCircle.style.position = "fixed";
                endCircle.style.width = "20px";
                endCircle.style.height = "20px";
                endCircle.style.borderRadius = "50%";
                endCircle.style.border = `2px solid ${baseColor}`;
                endCircle.style.backgroundColor = backgroundColor;
                endCircle.style.left = `${endCoords.x - 10}px`;
                endCircle.style.top = `${endCoords.y - 10}px`;
                container.appendChild(endCircle);

                // Draw arrow
                const dx = endCoords.x - startCoords.x;
                const dy = endCoords.y - startCoords.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                const arrow = document.createElement("div");
                arrow.style.position = "fixed";
                arrow.style.height = "2px";
                arrow.style.backgroundColor = baseColor;
                arrow.style.width = `${distance}px`;
                arrow.style.left = `${startCoords.x}px`;
                arrow.style.top = `${startCoords.y}px`;
                arrow.style.transform = `rotate(${Math.atan2(dy, dx) * (180 / Math.PI)}deg)`;
                arrow.style.transformOrigin = "0 50%";
                container.appendChild(arrow);

                // Create arrowhead
                const arrowHead = document.createElement("div");
                arrowHead.style.position = "fixed";
                arrowHead.style.width = "0";
                arrowHead.style.height = "0";
                arrowHead.style.borderLeft = "5px solid transparent";
                arrowHead.style.borderRight = "5px solid transparent";
                arrowHead.style.borderTop = `10px solid ${baseColor}`;
                arrowHead.style.left = `${endCoords.x - 5}px`;
                arrowHead.style.top = `${endCoords.y - 10}px`;
                container.appendChild(arrowHead);

                // Add label at midpoint
                const midX = startCoords.x + dx / 2;
                const midY = startCoords.y + dy / 2;
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
            }

            return index + 1;
        },
        { action, index, frameBox }
    );
}

/**
 * Removes all captcha overlay highlights from the main page.
 * @param page - The Playwright Page containing the overlays.
 */
export async function removeHighlights(page: Page): Promise<void> {
    await page.evaluate(() => {
        const container = document.getElementById("captcha-highlight-container");
        if (container) container.remove();
    });
}
