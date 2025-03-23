import { Buffer } from 'buffer';
import { z } from "zod";
import Instructor from "@instructor-ai/instructor";
import type { InstructorClient } from '@instructor-ai/instructor';
import { start } from 'repl';

// Define Zod schemas for captcha actions
const CaptchaActionLocationSchema = z.object({
    x: z.string(),
    y: z.string()
});

const CaptchaActionStateSchema = z.enum([
    "creatingAction",
    "adjustAction",
    "actionConfirmed",
    "captchaSolved"
]);

const CaptchaClickActionSchema = z.object({
    action: z.literal("click"),
    location: CaptchaActionLocationSchema,
    actionState: CaptchaActionStateSchema
});

const CaptchaDragActionSchema = z.object({
    action: z.literal("drag"),
    startLocation: CaptchaActionLocationSchema,
    endLocation: CaptchaActionLocationSchema,
    actionState: CaptchaActionStateSchema
});

const CaptchaTypeActionSchema = z.object({
    action: z.literal("type"),
    location: CaptchaActionLocationSchema,
    value: z.string(),
    actionState: CaptchaActionStateSchema
});

const CaptchaActionSchema = z.discriminatedUnion("action", [
    CaptchaClickActionSchema,
    CaptchaDragActionSchema,
    CaptchaTypeActionSchema
]);

// Define the array schema for multiple actions
const CaptchaActionsSchema = z.array(CaptchaActionSchema).max(4);

// Define types based on the schemas
type CaptchaActionLocation = z.infer<typeof CaptchaActionLocationSchema>;
type CaptchaActionState = z.infer<typeof CaptchaActionStateSchema>;
type CaptchaClickAction = z.infer<typeof CaptchaClickActionSchema>;
type CaptchaDragAction = z.infer<typeof CaptchaDragActionSchema>;
type CaptchaTypeAction = z.infer<typeof CaptchaTypeActionSchema>;
export type CaptchaAction = z.infer<typeof CaptchaActionSchema>;
export type CaptchaActionType = "click" | "drag" | "type";

/**
 * Abstract class for LLM (Language Learning Model) connectors.
 * (Note: this abstract class only has basic query methods.)
 */
export abstract class LLMConnector {
    /**
     * Send a text-only query to the LLM.
     * @param prompt The text prompt to send.
     * @returns A promise resolving to the LLM response.
     */
    abstract query(prompt: string): Promise<string>;

    /**
     * Send a query with an image to the LLM.
     * @param prompt The text prompt to send.
     * @param imageBase64 The base64-encoded image data.
     * @returns A promise resolving to the LLM response.
     */
    abstract queryWithImage(prompt: string, imageBase64: string): Promise<string>;
}

/**
 * Implementation of a captcha solver connector that uses Instructor.
 * It wraps the provided LLMConnector in a generic client so that Instructor’s
 * structuredOutput can use a chat-completion interface similar to the GeminiFlash example.
 */
export class CaptchaSolverLLMConnector {
    private llmConnector: LLMConnector;
    private instructor: InstructorClient<any>;

    constructor(llmConnector: LLMConnector) {
        this.llmConnector = llmConnector;
        // Wrap the provided llmConnector in a generic client with a chat.completions.create method.
        const connector = this.llmConnector;
        const genericClient = {
            chat: {
                completions: {
                    create: async (params: {
                        model: string;
                        messages: { role: string; content: string }[];
                        max_retries?: number;
                        image?: string;
                    }) => {
                        // Combine messages (system + user) into a single prompt string.
                        let promptText = "";
                        for (const message of params.messages) {
                            promptText += message.content + "\n\n";
                        }
                        let result: string;
                        if (params.image) {
                            result = await connector.queryWithImage(promptText, params.image);
                        } else {
                            result = await connector.query(promptText);
                        }
                        // Return a structure similar to an OpenAI chat completion.
                        return {
                            id: "",
                            object: "chat.completion",
                            created: Date.now(),
                            choices: [{ message: { content: result } }],
                            usage: {
                                prompt_tokens: 0,
                                completion_tokens: 0,
                                total_tokens: 0,
                            },
                        };
                    },
                },
            },
        };

        this.instructor = Instructor({
            client: genericClient,
            mode: "JSON"
        });
    }

    /**
     * Get captcha actions based on an image.
     * @param imageBase64 Base64-encoded captcha image.
     * @param actionHistory Previous actions taken.
     * @returns Promise resolving to an array of captcha actions.
     */
    async getCaptchaActions(imageBase64: string, actionHistory: CaptchaAction[] = []): Promise<CaptchaAction[]> {
        const prompt = this.buildPromptForCaptchaAction(actionHistory);

        try {
            const response = await this.instructor.structuredOutput({
                prompt,
                image: imageBase64,
                schema: CaptchaActionsSchema
            });
            return response;
        } catch (error) {
            throw new Error(`Failed to validate captcha actions: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Adjust captcha actions based on feedback.
     * @param imageBase64WithOverlay Base64-encoded image with action overlay.
     * @param previousActions Previous actions that need adjustment.
     * @returns Promise resolving to adjusted captcha actions.
     */
    async adjustCaptchaActions(imageBase64WithOverlay: string, previousActions: CaptchaAction[]): Promise<CaptchaAction[]> {
        const prompt = this.buildPromptForActionAdjustment(previousActions);
        try {
            const response = await this.instructor.structuredOutput({
                prompt,
                image: imageBase64WithOverlay,
                schema: CaptchaActionsSchema
            });
            return response;
        } catch (error) {
            throw new Error(`Failed to validate adjusted captcha actions: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Confirm captcha actions or mark captcha as solved.
     * @param previousActions Actions to confirm.
     * @param isSolved Whether the captcha is solved.
     * @returns Promise resolving to confirmed actions with updated state.
     */
    async confirmCaptchaActions(previousActions: CaptchaAction[], isSolved: boolean = false): Promise<CaptchaAction[]> {
        const actionState = isSolved ? "captchaSolved" : "actionConfirmed";
        return previousActions.map(action => ({
            ...action,
            actionState
        }));
    }

    private buildPromptForCaptchaAction(actionHistory: CaptchaAction[]): string {
        let prompt = "You are a captcha-solving AI. Analyze the image and decide on the next action(s).\n\n";

        if (actionHistory.length > 0) {
            prompt += "Here's a history of previous actions:\n";
            actionHistory.forEach((action, index) => {
                prompt += `Action ${index + 1}: ${JSON.stringify(action)}\n`;
            });
        }

        prompt += "\nReturn up to 4 actions. Available action types are 'click', 'drag', and 'type'.\n";
        prompt += "If multiple actions are needed, they will be represented as colored dots in this order: Red (1st), Blue (2nd), Orange (3rd), Purple (4th).\n";
        prompt += "Set 'actionState' to 'creatingAction'.";
        return prompt;
    }

    private buildPromptForActionAdjustment(previousActions: CaptchaAction[]): string {
        let prompt = "The overlay for your previous action(s) may not be correctly positioned. Please adjust your action(s).\n\n";
        prompt += `Previous actions: ${JSON.stringify(previousActions)}\n\n`;
        prompt += "Return adjusted action(s) with 'actionState' set to 'adjustAction'.";
        return prompt;
    }
}
