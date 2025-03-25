import { GeminiConnector } from "./impl/gemini.js";
import { LLMConnector } from "./llm-connector.js";

export enum LLMModels {
    GEMINI = "gemini",
}

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
