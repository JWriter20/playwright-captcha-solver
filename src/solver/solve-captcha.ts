import { CaptchaDetectionResult, getPageCoordinatesFromIframePercentage, screenshotCaptcha, waitForCaptchaIframes } from "../find-captcha/get-active-captchas.js";
import { LLMModels, ModelFactory } from "../llm-connectors/model-factory.js";
import { createCursor, getRandomPagePoint, type GhostCursor } from "@jwriter20/ghost-cursor-patchright-core";
import { CaptchaActionState, LLMConnector } from "../llm-connectors/llm-connector.js";
import type { CaptchaAction } from "../llm-connectors/llm-connector.js";
import type { BrowserContext, Frame, Page } from "playwright-core";
import { labelCaptchaActionOnFrame, removeHighlightsOnFrame } from "../dom/highlighter.js";

export async function wrapContextToForceOpenShadowRoots(context: BrowserContext): Promise<BrowserContext> {
    await context.addInitScript({
        content: `
            // Webdriver property
            Object.defineProperty(navigator, 'webdriver', {
                get: () => undefined
            });

            // Languages
            Object.defineProperty(navigator, 'languages', {
                get: () => ['en-US']
            });

            // Plugins
            Object.defineProperty(navigator, 'plugins', {
                get: () => [1, 2, 3, 4, 5]
            });

            // Chrome runtime
            window.chrome = { runtime: {} };

            // Permissions
            const originalQuery = window.navigator.permissions.query;
            window.navigator.permissions.query = (parameters) => (
                parameters.name === 'notifications' ?
                    Promise.resolve({ state: Notification.permission }) :
                    originalQuery(parameters)
            );

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

export async function solveCaptcha(page: Page, model: LLMModels = LLMModels.GEMINI, cursor?: GhostCursor): Promise<void> {
    // Get Captchas on the page
    const captchaFrames = await waitForCaptchaIframes(page);
    if (captchaFrames.length === 0) {
        console.log("No captcha found");
        return;
    }

    if (captchaFrames.length > 1) {
        console.warn("Multiple captchas found, only solving the first one");
    }

    let captchaFrameData: CaptchaDetectionResult = captchaFrames[0];
    let contentFrame: Frame = await captchaFrameData.frame.contentFrame();
    let captchaScreenshot = await screenshotCaptcha(page, captchaFrameData.frame);
    let pendingAction: CaptchaAction = null;
    let pastActions: CaptchaAction[] = [];

    const llmClient: LLMConnector = ModelFactory.getLLMConnector(model);
    if (!cursor) {
        const randomStartLocation = await getRandomPagePoint(page);
        cursor = createCursor(page, randomStartLocation);
    }

    let isSolved = false;
    let attempts = 0;
    const maxAttempts = 5;

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
            // Action was just created, now to confirm or adjust it
            pendingAction = await llmClient.adjustCaptchaActions(
                captchaScreenshot,
                pendingAction,
                pastActions
            );
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
            // Record the action as done.
            pastActions.push(pendingAction);
            pendingAction = null;
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
            const clickCoordinates = await getPageCoordinatesFromIframePercentage(
                boundingBox,
                parseInt(action.location.x),
                parseInt(action.location.y)
            );
            if (!clickCoordinates) {
                console.error("Failed to get click coordinates");
                return;
            }
            await cursor.moveTo(clickCoordinates);

            // Convert page coordinates to local iframe coordinates
            const localX = clickCoordinates.x - boundingBox.x;
            const localY = clickCoordinates.y - boundingBox.y;

            const elem = await getElementAtPoint(captchaFrame, localX, localY);
            if (elem) {
                await elem.click();
            } else {
                await page.mouse.click(clickCoordinates.x, clickCoordinates.y);
            }
            if (action.action === "type") {
                await page.keyboard.type(action.value);
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
            const el = document.elementFromPoint(x, y) as HTMLElement;
            if (el) {
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
                    container.style.pointerEvents = 'none'; // Prevent interference with interactions
                    container.style.zIndex = '9999'; // Ensure it appears on top
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
                overlay.style.border = '2px solid red'; // Visual highlight
                overlay.style.pointerEvents = 'none'; // Ensure it doesn’t block interactions

                // Append the overlay to the container
                container.appendChild(overlay);
            }
            // Return the element for further use
            return el;
        },
        { x, y }
    );
    return elementHandle.asElement();
}
