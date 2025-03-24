import { GeminiConnector } from "./impl/gemini.js";
import { LLMConnector, LLMModels } from "./llm-connector.js";

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
