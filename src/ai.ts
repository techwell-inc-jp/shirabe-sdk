/**
 * Shirabe tool 群 — Vercel AI SDK(`ai`)アダプタ。
 *
 * @example
 * import { generateText } from "ai";
 * import { openai } from "@ai-sdk/openai";
 * import { shirabeAITools } from "shirabe-sdk/ai";
 *
 * const result = await generateText({
 *   model: openai("gpt-4o"),
 *   tools: shirabeAITools(),
 *   prompt: "東海林裕子 さんの氏名の読みを調べて。",
 * });
 *
 * peer dependency: `ai` (>=5) と `zod`。利用元チャネルは `X-Client: ai-sdk` で
 * サーバー側の計測に伝わる(toolHint=ai-sdk)。
 */
import { tool, type Tool } from "ai";
import { ShirabeClient, type ShirabeClientOptions } from "./index.js";
import { toolSpecs } from "./tool-specs.js";

/**
 * Vercel AI SDK 用の Shirabe tool 群を生成する。
 *
 * 返り値は `generateText` / `streamText` の `tools` にそのまま渡せる ToolSet。
 *
 * @param options ShirabeClient のオプション(apiKey / baseUrl / fetch / defaultHeaders)
 * @returns tool 名をキーとする ToolSet
 */
export function shirabeAITools(options: ShirabeClientOptions = {}): Record<string, Tool> {
  const { defaultHeaders, ...rest } = options;
  const client = new ShirabeClient({
    ...rest,
    defaultHeaders: { "X-Client": "ai-sdk", ...defaultHeaders },
  });

  const tools: Record<string, Tool> = {};
  for (const spec of toolSpecs) {
    tools[spec.name] = tool({
      description: spec.description,
      inputSchema: spec.schema,
      execute: async (args: unknown) => spec.invoke(client, args),
    });
  }
  return tools;
}
