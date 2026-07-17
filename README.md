# shirabe-sdk

Official thin SDK for [Shirabe](https://shirabe.dev) — the Japan-specific, AI-native API platform.
Zero runtime dependencies. Works on Node 18+, Cloudflare Workers, Deno, and modern browsers.

The headline is **composite enrich**: normalize a messy customer record across four Japanese
identifiers — **address, personal name, corporate number, calendar date** — in a single call.

```bash
npm install shirabe-sdk
```

## Quick start

```ts
import { ShirabeClient } from "shirabe-sdk";

const shirabe = new ShirabeClient({ apiKey: process.env.SHIRABE_API_KEY });

const out = await shirabe.enrich({
  address: "東京都港区六本木6-10-1 森タワー",
  name: "山田太郎",
  corporate_number: "1234567890123",
  date: "2026-07-01",
});

out.results.address?.status;       // "ok" | "skipped" | "unavailable" | "error"
out.results.name?.split;           // { family: "山田", given: "太郎", ... }
out.attribution;                   // aggregated CC BY 4.0 / dictionary attribution (do not strip)
```

`fields` is auto-detected from the record. Pass it explicitly to limit components:

```ts
await shirabe.enrich({ name: "山田太郎", date: "2026-07-01" }, { fields: ["name", "calendar"] });
```

## Access & pricing

`enrich` is a **Hub Pro / Hub Enterprise** license capability (`X-API-Key: shrb_lic_...`),
with an **anonymous trial of 500 calls/month per IP** for evaluation. Each component degrades
independently; if every requested component is unavailable the call throws with HTTP 503 and the
per-component `results` are available on the error's `body`.

See <https://shirabe.dev/pricing> for SKUs and an AI-callable quote endpoint.

## Errors

Non-2xx responses throw `ShirabeError` with the parsed body attached:

```ts
import { ShirabeError } from "shirabe-sdk";

try {
  await shirabe.enrich({ address: "..." });
} catch (err) {
  if (err instanceof ShirabeError) {
    err.code;                                  // e.g. "ENRICH_TRIAL_LIMIT_EXCEEDED"
    err.status;                                // HTTP status
    (err.body as any)?.error?.license_recommend; // hub_pro recommendation on 403/429
  }
}
```

## Agent framework tools (Vercel AI SDK / LangChain)

Ready-made tool definitions let an LLM agent call Shirabe directly — so it can look up an
authoritative Japanese name reading, corporate number, or address instead of hallucinating one.
The framework packages (`ai`, `@langchain/core`) are **optional peer dependencies**; the core stays
zero-dependency.

**Vercel AI SDK** (`shirabe-sdk/ai`):

```ts
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { shirabeAITools } from "shirabe-sdk/ai";

const { text } = await generateText({
  model: openai("gpt-4o"),
  tools: shirabeAITools({ apiKey: process.env.SHIRABE_API_KEY }), // apiKey optional for anonymous tools
  prompt: "東海林裕子 さんの氏名の読みを調べて。",
});
```

**LangChain** (`shirabe-sdk/langchain`):

```ts
import { shirabeLangChainTools } from "shirabe-sdk/langchain";
import { ChatOpenAI } from "@langchain/openai";

const model = new ChatOpenAI({ model: "gpt-4o" }).bindTools(shirabeLangChainTools());
```

Both expose the same seven tools: `shirabe_normalize_address`, `shirabe_split_name`,
`shirabe_name_reading`, `shirabe_validate_corporation`, `shirabe_lookup_corporation`,
`shirabe_calendar`, and `shirabe_enrich`.

## Other endpoints

The SDK also exposes thin wrappers for individual APIs:

```ts
await shirabe.calendar("2026-07-01", { categories: ["wedding"] }); // 六曜・暦注・用途別スコア
await shirabe.normalizeAddress("東京都港区六本木6-10-1");           // ABR 準拠の住所正規化
await shirabe.splitName("山田太郎");                                // 姓名分割
await shirabe.nameReading("東海林裕子");                            // 氏名の読み(異読 candidates 付き)
await shirabe.validateCorporation("1234567890123");               // 法人番号の形式・checksum・実在
await shirabe.lookupCorporation("1234567890123");                 // 法人番号 → 商号・所在地
await shirabe.request("GET", "/api/v1/...");                       // low-level escape hatch
```

## Custom environments

Pass a `fetch` implementation if your runtime has no global `fetch`, and override `baseUrl` for staging:

```ts
new ShirabeClient({ fetch: myFetch, baseUrl: "https://staging.shirabe.dev" });
```

## License

MIT © Techwell Inc. Address data normalization is derived from the Digital Agency Address Base
Registry (CC BY 4.0); the `attribution` field returned by the API must not be stripped downstream.
