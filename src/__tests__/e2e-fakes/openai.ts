// Build-time substitute for features/common/services/openai.ts.
// Loaded via next.config.js webpack alias when AZURECHAT_TEST_BACKEND=memory.

const fakeChunks = (text: string) => {
  const parts = text.split(/(\s+)/);
  return async function* () {
    let i = 0;
    for (const p of parts) {
      yield {
        id: `chunk-${i++}`,
        choices: [{ delta: { content: p, role: "assistant" }, index: 0, finish_reason: null }],
      };
    }
    yield {
      id: `chunk-${i}`,
      choices: [{ delta: {}, index: 0, finish_reason: "stop" }],
    };
  };
};

const fakeResponsesIterator = (text: string) => {
  return async function* () {
    yield { type: "response.created", response: { id: "resp-fake-1" } };
    yield { type: "response.output_item.added", item: { id: "msg-fake-1", type: "message" } };
    for (const word of text.split(/(\s+)/)) {
      yield { type: "response.output_text.delta", delta: word, item_id: "msg-fake-1" };
    }
    yield { type: "response.output_item.done", item: { id: "msg-fake-1", type: "message", content: [{ type: "output_text", text }] } };
    yield {
      type: "response.completed",
      response: {
        id: "resp-fake-1",
        output: [{ id: "msg-fake-1", type: "message", role: "assistant", content: [{ type: "output_text", text }] }],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      },
    };
  };
};

const TEST_REPLY = "TEST: this is a stubbed assistant reply for e2e.";

function makeClient() {
  const files = new Map<
    string,
    { id: string; filename: string; contentType: string; data: Uint8Array }
  >();
  let nextFileId = 1;

  return {
    chat: {
      completions: {
        create: async (req: any) => {
          if (req?.stream) return (fakeChunks(TEST_REPLY))();
          return {
            id: "cmpl-fake-1",
            choices: [{ index: 0, message: { role: "assistant", content: TEST_REPLY }, finish_reason: "stop" }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          };
        },
      },
    },
    responses: {
      create: async (req: any) => {
        if (req?.stream === false) {
          return {
            id: "resp-fake-1",
            output: [{ id: "msg-fake-1", type: "message", role: "assistant", content: [{ type: "output_text", text: TEST_REPLY }] }],
            usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
          };
        }
        return (fakeResponsesIterator(TEST_REPLY))();
      },
    },
    embeddings: {
      create: async () => ({ data: [{ embedding: new Array(1536).fill(0.1) }] }),
    },
    files: {
      create: async ({ file }: { file: File }) => {
        const id = `file-fake-${nextFileId++}`;
        files.set(id, {
          id,
          filename: file.name,
          contentType: file.type || "application/octet-stream",
          data: new Uint8Array(await file.arrayBuffer()),
        });
        return { id, filename: file.name };
      },
      retrieve: async (id: string) => {
        const file = files.get(id);
        if (!file) throw new Error(`Fake OpenAI file not found: ${id}`);
        return { id: file.id, filename: file.filename };
      },
      content: async (id: string) => {
        const file = files.get(id);
        if (!file) throw new Error(`Fake OpenAI file not found: ${id}`);
        const data = new ArrayBuffer(file.data.byteLength);
        new Uint8Array(data).set(file.data);
        return new Response(data, {
          headers: { "content-type": file.contentType },
        });
      },
      delete: async (id: string) => ({
        id,
        deleted: files.delete(id),
        object: "file",
      }),
    },
  } as any;
}

export const OpenAIInstance = () => makeClient();
export const OpenAIV1Instance = () => makeClient();
export const OpenAIMiniInstance = () => makeClient();
export const OpenAIEmbeddingInstance = () => makeClient();
export const OpenAIVisionInstance = () => makeClient();
export const OpenAIReasoningInstance = () => makeClient();
export const OpenAIV1ReasoningInstance = () => makeClient();
export const OpenAIV1ImageInstance = () => makeClient();
