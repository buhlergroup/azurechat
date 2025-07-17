import { Tiktoken, TiktokenModel, encodingForModel } from "js-tiktoken";
import { logWarn } from "./logger";

/**
 * ChatTokenService provides token counting capabilities using js-tiktoken.
 * 
 * Note: This service is primarily used as a fallback for manual token calculation.
 * The preferred method is to use actual token usage data from the OpenAI API
 * response.completed event, which provides more accurate token counts.
 */
export class ChatTokenService{


    private encoder: Tiktoken;

    constructor(model = "gpt-4") {

        try {
            const tiktokenModel = <TiktokenModel>model;
            this.encoder = encodingForModel(tiktokenModel);  // js-tiktoken
        } catch (error) {
            // console.log("Error getting model name from environment variable AZURE_OPENAI_API_DEPLOYMENT_NAME", error);
            logWarn("Model was not parsable from environment variable, falling back to gpt-4 model for token count", {
                requestedModel: model,
                error: error instanceof Error ? error.message : String(error)
            });
            this.encoder = encodingForModel("gpt-4");  // js-tiktoken
        }
    }    public getTokenCountFromMessage(message: any){
        let content = "";
        
        // Handle multimodal content (array) vs text content (string)
        if (Array.isArray(message.content)) {
            // Extract text content from multimodal message
            content = message.content
                .filter((item: any) => item.type === "text")
                .map((item: any) => item.text)
                .join(" ");
        } else {
            content = message.content || "";
        }
        
        const tokenList = this.encoder.encode(content);
        return tokenList.length;
    }

    public getTokenCountFromHistory(topHistory: any): { role: string, tokens: number }[] {
        let promptTokens = [];

        for (const message of topHistory) {
            let content = "";
            
            // Handle multimodal content (array) vs text content (string)
            if (Array.isArray(message.content)) {
                // Extract text content from multimodal message
                content = message.content
                    .filter((item: any) => item.type === "text")
                    .map((item: any) => item.text)
                    .join(" ");
            } else {
                content = message.content || "";
            }
            
            const tokenList = this.encoder.encode(content);
            promptTokens.push({ role: <string>message.role, tokens: <number>tokenList.length });
        }

        return promptTokens;
    }

    public getTokenCount(input: string){
        const tokenList = this.encoder.encode(input);
        return tokenList.length;
    }
}
