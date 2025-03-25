import { getPageCoordinatesFromIframePercentage } from "../find-captcha/get-active-captchas.js";
import { LLMModels, ModelFactory } from "../llm-connectors/model-factory.js";
import { createCursor, type GhostCursor } from "@jwriter20/ghost-cursor-patchright-core";
import { CaptchaActionState, LLMConnector } from "../llm-connectors/llm-connector.js";
import type { CaptchaAction } from "../llm-connectors/llm-connector.js";
import type { BrowserContext, Frame, Page } from "playwright-core";

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
    if (!this.currentState?.captchaScreenshot || !this.currentState?.captchaElem) {
        console.log("No captcha detected to solve");
        return;
    }

    const llmClient: LLMConnector = ModelFactory.getLLMConnector(model);
    if (!cursor) {
        cursor = createCursor(page);
    }

    let isSolved = false;
    let attempts = 0;
    const maxAttempts = 5;

    while (!isSolved && attempts < maxAttempts) {
        attempts++;
        console.log(`Captcha solving attempt ${attempts}/${maxAttempts}`);

        // If no pending actions are queued, get one from the LLM and push it.
        if (!this.currentState.pendingActions || this.currentState.pendingActions.length === 0) {
            const newAction: CaptchaAction = await llmClient.getCaptchaAction(
                this.currentState.captchaScreenshot,
                this.currentState.pastActions
            );
            // If the action isn't already solved, mark it for adjustment.
            if (newAction.action !== "captcha_solved") {
                newAction.actionState = CaptchaActionState.AdjustAction;
            }
            this.queueCaptchaAction(newAction);
        }

        // Get the next action from pending actions by popping it.
        const pendingAction = this.currentState.pendingActions.shift();
        if (!pendingAction) {
            console.log("No pending action available");
            break;
        }

        // Process the pending action based on its state.
        if (pendingAction.action === "captcha_solved") {
            isSolved = true;
            console.log("Captcha reported as solved");
            break;
        } else if (pendingAction.actionState === "creatingAction") {
            // In case we somehow encounter a creatingAction state,
            // fetch a fresh action and queue it.
            console.log("Encountered creatingAction, re-queueing action");
            const newAction: CaptchaAction = await llmClient.getCaptchaAction(
                this.currentState.captchaScreenshot,
                this.currentState.pastActions
            );
            if (newAction.action !== "captcha_solved") {
                newAction.actionState = CaptchaActionState.AdjustAction;
            }
            this.queueCaptchaAction(newAction);
        } else if (pendingAction.actionState === "actionConfirmed") {
            console.log(`Executing captcha action: ${pendingAction.action}`);
            // Execute the action.
            // await this._handleCaptchaAction(page, frameWithCaptcha, pendingAction, cursor);
            // Record the action as done.
            this.currentState.pastActions.push(pendingAction);
            // Clear any leftover pending actions.
            this.currentState.pendingActions = [];
            // Optionally fetch a new action and queue it.
            const newAction: CaptchaAction = await llmClient.getCaptchaAction(
                this.currentState.captchaScreenshot,
                this.currentState.pastActions
            );
            this.queueCaptchaAction(newAction);
        } else if (pendingAction.actionState === "adjustAction") {
            // Adjust the action: use the pending action itself, get the corrected version and requeue.
            const correctedAction: CaptchaAction = await llmClient.adjustCaptchaActions(
                this.currentState.captchaScreenshot,
                pendingAction,
                this.currentState.pastActions
            );
            this.queueCaptchaAction(correctedAction);
            console.log(`Corrected action -- old: ${JSON.stringify(pendingAction)} new: ${JSON.stringify(correctedAction)}`);
            // Allow time for any UI transitions.
            await page.waitForTimeout(500);
        }

        // If captcha is no longer detected, consider it solved.
        if (!this.currentState.captchaScreenshot) {
            console.log("Captcha no longer detected, might be solved");
            isSolved = true;
            break;
        }

        // Wait a bit between attempts.
        await page.waitForTimeout(1000);
    }

    if (attempts >= maxAttempts && !isSolved) {
        console.warn("Failed to solve captcha after maximum attempts");
    } else if (isSolved) {
        console.log("Captcha successfully solved");
    }
}

export async function _handleCaptchaAction(page: Page, captchaFrame: Frame, action: CaptchaAction, cursor: GhostCursor): Promise<void> {
    if (action.action === "captcha_solved") {
        console.log("Captcha already solved");
        return;
    } else if (action.actionState !== "actionConfirmed") {
        console.log("Captcha action not confirmed, must be confirmed before proceeding");
        return;
    } else if (this.currentState.captchaElem === null) {
        console.log("No captcha element found");
        return;

    } else {
        // Get real locations on the page: 
        const captchaCoordinates = this.currentState.captchaElem.page_coordinates;
        const captchaBoundingBox = {
            x: captchaCoordinates.top_left.x,
            y: captchaCoordinates.top_left.y,
            width: captchaCoordinates.width,
            height: captchaCoordinates.height
        }

        async function getElementAtPoint(frame: Frame, x: number, y: number) {
            const elementHandle = await frame.evaluateHandle(
                ({ x, y }) => {
                    const el = document.elementFromPoint(x - window.pageXOffset, y - window.pageYOffset) as HTMLElement;
                    if (el) {
                        // Highlight the element by adding a red outline
                        el.style.outline = '2px solid red';
                    }
                    return el;
                },
                { x, y }
            );

            return elementHandle.asElement();
        }

        switch (action.action) {
            case "click":
            case "type":
                let clickCoordinates = await getPageCoordinatesFromIframePercentage(captchaBoundingBox, parseInt(action.location.x), parseInt(action.location.y));
                if (!clickCoordinates) {
                    console.error("Failed to get click coordinates");
                    return;
                }
                await cursor.moveTo(clickCoordinates);
                const elem = await getElementAtPoint(captchaFrame, clickCoordinates.x, clickCoordinates.y);
                if (!elem) {
                    await page.mouse.click(clickCoordinates.x, clickCoordinates.y);
                } else {
                    await elem.click();
                }
                if (action.action === "type") {
                    await page.keyboard.type(action.value);
                }
                break;
            case "drag":
                let startCoords = await getPageCoordinatesFromIframePercentage(captchaBoundingBox, parseInt(action.startLocation.x), parseInt(action.startLocation.y));
                let endCoords = await getPageCoordinatesFromIframePercentage(captchaBoundingBox, parseInt(action.endLocation.x), parseInt(action.endLocation.y));
                if (!startCoords || !endCoords) {
                    console.error("Failed to get drag coordinates");
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
}
