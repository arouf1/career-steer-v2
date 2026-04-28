import { createOpenRouter } from "@openrouter/ai-sdk-provider";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

const openrouterHeaders = (apiKey: string): Record<string, string> => ({
  Authorization: `Bearer ${apiKey}`,
  "Content-Type": "application/json",
  "HTTP-Referer": process.env.OPENROUTER_HTTP_REFERER ?? "https://career-steer.app",
  "X-OpenRouter-Title": process.env.OPENROUTER_APP_TITLE ?? "career-steer-v2",
});

const requireApiKey = (): string => {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is not set");
  return key;
};

export const openrouterClient = () =>
  createOpenRouter({ apiKey: requireApiKey() });

const STRUCTURED_OUTPUT_INCOMPATIBLE_PROVIDERS = ["amazon-bedrock"];

export const chatModel = (modelId: string, opts?: { zdr?: boolean }) =>
  openrouterClient().chat(modelId, {
    provider: {
      ...(opts?.zdr ? { zdr: true } : { data_collection: "deny" as const }),
      require_parameters: true,
      ignore: STRUCTURED_OUTPUT_INCOMPATIBLE_PROVIDERS,
    },
  });

export type EmbedTaskHint =
  | "retrieval document"
  | "retrieval query"
  | "semantic similarity"
  | "classification"
  | "clustering";

const EMBED_DEFAULT_DIMENSIONS = 1536;
const EMBED_DEFAULT_MODEL = "google/gemini-embedding-2-preview";

export type EmbedInput = {
  text: string;
  taskHint?: EmbedTaskHint;
};

export type EmbedOptions = {
  model?: string;
  outputDimensionality?: number;
  signal?: AbortSignal;
};

const buildEmbeddingInput = (input: EmbedInput): string =>
  input.taskHint
    ? `task: ${input.taskHint}\n\n${input.text}`
    : input.text;

export const embed = async (
  input: EmbedInput,
  opts: EmbedOptions = {},
): Promise<number[]> => {
  const [vec] = await embedBatch([input], opts);
  return vec;
};

export const embedBatch = async (
  inputs: EmbedInput[],
  opts: EmbedOptions = {},
): Promise<number[][]> => {
  if (inputs.length === 0) return [];

  const body = {
    model: opts.model ?? EMBED_DEFAULT_MODEL,
    input: inputs.map(buildEmbeddingInput),
    encoding_format: "float" as const,
    output_dimensionality:
      opts.outputDimensionality ?? EMBED_DEFAULT_DIMENSIONS,
  };

  const response = await fetch(`${OPENROUTER_BASE_URL}/embeddings`, {
    method: "POST",
    headers: openrouterHeaders(requireApiKey()),
    body: JSON.stringify(body),
    signal: opts.signal,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `OpenRouter embeddings ${response.status}: ${text.slice(0, 500)}`,
    );
  }

  const json = (await response.json()) as {
    data?: Array<{ embedding: number[]; index?: number }>;
  };

  const data = json.data;
  if (!data || data.length !== inputs.length) {
    throw new Error(
      `OpenRouter embeddings returned ${data?.length ?? 0} vectors for ${inputs.length} inputs`,
    );
  }

  const ordered = [...data].sort(
    (a, b) => (a.index ?? 0) - (b.index ?? 0),
  );
  const targetDim =
    opts.outputDimensionality ?? EMBED_DEFAULT_DIMENSIONS;
  return ordered.map((item) => {
    const vec = item.embedding;
    if (vec.length === targetDim) return vec;
    if (vec.length > targetDim) return vec.slice(0, targetDim);
    throw new Error(
      `embedding shorter than requested dim: got ${vec.length}, expected ${targetDim}`,
    );
  });
};

const RERANK_DEFAULT_MODEL = "cohere/rerank-4-pro";

export type RerankItem<T = string> = {
  index: number;
  relevanceScore: number;
  document: T;
};

export type RerankInput<T = string> = {
  query: string;
  documents: T[];
  topN?: number;
  model?: string;
  signal?: AbortSignal;
};

export const rerank = async <T = string>(
  input: RerankInput<T>,
): Promise<RerankItem<T>[]> => {
  if (input.documents.length === 0) return [];

  const documentsForApi = input.documents.map((d) =>
    typeof d === "string" ? d : JSON.stringify(d),
  );

  const body = {
    model: input.model ?? RERANK_DEFAULT_MODEL,
    query: input.query,
    documents: documentsForApi,
    top_n: input.topN ?? input.documents.length,
  };

  const response = await fetch(`${OPENROUTER_BASE_URL}/rerank`, {
    method: "POST",
    headers: openrouterHeaders(requireApiKey()),
    body: JSON.stringify(body),
    signal: input.signal,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `OpenRouter rerank ${response.status}: ${text.slice(0, 500)}`,
    );
  }

  const json = (await response.json()) as {
    results?: Array<{
      index: number;
      relevance_score: number;
      document?: { text: string } | string;
    }>;
  };

  const results = json.results ?? [];
  return results.map((r) => ({
    index: r.index,
    relevanceScore: r.relevance_score,
    document: input.documents[r.index] as T,
  }));
};
