import { userHashedId } from "@/features/auth/helpers";
import { OpenAIInstance } from "@/features/common/openai";
import { AI_NAME } from "@/features/theme/customise";
import { OpenAIStream, StreamingTextResponse } from "ai";
import { initAndGuardChatSession } from "./chat-thread-service";
import { CosmosDBChatMessageHistory } from "./cosmosdb/cosmosdb";
import { PromptGPTProps } from "./models";
import { encodingForModel, TiktokenModel} from "js-tiktoken"
import { metrics } from "@opentelemetry/api";
import { getServerSession } from "next-auth";

export const ChatAPISimple = async (props: PromptGPTProps) => {
  const { lastHumanMessage, chatThread } = await initAndGuardChatSession(props);

  const session = await getServerSession();

  const openAI = OpenAIInstance();

  const userId = await userHashedId();

  const meter = metrics.getMeter("chat");

  const promptTokensUsed = meter.createHistogram("promptTokensUsed", {
    description: "Number of tokens used in the input prompt",
    unit: "tokens",
  });

  const completionsTokensUsed = meter.createHistogram("completionsTokensUsed", {
    description: "Number of tokens used in the completions",
    unit: "tokens",
  });

  const chatHistory = new CosmosDBChatMessageHistory({
    sessionId: chatThread.id,
    userId: userId,
  });

  await chatHistory.addMessage({
    content: lastHumanMessage.content,
    role: "user",
  });

  const history = await chatHistory.getMessages();
  const topHistory = history.slice(history.length - 30, history.length);

  try {
    const model = <TiktokenModel>process.env.AZURE_OPENAI_API_DEPLOYMENT_NAME
    const enc = encodingForModel(model);  // js-tiktoken

    let promptTokens = 45; // static system prompt

    for (const message of topHistory) {
      const tokenList = enc.encode(message.content || "");
      promptTokens += tokenList.length;
    }

    promptTokensUsed.record(promptTokens, { "model": model, "email": session?.user.email || "unknown" });

    const response = await openAI.chat.completions.create({
      messages: [
        {
          role: "system",
          content: `-You are ${AI_NAME} who is a helpful AI Assistant.
          - You will provide clear and concise queries, and you will respond with polite and professional answers.
          - You will answer questions truthfully and accurately.`,
        },
        ...topHistory,
      ],
      model: process.env.AZURE_OPENAI_API_DEPLOYMENT_NAME,
      stream: true,
    });

    let completionTokens = 0;

    const stream = OpenAIStream(response, {
      async onToken(token) {
        const tokenList = enc.encode(token);
        completionTokens += tokenList.length;
      },
      async onCompletion(completion) {
        await chatHistory.addMessage({
          content: completion,
          role: "assistant",
        });

        completionsTokensUsed.record(completionTokens, { "model": model, "email": session?.user.email || "unknown" });
      },
    });

    return new StreamingTextResponse(stream);
  } catch (e: unknown) {
    if (e instanceof Error) {
      return new Response(e.message, {
        status: 500,
        statusText: e.toString(),
      });
    } else {
      return new Response("An unknown error occurred.", {
        status: 500,
        statusText: "Unknown Error",
      });
    }
  }
};
