/**
 * Shirabe tool 群 — LangChain(`@langchain/core`)アダプタ。
 *
 * @example
 * import { shirabeLangChainTools } from "shirabe-sdk/langchain";
 * import { ChatOpenAI } from "@langchain/openai";
 *
 * const tools = shirabeLangChainTools();
 * const model = new ChatOpenAI({ model: "gpt-4o" }).bindTools(tools);
 *
 * peer dependency: `@langchain/core` (>=0.3) と `zod`。利用元チャネルは
 * `X-Client: langchain` でサーバー側の計測に伝わる(toolHint=langchain)。
 */
import { tool, type DynamicStructuredTool } from "@langchain/core/tools";
import { ShirabeClient, type ShirabeClientOptions } from "./index.js";
import { toolSpecs } from "./tool-specs.js";

/**
 * LangChain 用の Shirabe tool 群を生成する。
 *
 * 返り値は `.bindTools(...)` や AgentExecutor にそのまま渡せる tool の配列。
 * 各 tool は結果を JSON 文字列で返す(LangChain の tool 出力規約に合わせる)。
 *
 * @param options ShirabeClient のオプション(apiKey / baseUrl / fetch / defaultHeaders)
 * @returns DynamicStructuredTool の配列
 */
export function shirabeLangChainTools(
  options: ShirabeClientOptions = {}
): DynamicStructuredTool[] {
  const { defaultHeaders, ...rest } = options;
  const client = new ShirabeClient({
    ...rest,
    defaultHeaders: { "X-Client": "langchain", ...defaultHeaders },
  });

  return toolSpecs.map((spec) =>
    tool(async (args: unknown) => JSON.stringify(await spec.invoke(client, args)), {
      name: spec.name,
      description: spec.description,
      schema: spec.schema,
    })
  ) as DynamicStructuredTool[];
}
