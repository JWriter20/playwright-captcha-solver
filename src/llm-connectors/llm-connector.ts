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
        const historyText = actionHistory.length > 0
            ? `Previous actions taken: ${JSON.stringify(actionHistory)}`
            : "No previous actions have been taken yet.";

        return `You are a captcha-solving AI tasked with analyzing a captcha puzzle image and deciding the next action to solve it. The image shows the current state of the captcha, which may require a series of actions. You can output a single action in one cycle to progress towards solving the captcha.

        **Available Action Types:**
        - **click**: Requires a 'location' with 'x' and 'y' as strings (percentages from 0 to 100) and 'actionState' set to 'creatingAction'.
        - **drag**: Requires 'startLocation' and 'endLocation', each with 'x' and 'y' as strings (percentages from 0 to 100), and 'actionState' set to 'creatingAction'.
        - **type**: Requires a 'location' with 'x' and 'y' as strings (percentages from 0 to 100), a 'value' string to type, and 'actionState' set to 'creatingAction'.
        - **captcha_solved**: Only requires the 'action' property, indicating the captcha is solved.

        **Coordinate System:**
        - Coordinates are percentages relative to the image dimensions.
        - x: 0% is the left edge, 100% is the right edge, 50% is the center.
        - y: 0% is the top edge, 100% is the bottom edge, 50% is the center.

        **Examples:**
        - click:
        {
            "action": "click",
            "location": { "x": "25", "y": "75" },
            "actionState": "creatingAction"
        }
        - drag:
        {
            "action": "drag",
            "startLocation": { "x": "10", "y": "20" },
            "endLocation": { "x": "90", "y": "80" },
            "actionState": "creatingAction"
        }
        - type:
        {
            "action": "type",
            "location": { "x": "50", "y": "50" },
            "value": "example text",
            "actionState": "creatingAction"
        }
        - Captcha solved:
        {
            "action": "captcha_solved"
        }

        **Instructions:**
        1. Analyze the image to identify interactive elements (e.g., buttons, sliders, text fields).
        2. Decide the next action(s) to advance the captcha solution. Output a single JSON object for one action or an array of up to four JSON objects for multiple actions.
        3. If the captcha is solved, return only the 'captcha_solved' action.

        **THIS IS VERY IMPORTANT:** Return only the JSON object (or array of objects) for the action(s), exactly as shown in the examples. Do not include additional text, explanations, or comments.
    `;
    }

    private buildPromptForActionAdjustment(pendingAction: CaptchaAction, previousActions: CaptchaAction[]): string {
        let specificInstructions = "";

        // Customize instructions based on action type
        if (pendingAction.action === "click") {
            specificInstructions = `The image includes an overlay (e.g., a colored dot) showing the location of your pending click action. Verify if this location accurately targets the intended element (e.g., a button or checkbox). If correct, confirm it. If incorrect, adjust the location to better target the element.`;
        } else if (pendingAction.action === "drag") {
            specificInstructions = `The image includes an overlay showing the start and end locations of your pending drag action (e.g., a line or two dots). Check if both locations are accurate for the intended drag (e.g., moving a slider). If both are correct, confirm it. If either needs adjustment, provide new start and/or end locations.`;
        } else if (pendingAction.action === "type") {
            specificInstructions = `The image includes an overlay showing the location of your pending type action (e.g., a dot or highlighted field). Confirm if this location targets the correct text input field. If correct, confirm it. If incorrect, adjust the location to better target the field. The 'value' is assumed correct unless the image clearly indicates otherwise.`;
        }

        return `You are a captcha-solving AI tasked with reviewing a pending action based on an image with an overlay representing that action. Your job is to confirm if the action is correct or adjust it if necessary.

        **Pending Action:**
        ${JSON.stringify(pendingAction)}

        **Instructions:**
        ${specificInstructions}

        **Action Types:**
        - **click**: Requires a 'location' with 'x' and 'y' as strings (percentages from 0 to 100).
        - **drag**: Requires 'startLocation' and 'endLocation', each with 'x' and 'y' as strings (percentages from 0 to 100).
        - **type**: Requires a 'location' with 'x' and 'y' as strings (percentages from 0 to 100) and a 'value' string.

        **Coordinate System:**
        - x: 0% left, 100% right, 50% center.
        - y: 0% top, 100% bottom, 50% center.

        **Response Rules:**
        - If the action is correct, return it with 'actionState' set to 'actionConfirmed'.
        - If it needs adjustment, return the corrected action with 'actionState' set to 'adjustAction'.

        **Examples:**
        - Confirming a click:
        {
            "action": "click",
            "location": { "x": "50", "y": "50" },
            "actionState": "actionConfirmed"
        }
        - Adjusting a click:
        {
            "action": "click",
            "location": { "x": "55", "y": "45" },
            "actionState": "adjustAction"
        }
        - Confirming a drag:
        {
            "action": "drag",
            "startLocation": { "x": "10", "y": "20" },
            "endLocation": { "x": "90", "y": "80" },
            "actionState": "actionConfirmed"
        }
        - Adjusting a drag:
        {
            "action": "drag",
            "startLocation": { "x": "15", "y": "25" },
            "endLocation": { "x": "85", "y": "75" },
            "actionState": "adjustAction"
        }
        - Confirming a type:
        {
            "action": "type",
            "location": { "x": "50", "y": "50" },
            "value": "example text",
            "actionState": "actionConfirmed"
        }
        - Adjusting a type:
        {
            "action": "type",
            "location": { "x": "52", "y": "48" },
            "value": "example text",
            "actionState": "adjustAction"
        }

        **THIS IS VERY IMPORTANT:** Return only the JSON object for the action, exactly as shown in the examples. Do not include additional text, explanations, or comments.
    `;
    }

}
