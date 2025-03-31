import { getNewCaptchaFrames, getPageCoordinatesFromIframePercentage, screenshotCaptcha, waitForCaptchaIframes } from "../find-captcha/get-active-captchas.js";
import type { CaptchaDetectionResult } from "../find-captcha/get-active-captchas.js";
import { LLMModels, ModelFactory } from "../llm-connectors/model-factory.js";
import { createCursor, getRandomPagePoint, type GhostCursor } from "@jwriter20/ghost-cursor-patchright-core";
import { CaptchaActionState, CaptchaActionTypes, LLMConnector } from "../llm-connectors/llm-connector.js";
import type { CaptchaAction, CaptchaClickAction, CaptchaDragAction, CaptchaMultiClickAction, CaptchaTypeAction } from "../llm-connectors/llm-connector.js";
import type { BrowserContext, Frame, Page } from "patchright";
import { labelCaptchaActionOnFrame, removeHighlightsOnFrame } from "../dom/highlighter.js";

export async function wrapContextToForceOpenShadowRoots(context: BrowserContext): Promise<BrowserContext> {
    await context.addInitScript({
        content: `
            // Force open shadow roots
            (function () {
                const originalAttachShadow = Element.prototype.attachShadow;
                Element.prototype.attachShadow = function attachShadow(options) {
                    return originalAttachShadow.call(this, { ...options, mode: "open" });
                };
            })();
        `
    });
    return context;
}

export async function solveCaptchas(page: Page, model: LLMModels = LLMModels.GEMINI, cursor?: GhostCursor): Promise<void> {
    // Get Captchas on the page
    let captchaFrames = await waitForCaptchaIframes(page);
    if (captchaFrames.length === 0) {
        console.log("No captcha found");
        return;
    }

    if (captchaFrames.length > 1) {
        console.warn("Multiple captchas found, only solving the first one");
    }

    let captchaFrameData: CaptchaDetectionResult = captchaFrames[0];
    let contentFrame: Frame = null;
    let captchaScreenshot = await screenshotCaptcha(page, captchaFrameData.frame);
    let pendingAction: CaptchaAction = null;
    let pastActions: CaptchaAction[] = [];

    const llmClient: LLMConnector = ModelFactory.getLLMConnector(model);
    if (!cursor) {
        // @ts-ignore
        const randomStartLocation = await getRandomPagePoint(page);
        // @ts-ignore
        cursor = createCursor(page, randomStartLocation);
    }

    let isSolved = false;
    let attempts = 0;
    const maxAttempts = 25;

    while (!isSolved && attempts < maxAttempts) {
        attempts++;
        console.log(`Captcha solving attempt ${attempts}/${maxAttempts}`);

        // The action state is from the last action, so we handle accordingly here.
        if (!pendingAction) {
            pendingAction = await llmClient.getCaptchaAction(
                captchaScreenshot,
                pastActions
            );
        } else if (pendingAction.action === "captcha_solved") {
            isSolved = true;
            console.log("Captcha reported as solved");
            break;
        } else if (pendingAction.actionState === "creatingAction" || pendingAction.actionState === "adjustAction") {
            const previousAction = pendingAction;
            // Action was just created, now to confirm or adjust it
            pendingAction = await llmClient.adjustCaptchaActions(
                captchaScreenshot,
                pendingAction,
                pastActions
            );
            if (pendingAction.action !== CaptchaActionTypes.CaptchaSolved && pendingAction.actionState === "actionConfirmed") {
                // If confirming, ensure old values are kept and set to confirm
                pendingAction = {
                    ...previousAction,
                    actionState: "actionConfirmed",
                };

            }
        } else if (pendingAction.actionState === "actionConfirmed") {
            console.log(`Executing captcha action: ${pendingAction.action}`);
            // Execute the action.
            await handleCaptchaAction(
                page,
                contentFrame,
                await captchaFrameData.frame.boundingBox(),
                pendingAction,
                cursor
            );

            // wait for any new captchas
            await page.waitForTimeout(200);
            // Get any new frames and then decide what to do next

            // Record the action as done.
            pastActions.push(pendingAction);
            pendingAction = null;
        }

        // Check if any new captchas have appeared
        const newCaptchaFrames = await waitForCaptchaIframes(page);
        if (newCaptchaFrames.length !== captchaFrames.length) {
            console.log("New captcha frame detected, restarting captcha solving");
            // Get new frame:
            captchaFrameData = (await getNewCaptchaFrames(captchaFrames, newCaptchaFrames))[0];
            captchaFrames = newCaptchaFrames;
            contentFrame = null;
            pendingAction = null;
            pastActions = [];
            isSolved = false;
            attempts = 0;
        }

        // Update the screenshot, highlight overlay 
        await removeHighlightsOnFrame(contentFrame);
        await labelCaptchaActionOnFrame(contentFrame, pendingAction, 1);

        captchaScreenshot = await screenshotCaptcha(page, captchaFrameData.frame);

        // Wait a bit between attempts.
        await page.waitForTimeout(1000);
    }

    if (attempts >= maxAttempts && !isSolved) {
        console.warn("Failed to solve captcha after maximum attempts");
    } else if (isSolved) {
        console.log("Captcha successfully solved");
    }
}

async function handleClick(
    page: Page,
    frame: Frame,
    boundingBox: { x: number; y: number; width: number; height: number },
    location: { x: string; y: string },
    cursor: GhostCursor
): Promise<void> {
    const clickCoordinates = await getPageCoordinatesFromIframePercentage(
        boundingBox,
        parseInt(location.x),
        parseInt(location.y)
    );
    if (!clickCoordinates) {
        console.error("Failed to get click coordinates");
        return;
    }
    await cursor.moveTo(clickCoordinates);

    // Convert page coordinates to local iframe coordinates
    const localX = clickCoordinates.x - boundingBox.x;
    const localY = clickCoordinates.y - boundingBox.y;

    const elem = await getElementAtPoint(frame, localX, localY);
    if (elem) {
        try {
            await elem.click();
        } catch (error) {
            console.log("Element click failed, falling back to coordinate click:", error);
            await page.mouse.click(clickCoordinates.x, clickCoordinates.y);
        }
    } else {
        await page.mouse.click(clickCoordinates.x, clickCoordinates.y);
    }
}

export async function handleCaptchaAction(
    page: Page,
    captchaFrame: Frame,
    boundingBox: { x: number; y: number; width: number; height: number },
    action: CaptchaAction,
    cursor: GhostCursor
): Promise<void> {
    if (action.action === "captcha_solved") {
        console.log("Captcha already solved");
        return;
    } else if (action.actionState !== "actionConfirmed") {
        console.log("Captcha action not confirmed, must be confirmed before proceeding");
        return;
    }

    switch (action.action) {
        case "click":
        case "type":
            await handleClick(page, captchaFrame, boundingBox, (action as CaptchaClickAction).location, cursor);
            if (action.action === "type") {
                await page.keyboard.type(action.value);
            }
            break;

        case "multiClick":
            const locations = (action as CaptchaMultiClickAction).locations;
            for (const location of locations) {
                await handleClick(page, captchaFrame, boundingBox, location, cursor);
            }
            break;
        case "drag":
            const startCoords = await getPageCoordinatesFromIframePercentage(
                boundingBox,
                parseInt(action.startLocation.x),
                parseInt(action.startLocation.y)
            );
            const endCoords = await getPageCoordinatesFromIframePercentage(
                boundingBox,
                parseInt(action.endLocation.x),
                parseInt(action.endLocation.y)
            );
            if (!startCoords || !endCoords) {
                console.error("Failed to get drag coordinates");
                return;
            }
            await cursor.moveTo(startCoords);
            await page.mouse.down();
            await cursor.moveTo(endCoords);
            await page.mouse.up();
            break;

        default:
            console.error("Invalid captcha action");
            break;
    }
}

async function getElementAtPoint(frame: Frame, x: number, y: number) {
    const elementHandle = await frame.evaluateHandle(
        ({ x, y }) => {
            // Find the element at the specified coordinates
            let el = document.elementFromPoint(x, y) as HTMLElement;

            // Try to find the nearest clickable element
            if (el) {
                // Check if the element itself is clickable
                const isClickable = el.tagName === 'BUTTON' ||
                    el.tagName === 'A' ||
                    el.hasAttribute('onclick') ||
                    el.style.cursor === 'pointer' ||
                    el.getAttribute('role') === 'button';

                if (!isClickable) {
                    // Search up the DOM tree for a clickable parent
                    let parent = el.parentElement;
                    while (parent) {
                        const parentIsClickable = parent.tagName === 'BUTTON' ||
                            parent.tagName === 'A' ||
                            parent.hasAttribute('onclick') ||
                            parent.style.cursor === 'pointer' ||
                            parent.getAttribute('role') === 'button';
                        if (parentIsClickable) {
                            el = parent;
                            break;
                        }
                        parent = parent.parentElement;
                    }
                }

                // Check if the highlight container exists; create it if not
                let container = document.getElementById('captcha-highlight-container');
                if (!container) {
                    container = document.createElement('div');
                    container.id = 'captcha-highlight-container';
                    container.style.position = 'fixed';
                    container.style.top = '0';
                    container.style.left = '0';
                    container.style.width = '100%';
                    container.style.height = '100%';
                    container.style.pointerEvents = 'none';
                    container.style.zIndex = '9999';
                    document.body.appendChild(container);
                }

                // Get the element's position and dimensions
                const rect = el.getBoundingClientRect();

                // Create an overlay element
                const overlay = document.createElement('div');
                overlay.style.position = 'absolute';
                overlay.style.top = `${rect.top}px`;
                overlay.style.left = `${rect.left}px`;
                overlay.style.width = `${rect.width}px`;
                overlay.style.height = `${rect.height}px`;
                overlay.style.border = '2px solid red';
                overlay.style.pointerEvents = 'none';

                // Append the overlay to the container
                container.appendChild(overlay);
            }
            return el;
        },
        { x, y }
    );
    return elementHandle.asElement();
}