import { test, expect, chromium } from '@playwright/test';
import { recaptchaImage, recaptchaThatNeedsAdjusting, recaptchaThatShouldBeConfirmed } from './images.js';
import { GeminiConnector } from '../../src/llm-connectors/impl/gemini.js';
import { CaptchaActionState, CaptchaActionTypes } from '../../src/llm-connectors/llm-connector.js';
import type { CaptchaAction, CaptchaClickAction } from '../../src/llm-connectors/llm-connector.js';

test.describe('Captcha Detection Tests with Custom Wrapper', () => {

    const llmConnector = new GeminiConnector();
    const LOCATION_MARGIN_OF_ERROR = 5;

    test.skip('Should correctly get a location around where should be clicked', async () => {
        const action = await llmConnector.getCaptchaAction(recaptchaImage);
        expect(action.action).toBe('click');
        expect((action as CaptchaClickAction).actionState).toBe('creatingAction');

        const newLocationStrings = (action as CaptchaClickAction).location;
        const location = { x: parseInt(newLocationStrings.x), y: parseInt(newLocationStrings.y) };
        const expectedLocation = { x: 10, y: 50 };
        expect(location).toBeDefined();
        expect(location.x).toBeGreaterThanOrEqual(expectedLocation.x - LOCATION_MARGIN_OF_ERROR);
        expect(location.x).toBeLessThanOrEqual(expectedLocation.x + LOCATION_MARGIN_OF_ERROR);
        expect(location.y).toBeGreaterThanOrEqual(expectedLocation.y - LOCATION_MARGIN_OF_ERROR);
        expect(location.y).toBeLessThanOrEqual(expectedLocation.y + LOCATION_MARGIN_OF_ERROR);
    });

    test.skip('Should correctly adjust an incorrect location', async () => {
        const previosIncorrectAction: CaptchaAction = {
            action: CaptchaActionTypes.Click,
            location: {
                x: "28%",
                y: "53%"
            },
            actionState: CaptchaActionState.CreatingAction,
        };
        const action = await llmConnector.adjustCaptchaActions(recaptchaThatNeedsAdjusting, previosIncorrectAction, []);
        expect(action.action).toBe('click');
        expect((action as CaptchaClickAction).actionState).toBe('adjustAction');

        const newLocationStrings = (action as CaptchaClickAction).location;
        const newLocation = { x: parseInt(newLocationStrings.x), y: parseInt(newLocationStrings.y) };
        const expectedLocation = { x: 10, y: 50 };
        expect(newLocation).toBeDefined();
        expect(newLocation.x).toBeGreaterThanOrEqual(expectedLocation.x - LOCATION_MARGIN_OF_ERROR);
        expect(newLocation.x).toBeLessThanOrEqual(expectedLocation.x + LOCATION_MARGIN_OF_ERROR);
        expect(newLocation.y).toBeGreaterThanOrEqual(expectedLocation.y - LOCATION_MARGIN_OF_ERROR);
        expect(newLocation.y).toBeLessThanOrEqual(expectedLocation.y + LOCATION_MARGIN_OF_ERROR);

    });

    test.skip('Should correctly confirm an correct location', async () => {
        const previosCorrectAction: CaptchaAction = {
            action: CaptchaActionTypes.Click,
            location: {
                x: "10%",
                y: "50%"
            },
            actionState: CaptchaActionState.AdjustAction,
        };
        const action = await llmConnector.adjustCaptchaActions(recaptchaThatShouldBeConfirmed, previosCorrectAction, []);
        expect(action.action).toBe('click');
        expect((action as CaptchaClickAction).actionState).toBe('actionConfirmed');
        const newLocationStrings = (action as CaptchaClickAction).location;
        const newLocation = { x: parseInt(newLocationStrings.x), y: parseInt(newLocationStrings.y) };
        const expectedLocation = { x: 10, y: 50 };
        expect(newLocation).toBeDefined();
        expect(newLocation.x).toBeGreaterThanOrEqual(expectedLocation.x - LOCATION_MARGIN_OF_ERROR);
        expect(newLocation.x).toBeLessThanOrEqual(expectedLocation.x + LOCATION_MARGIN_OF_ERROR);
        expect(newLocation.y).toBeGreaterThanOrEqual(expectedLocation.y - LOCATION_MARGIN_OF_ERROR);
        expect(newLocation.y).toBeLessThanOrEqual(expectedLocation.y + LOCATION_MARGIN_OF_ERROR);

    });

});

