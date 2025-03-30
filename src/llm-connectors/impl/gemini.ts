import { LLMConnector } from '../llm-connector.js';
import type { WrappedSchema } from '../llm-connector.js';
import { z, ZodObject } from "zod";
import Instructor from "@instructor-ai/instructor";
import type { GenericClient, GenericCreateParams, InstructorClient } from "@instructor-ai/instructor";
import { GenerativeModel, GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from 'dotenv';
dotenv.config();

/**
 * GoogleGenericClient wraps a Google GenerativeModel instance so that it
 * exposes a .chat.completions.create() method. This satisfies the GenericClient
 * interface that Instructor expects.
 */
class GoogleGenericClient implements GenericClient {
    baseURL?: string;
    chat?: {
        completions?: {
            create?: <P extends GenericCreateParams>(params: P) => Promise<unknown>;
        };
    };

    private model: GenerativeModel;

    constructor(model: GenerativeModel) {
        this.model = model;
        this.chat = {
            completions: {
                create: async <P extends GenericCreateParams>(params: P): Promise<unknown> => {
                    // Extract text from all messages not starting with "IMAGE:"
                    const textPrompt = (params.messages || [])
                        .filter((msg: { role: string; content: string }) => !msg.content.startsWith('IMAGE:'))
                        .map((msg: { role: string; content: string }) => msg.content)
                        .join("\n");

                    // Look for an image message (assumes only one image message is passed)
                    const imageMsg = ((params.messages || []) as { role: string; content: string }[])
                        .find((msg: { role: string; content: string }) => msg.content.startsWith('IMAGE:'));

                    let imageData = null;
                    if (imageMsg) {
                        const imageBase64 = imageMsg.content.replace('IMAGE:', '').trim();
                        imageData = {
                            inlineData: {
                                data: imageBase64,
                                mimeType: 'image/png'
                            }
                        };
                    }

                    try {
                        const result = imageData
                            ? await this.model.generateContent([textPrompt, imageData])
                            : await this.model.generateContent(textPrompt);
                        // Return the trimmed text response in an object with a "response" key
                        return { response: result.response.text().trim() };
                    } catch (error) {
                        throw new Error(
                            `GoogleGenericClient query failed: ${error instanceof Error ? error.message : String(error)}`
                        );
                    }
                }
            }
        };
    }
    [key: string]: unknown;
}

export class GeminiConnector extends LLMConnector {
    private genAI: GoogleGenerativeAI;
    private model: GenerativeModel;
    private modelName: string;
    private client: InstructorClient<GoogleGenericClient>;

    constructor(modelName: string = 'gemini-2.0-flash') {
        super();
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            throw new Error('GEMINI_API_KEY environment variable is required');
        }

        this.modelName = modelName;
        this.genAI = new GoogleGenerativeAI(apiKey);
        this.model = this.genAI.getGenerativeModel({ model: modelName });
        // Wrap the GenerativeModel in our GoogleGenericClient so it satisfies GenericClient.
        const genericClient = new GoogleGenericClient(this.model);
        this.client = Instructor({ client: genericClient, mode: "JSON" });
    }

    async query<T = string>(prompt: string, schema?: WrappedSchema<T>): Promise<T> {
        // Non-JSON mode: call generateContent directly.
        if (!schema) {
            try {
                const result = await this.model.generateContent(prompt);
                return result.response.text().trim() as T;
            } catch (error) {
                throw new Error(
                    `Gemini query failed: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }
        try {
            const response = await this.client.chat.completions.create({
                model: this.modelName,
                messages: [
                    { role: "system", content: "You are a helpful assistant." },
                    { role: "user", content: prompt }
                ],
                response_model: {
                    schema: schema,
                    name: "Response"
                }
            });
            return response.response;
        } catch (error) {
            throw new Error(
                `Gemini query (JSON mode) failed: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    async queryWithImage<T = string>(prompt: string, imageBase64: string, schema?: WrappedSchema<T>): Promise<T> {
        const imageData = {
            inlineData: {
                data: imageBase64,
                mimeType: 'image/png'
            }
        };

        // console.log(`Solving image query with prompt: ${prompt} and image data: ${imageBase64}`);
        // Non-JSON mode: simply pass prompt and inline image.
        if (!schema) {
            try {
                const result = await this.model.generateContent([prompt, imageData]);
                return result.response.text().trim() as T;
            } catch (error) {
                throw new Error(
                    `Gemini image query failed: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }

        // JSON mode: fall back to generateContent and manually parse JSON.
        try {
            console.warn("Falling back to generateContent for JSON mode image query.");
            const result = await this.model.generateContent([prompt, imageData]);
            let jsonText = result.response.text().trim();
            if (!jsonText) {
                throw new Error("Empty response from model");
            }

            // Remove markdown code block markers if present
            const codeBlockMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
            if (codeBlockMatch) {
                jsonText = codeBlockMatch[1].trim();
            }

            let parsedResponse: T;
            try {
                parsedResponse = JSON.parse(jsonText);
            } catch (parseError) {
                throw new Error(`Failed to parse JSON response: ${jsonText}`);
            }
            console.log('Parsed JSON response:', JSON.stringify(parsedResponse));
            return parsedResponse;
        } catch (error) {
            throw new Error(
                `Gemini image query (fallback JSON mode) failed: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

}
