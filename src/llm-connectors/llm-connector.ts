import dotenv from 'dotenv';
import { z, ZodObject, ZodType } from "zod";
dotenv.config();

export interface CaptchaActionLocation {
    x: string;
    y: string;
}

export const CaptchaActionState = {
    CreatingAction: "creatingAction",
    AdjustAction: "adjustAction",
    ActionConfirmed: "actionConfirmed"
} as const;

export type CaptchaActionState = typeof CaptchaActionState[keyof typeof CaptchaActionState];

export const CaptchaActionTypes = {
    Click: "click",
    Drag: "drag",
    Type: "type",
    CaptchaSolved: "captcha_solved"
} as const;

export type CaptchaActionType = typeof CaptchaActionTypes[keyof typeof CaptchaActionTypes];

export interface CaptchaClickAction {
    action: typeof CaptchaActionTypes.Click;
    location: CaptchaActionLocation;
    actionState: CaptchaActionState;
}

export interface CaptchaDragAction {
    action: typeof CaptchaActionTypes.Drag;
    startLocation: CaptchaActionLocation;
    endLocation: CaptchaActionLocation;
    actionState: CaptchaActionState;
}

export interface CaptchaTypeAction {
    action: typeof CaptchaActionTypes.Type;
    location: CaptchaActionLocation;
    value: string;
    actionState: CaptchaActionState;
}

export interface CaptchaFinishedAction {
    action: typeof CaptchaActionTypes.CaptchaSolved;
}

export type CaptchaAction =
    | CaptchaClickAction
    | CaptchaDragAction
    | CaptchaTypeAction
    | CaptchaFinishedAction;

// Define a reusable location schema.
const locationSchema = z.object({
    x: z.string(),
    y: z.string(),
}).strict();

const singleCaptchaActionSchema = z.discriminatedUnion("action", [
    z.object({
        action: z.literal("click"),
        location: locationSchema,
        actionState: z.enum(["creatingAction", "adjustAction", "actionConfirmed"]),
    }).strict(),
    z.object({
        action: z.literal("drag"),
        startLocation: locationSchema,
        endLocation: locationSchema,
        actionState: z.enum(["creatingAction", "adjustAction", "actionConfirmed"]),
    }).strict(),
    z.object({
        action: z.literal("type"),
        location: locationSchema,
        value: z.string(),
        actionState: z.enum(["creatingAction", "adjustAction", "actionConfirmed"]),
    }).strict(),
    z.object({
        action: z.literal("captcha_solved"),
    }).strict(),
]);

// An array of up to 4 captcha actions.
export type CaptchaActionSchemaType = z.infer<typeof singleCaptchaActionSchema>;

export type WrappedSchema<T> = ZodObject<{ response: z.ZodType<any, any, T> }>;

/**
 * Abstract class for LLM (Language Learning Model) connectors.
 *
 * Note: When using a schema, it must be a ZodObject of the form:
 *    z.object({ response: <your schema> })
 */
export abstract class LLMConnector {
    /**
     * Send a text-only query.
     * @param prompt The text prompt.
     * @param schema Optional ZodObject schema for structured output.
     * @returns The LLM response parsed as type T.
     */
    abstract query<T = string>(prompt: string, schema?: WrappedSchema<T>): Promise<T>;

    /**
     * Send a query with an image.
     * @param prompt The text prompt.
     * @param imageBase64 The base64-encoded image data.
     * @param schema Optional ZodObject schema for structured output.
     * @returns The LLM response parsed as type T.
     */
    abstract queryWithImage<T = string>(prompt: string, imageBase64: string, schema?: WrappedSchema<T>): Promise<T>;

    async getCaptchaAction(imageBase64: string, actionHistory: CaptchaAction[] = []): Promise<CaptchaAction> {
        const prompt = this.buildPromptForCaptchaAction(actionHistory);
        try {
            // Wrap captchaActionsSchema in a ZodObject as required by Instructor.
            const wrappedSchema = z.object({ response: singleCaptchaActionSchema }) as WrappedSchema<CaptchaAction>;
            return await this.queryWithImage<CaptchaAction>(prompt, imageBase64, wrappedSchema);
        } catch (error) {
            throw new Error(`Failed to validate captcha actions: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    async adjustCaptchaActions(
        imageBase64WithOverlay: string,
        pendingAction: CaptchaAction,
        previousActions: CaptchaAction[] = []
    ): Promise<CaptchaAction> {
        const prompt = this.buildPromptForActionAdjustment(pendingAction, previousActions);
        try {
            const wrappedSchema = z.object({ response: singleCaptchaActionSchema }) as WrappedSchema<CaptchaAction>;
            const response = await this.queryWithImage<CaptchaAction>(prompt, imageBase64WithOverlay, wrappedSchema);
            return response;
        } catch (error) {
            throw new Error(`Failed to validate adjusted captcha action: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private buildPromptForCaptchaAction(actionHistory: CaptchaAction[]): string {
        const previousActionsText = actionHistory.length > 0
            ? `Previous actions:
            ${actionHistory.map((action, index) => `Action ${index + 1}: ${JSON.stringify(action)}`).join('\n')}\n`
            : '';

        return `You are a captcha-solving AI. Your task is to analyze the given image and decide on the next captcha action. The image will contain a captcha that may require a series of actions to solve. You only need to focus on the next action, we will solve this captcha one action at a time.

            Action types:
            - click: requires a 'location' (x and y as strings representing percentages between 0 and 100) and 'actionState' of 'creatingAction'.
            - drag: requires 'startLocation' and 'endLocation' (each with x and y as strings representing percentages between 0 and 100) and 'actionState' of 'creatingAction'.
            - type: requires a 'location' (with x and y as strings representing percentages between 0 and 100), a 'value' string, and 'actionState' of 'creatingAction'.
            - captcha_solved: only the 'action' property is needed.

            The x and y coordinates are percentages relative to the image dimensions. Meaning that an x value of 0 is the left edge of the image, 100 is the right edge, and 50 is the center.
            This is the same for the y value, where 0 is the top edge, 100 is the bottom edge, and 50 is the center.

            ${previousActionsText}
            Example valid 'click' action:
            {
                "action": "click",
                "location": { "x": "50", "y": "50" },
                "actionState": "creatingAction"
            }
                
            THIS IS VERY IMPORTANT: Only return the JSON object for the captcha action (like the example above), nothing else, no additional text or comments.
        `;

    }

    private buildPromptForActionAdjustment(pendingAction: CaptchaAction, previousActions: CaptchaAction[]): string {
        const previousActionsText = previousActions.length > 0
            ? `Previous actions:
            ${previousActions.map((action, index) => `Action ${index + 1}: ${JSON.stringify(action)}`).join('\n')} \n`
            : '';


        return `You are a captcha - solving AI.Your task is to correct or to confirm an action taken to solve the captcha.Given an action, and an image with a representation of this action
            overlayed on top of it, you must decide whether the action is correct or incorrect.If it is correct, return the action with 'actionState' set to 'actionConfirmed'.If it is incorrect or needs adjustment, return a new action that conforms to the provided schema.The location in the old action corresponds to the overlay of the action displayed on the image, so adjust the location accordingly.

            Action types:
        - click: requires a 'location'(x and y as strings representing percentages between 0 and 100) and 'actionState' of 'creatingAction'.
            - drag: requires 'startLocation' and 'endLocation'(each with x and y as strings representing percentages between 0 and 100) and 'actionState' of 'creatingAction'.
            - type: requires a 'location'(with x and y as strings representing percentages between 0 and 100), a 'value' string, and 'actionState' of 'creatingAction'.
            - captcha_solved: only the 'action' property is needed.

            The x and y coordinates are percentages relative to the image dimensions.Meaning that an x value of 0 is the left edge of the image, 100 is the right edge, and 50 is the center.
            This is the same for the y value, where 0 is the top edge, 100 is the bottom edge, and 50 is the center.

            Here is the current pending action we need you to confirm or adjust:
            ${JSON.stringify(pendingAction)}

            And here is the list of previous actions you have taken:
            ${previousActionsText}
            Example valid 'click' action:
        {
            "action": "click",
                "location": { "x": "50", "y": "50" },
            "actionState": "creatingAction"
        }
                
            If you made an adjustment to the location, Return the adjusted action with 'actionState' set to 'adjustAction', again if you beleive the action is correct, return the action with 'actionState' set to 'actionConfirmed'.
            
            THIS IS VERY IMPORTANT: Only return the JSON object for the captcha action(like the example above), nothing else, no additional text or comments.`;
    }

}
