"use server";
import "server-only";

import { userHashedId } from "@/features/auth-page/helpers";
import { OpenAIInstance } from "@/features/common/services/openai";
import {
  ChatCompletionStreamingRunner,
  ChatCompletionStreamParams,
} from "openai/resources/chat/completions";
import { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { SimilaritySearch } from "../azure-ai-search/azure-ai-search";
import { CreateCitations, FormatCitations } from "../citation-service";
import { ChatCitationModel, ChatThreadModel, MODEL_CONFIGS } from "../models";
import { reportPromptTokens } from "@/features/common/services/chat-metrics-service";
import { ChatTokenService } from "@/features/common/services/chat-token-service";
import {
  AuthorizedDocuments,
  PersonaDocumentById,
} from "@/features/persona-page/persona-services/persona-documents-service";
import { convertPersonaDocumentToSharePointDocument } from "@/features/persona-page/persona-services/models";

export const ChatApiRAG = async (props: {
  chatThread: ChatThreadModel;
  userMessage: string;
  history: ChatCompletionMessageParam[];
  signal: AbortSignal;
  reasoningEffort?: string;
}): Promise<ChatCompletionStreamingRunner> => {
  const { chatThread, userMessage, history, signal, reasoningEffort } = props;

  const allowedPersonaDocumentIdsResponse = await AllowedPersonaDocumentIds(
    chatThread.personaDocumentIds
  );

  // Get the appropriate OpenAI instance based on selected model
  const selectedModel = chatThread.selectedModel || "gpt-4.1";
  const modelConfig = MODEL_CONFIGS[selectedModel];
  const openAI = modelConfig.getInstance();

  const personaFilter =
    allowedPersonaDocumentIdsResponse.length > 0
      ? `(${allowedPersonaDocumentIdsResponse
          .map((id) => `personaDocumentId eq '${id}'`)
          .join(" or ")})`
      : "false";

  const documentResponse = await SimilaritySearch(
    userMessage,
    10,
    `(user eq '${await userHashedId()}' and chatThreadId eq '${
      chatThread.id
    }') or (chatThreadId eq null and ${personaFilter})`
  );

  const documents: ChatCitationModel[] = [];

  if (documentResponse.status === "OK") {
    const withoutEmbedding = FormatCitations(documentResponse.response);
    const citationResponse = await CreateCitations(withoutEmbedding);

    citationResponse.forEach((c) => {
      if (c.status === "OK") {
        documents.push(c.response);
      }
    });
  }

  const content = documents
    .map((result, index) => {
      const content = result.content.document.pageContent;
      const context = `[${index}]. file name: ${result.content.document.metadata} \n file id: ${result.id} \n ${content}`;
      return context;
    })
    .join("\n------\n");
  // Augment the user prompt
  const _userMessage = `\n
- Review the following content from documents uploaded by the user and create a final answer.
- If you don't know the answer, state that you don't know and still try to address the question as best as possible.
- You must always include a citation at the end of your answer and don't include full stop after the citations.
- Use the format for your citation {% citation items=[{name:"filename 1",id:"file id"}, {name:"filename 2",id:"file id"}] /%}
----------------
content: 
${content}
\n
---------------- \n
question: 
${userMessage}
`;

  const stream: ChatCompletionStreamParams = {
    model: chatThread.selectedModel || "gpt-4o",
    stream: true,
    messages: [
      {
        role: "system",
        content: chatThread.personaMessage,
      },
      ...history,
      {
        role: "user",
        content: _userMessage,
      },
    ],
  };

  // Note: Azure OpenAI doesn't support reasoning parameters in Chat Completions API
  // Reasoning models will work but without explicit reasoning configuration
  if (modelConfig?.supportsReasoning) {
    console.log(`🧠 Using reasoning model ${chatThread.selectedModel} with RAG via Chat Completions API (Azure OpenAI)`);
  }

  let chatTokenService = new ChatTokenService();

  let promptTokens = chatTokenService.getTokenCountFromHistory(stream.messages);

  for (let tokens of promptTokens) {
    reportPromptTokens(tokens.tokens, "gpt-4", tokens.role, {
      personaMessageTitle: chatThread.personaMessageTitle,
      messageCount: stream.messages.length,
      threadId: chatThread.id,
    });
  }

  return openAI.chat.completions.stream(stream, { signal });
};

const AllowedPersonaDocumentIds = async (personaDocumentIds: string[]) => {
  const personaDocumentsResponses = await Promise.all(
    personaDocumentIds.map(async (id) => {
      try {
        return await PersonaDocumentById(id);
      } catch (error) {
        return null;
      }
    })
  );

  const personaDocuments = personaDocumentsResponses.filter(
    (response) => response !== null && response.status === "OK"
  );

  const allowedPersonaDocuments = await AuthorizedDocuments(
    personaDocuments.map((e) =>
      convertPersonaDocumentToSharePointDocument(e.response)
    )
  );

  return allowedPersonaDocuments;
};
