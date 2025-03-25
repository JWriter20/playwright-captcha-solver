import { GeminiConnector } from "./impl/gemini.js";
import { LLMConnector } from "./llm-connector.js";

export const LLMModels = {
    GEMINI: "gemini",
} as const;

export type LLMModels = typeof LLMModels[keyof typeof LLMModels];

export class ModelFactory {
    public static getLLMConnector(model: LLMModels): LLMConnector {
        switch (model) {
            case LLMModels.GEMINI:
                return new GeminiConnector();
            default:
                throw new Error("Invalid LLM model");
        }
    }
}
