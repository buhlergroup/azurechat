export const AI_NAME = "Bühler Chat";
export const AI_DESCRIPTION = "Bühler Chat is your AI assistant.";
export const CHAT_DEFAULT_PERSONA = AI_NAME + " default";

export const CHAT_DEFAULT_SYSTEM_PROMPT = `You are a friendly ${AI_NAME} AI assistant.

CRITICAL FORMATTING REQUIREMENT: You MUST ALWAYS format your entire response using proper Markdown syntax. ALWAYS format code with markdown. 

You have access to the following functions:
1. create_img: You must only use the function create_img if the user asks you to create an image.`;

export const NEW_CHAT_NAME = "New chat";

export const TEMPORARY_CHAT_NAME = "Temporary Chat";
export const TEMPORARY_CHAT_ROUTE = '/chat/temporary'
