import { LLMConnector } from '../llm-connector.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
dotenv.config();

/**
 * Implementation of LLMConnector for Gemini Flash 2.0
 */
export class GeminiConnector extends LLMConnector {
    private genAI: GoogleGenerativeAI;
    private model: string;

    /**
     * Create a new GeminiConnector
     * @param model The Gemini model to use (defaults to 'gemini-flash-2.0')
     */
    constructor(model: string = 'gemini-2.0-flash') {
        super();
        const apiKey = process.env.GEMINI_API_KEY;

        if (!apiKey) {
            throw new Error('GEMINI_API_KEY environment variable is required');
        }

        this.genAI = new GoogleGenerativeAI(apiKey);
        this.model = model;
    }

    /**
     * Send a text-only query to Gemini
     * @param prompt The text prompt to send
     * @returns A promise resolving to the Gemini response
     */
    async query(prompt: string): Promise<string> {
        try {
            const model = this.genAI.getGenerativeModel({ model: this.model });
            const result = await model.generateContent(prompt);
            const response = result.response;
            return response.text();
        } catch (error) {
            throw new Error(`Gemini query failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Send a query with an image to Gemini
     * @param prompt The text prompt to send
     * @param imageBase64 The base64-encoded image data
     * @returns A promise resolving to the Gemini response
     */
    async queryWithImage(prompt: string, imageBase64: string): Promise<string> {
        try {
            const model = this.genAI.getGenerativeModel({ model: this.model });

            // Format the image for Gemini API
            const imageData = {
                inlineData: {
                    data: imageBase64,
                    mimeType: 'image/jpeg', // Adjust if needed based on your image format
                },
            };

            const result = await model.generateContent([prompt, imageData]);
            const response = result.response;
            return response.text();
        } catch (error) {
            throw new Error(`Gemini image query failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}