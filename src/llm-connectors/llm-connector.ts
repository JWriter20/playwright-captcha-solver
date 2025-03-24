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

const CaptchaFinishedActionSchema = z.object({
    action: z.literal("captcha_solved"),
});

const CaptchaActionSchema = z.discriminatedUnion("action", [
    CaptchaClickActionSchema,
    CaptchaDragActionSchema,
    CaptchaTypeActionSchema,
    CaptchaFinishedActionSchema,
]);

// Define the array schema for multiple actions
const CaptchaActionsSchema = z.array(CaptchaActionSchema).max(4);

// Define types based on the schemas
type CaptchaActionLocation = z.infer<typeof CaptchaActionLocationSchema>;
type CaptchaActionState = z.infer<typeof CaptchaActionStateSchema>;
type CaptchaClickAction = z.infer<typeof CaptchaClickActionSchema>;
type CaptchaDragAction = z.infer<typeof CaptchaDragActionSchema>;
type CaptchaTypeAction = z.infer<typeof CaptchaTypeActionSchema>;
type CaptchaFinishedAction = z.infer<typeof CaptchaFinishedActionSchema>;
export type CaptchaAction = z.infer<typeof CaptchaActionSchema>;
export type CaptchaActionType = "click" | "drag" | "type" | "captcha_solved";

export enum LLMModels {
    GEMINI,
    CHATGPT,
    DEEPSEEK
}

/**
 * Abstract class for LLM (Language Learning Model) connectors.
 * (Note: this abstract class only has basic query methods.)
 */
export abstract class LLMConnector {
    private instructor: InstructorClient<any>;

    constructor() {
        const genericClient = {
            chat: {
                completions: {
                    create: async (params: {
                        model: string;
                        messages: { role: string; content: string }[];
                        max_retries?: number;
                        image?: string;
                    }) => {
                        // Combine all messages into a single prompt string
                        let promptText = "";
                        for (const message of params.messages) {
                            promptText += message.content + "\n\n";
                        }
                        let result: string;
                        if (params.image) {
                            result = await this.queryWithImage(promptText, params.image);
                        } else {
                            result = await this.query(promptText);
                        }
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

    private buildPromptForCaptchaAction(actionHistory: CaptchaAction[]): string {
        let prompt = "You are a captcha-solving AI. Analyze the image and decide on the next action(s).\n\n";

        if (actionHistory.length > 0) {
            prompt += "Here's a history of previous actions:\n";
            actionHistory.forEach((action, index) => {
                prompt += `Action ${index + 1}: ${JSON.stringify(action)}\n`;
            });
        }

        prompt += "\nReturn up to 4 actions. Available action types are 'click', 'drag', 'type', 'captcha_solved' .\n";
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