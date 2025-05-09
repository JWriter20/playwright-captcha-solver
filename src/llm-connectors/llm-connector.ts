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
    MultiClick: "multiClick",
    CaptchaSolved: "captcha_solved"
} as const;

export type CaptchaActionType = typeof CaptchaActionTypes[keyof typeof CaptchaActionTypes];

export interface CaptchaClickAction {
    action: typeof CaptchaActionTypes.Click;
    location: CaptchaActionLocation;
    actionState: CaptchaActionState;
}

export interface CaptchaMultiClickAction {
    action: typeof CaptchaActionTypes.MultiClick;
    locations: {
        index: number;
        x: string;
        y: string;
    }[];
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
    | CaptchaMultiClickAction
    | CaptchaDragAction
    | CaptchaTypeAction
    | CaptchaFinishedAction

// Define a reusable location schema.
const locationSchema = z.object({
    x: z.string(),
    y: z.string(),
}).strict();

const singleCaptchaActionSchema = z.discriminatedUnion("action", [
    z.object({
        action: z.literal("click"),
        location: locationSchema,
        actionState: z.enum(["creatingAction", "adjustAction"]),
    }).strict(),
    z.object({
        action: z.literal("multiClick"),
        locations: z.array(z.object({
            index: z.number(),
            x: z.string(),
            y: z.string(),
        })),
        actionState: z.enum(["creatingAction", "adjustAction"]),
    }).strict(),
    z.object({
        action: z.literal("drag"),
        startLocation: locationSchema,
        endLocation: locationSchema,
        actionState: z.enum(["creatingAction", "adjustAction"]),
    }).strict(),
    z.object({
        action: z.literal("type"),
        location: locationSchema,
        value: z.string(),
        actionState: z.enum(["creatingAction", "adjustAction"]),
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
    - **multiClick**: Requires an array of 'locations' with 'index', 'x', and 'y' as strings (percentages from 0 to 100) and 'actionState' set to 'creatingAction'.
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
    - {
        "action": "MultiClick",
        "locations": [
            { "index": 0, "x": "25", "y": "75" },
            { "index": 1, "x": "75", "y": "25" }
        ],
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
    1. Analyze the image to identify interactive elements (e.g., buttons, sliders, text fields). Consider:
       - Are there checkboxes or buttons that need clicking? If so, where are they relative to the image? For example, if a checkbox is left of the middle, its x must be less than 50; if it’s right of the middle but left of the halfway point to the right edge, its x must be between 50 and 75.
       - Is there a grid of images or buttons? If so, which ones are unchecked or unclicked based on the image and prompt? Do they have to be clicked in a specific order?
       - Is there a slider or draggable object? If yes, where does it start, and where should it end to solve the captcha (e.g., aligning with a target or filling a gap)?
       - Is there a text input field? If so, what text should be typed based on the captcha’s instructions or visible clues (e.g., distorted letters, audio hints)?
    2. Reflect on the captcha type and goal:
       - If it’s a “select all squares with X” captcha, what squares remain unchecked based on the image and history? Estimate their positions (e.g., top-left corner might be around x: 10, y: 10). Can you check all the squares with a multiClick, or do you need multiple clicks?
       - If it’s a slider captcha, how far must the slider move? For instance, if it starts at x: 10 and the target is near the right edge, the end x might be 90.
       - If it’s a text-entry captcha, where is the input box (e.g., centered at x: 50, y: 50), and what text solves it?
    3. Use the action history to avoid repetition:
       - Have I already clicked this location? If so, should I try another spot or switch actions (e.g., from click to drag)?
       - Does the history suggest progress (e.g., fewer unchecked boxes)? If not, what’s the next logical step?
    4. Decide the next action(s) to advance the captcha solution. Output a single JSON object for one action or an array of up to four JSON objects for multiple actions. Ask yourself:
       - What’s the smallest step I can take to move forward? For example, clicking one box, dragging a slider halfway, or typing a partial answer.
       - Are multiple clicks needed? If so use a mutliClick action with an array of locations.
    5. If the captcha is solved (e.g., all boxes checked, slider aligned, text entered correctly), return only the 'captcha_solved' action. Double-check: Does the image show a success state (e.g., green checkmark, no remaining tasks)?

    **THIS IS VERY IMPORTANT:** Return only the JSON object (or array of objects) for the action(s), exactly as shown in the examples. Do not include additional text, explanations, or comments.
    `;
    }

    private buildPromptForActionAdjustment(pendingAction: CaptchaAction, previousActions: CaptchaAction[]): string {
        let specificInstructions = "";

        // Customize instructions based on action type
        if (pendingAction.action === "click") {
            specificInstructions = `The image includes an overlay (e.g., a colored dot) showing the location of your pending click action. Verify if this location accurately targets the intended element (e.g., a button or checkbox). If correct, meaning that if the click was performed in the center of the dot, the click action would be performed correctly, then don't change the location and set the actionState to "actionConfirmed". If incorrect, adjust the location to better target the element and keep the action state at "adjustAction". If the click action is over the desired target, DO NOT set the state to adjusting, just confirm it.`;
        } else if (pendingAction.action === "multiClick") {
            specificInstructions = `The image includes an overlay showing the locations and indexes of mutliple click actions (e.g., a multiclick action). Each action (colored dot overlay) has an index, use this to identity which is which. Confirm if these locations accurately target the intended elements (e.g., checkboxes or buttons). If correct, meaning that if the clicks were performed in the center of the dots, the actions would be performed correctly, then don't change the locations and set the actionState to "actionConfirmed". If incorrect, adjust the locations to better target the elements and keep the action state at "adjustAction".`;
        } else if (pendingAction.action === "drag") {
            specificInstructions = `The image includes an overlay showing the start and end locations of your pending drag action (an arrow connecting two dots). Check if both locations are accurate for the intended drag (e.g., moving a slider). If both are correct, meaning that if the drag was performed from one dot center to the other, the action would complete successfully then do not change the startLocation or endLocation and set the actionState to "actionConfirmed". If either needs adjustment, provide new start and/or end locations.`;
        } else if (pendingAction.action === "type") {
            specificInstructions = `The image includes an overlay showing the location of your pending type action (e.g., a dot or highlighted field). Confirm if this location targets the correct text input field. If correct, meaning that if the click was performed in the center of the dot, the input field would be highlighted and the text could be typed, then don't change the location and set the actionState to "actionConfirmed". If incorrect, adjust the location to better target the field. The 'value' is assumed correct unless the image clearly indicates otherwise.`;
        }

        return `You are a captcha-solving AI tasked with reviewing a pending action based on an image with an overlay representing that action. Your job is to confirm if the action is correct or adjust it if necessary.

        **Pending Action:**
        ${JSON.stringify(pendingAction)}

        **Instructions:**
        ${specificInstructions}

        **Action Types:**
        - **click**: Requires a 'location' with 'x' and 'y' as strings (percentages from 0 to 100).
        - **multiClick**: Requires an array of 'locations' with 'index', 'x', and 'y' as strings (percentages from 0 to 100) and the index of the click action "index".
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
        - Confirming a multiClick:
        {
            "action": "multiClick",
            "locations": [
                { "index": 0, "x": "25", "y": "75" },
                { "index": 1, "x": "75", "y": "25" }
            ],
            "actionState": "actionConfirmed"
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
