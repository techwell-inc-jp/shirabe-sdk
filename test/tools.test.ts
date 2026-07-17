import { describe, it, expect, vi } from "vitest";
import { ShirabeClient } from "../src/index";
import { shirabeAITools } from "../src/ai";
import { shirabeLangChainTools } from "../src/langchain";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeFetch(body: unknown, status = 200) {
  return vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => jsonResponse(body, status));
}

function firstCall(fn: ReturnType<typeof makeFetch>): { url: string; init: RequestInit } {
  const [url, init] = fn.mock.calls[0];
  return { url: String(url), init: (init ?? {}) as RequestInit };
}

function header(init: RequestInit, name: string): string | undefined {
  return (init.headers as Record<string, string> | undefined)?.[name];
}

// ---------------------------------------------------------------------------
// core: 新 convenience メソッド + defaultHeaders
// ---------------------------------------------------------------------------

describe("ShirabeClient — single-API methods", () => {
  it("splitName posts { name } to /api/v1/text/name-split", async () => {
    const fetchImpl = makeFetch({ family: "山田", given: "太郎" });
    const client = new ShirabeClient({ fetch: fetchImpl });
    await client.splitName("山田太郎");
    const { url, init } = firstCall(fetchImpl);
    expect(url).toBe("https://shirabe.dev/api/v1/text/name-split");
    expect(JSON.parse(init.body as string)).toEqual({ name: "山田太郎" });
  });

  it("nameReading posts { name } to /api/v1/text/name-reading", async () => {
    const fetchImpl = makeFetch({ reading: "しょうじゆうこ", candidates: [] });
    const client = new ShirabeClient({ fetch: fetchImpl });
    await client.nameReading("東海林裕子");
    expect(firstCall(fetchImpl).url).toBe("https://shirabe.dev/api/v1/text/name-reading");
  });

  it("validateCorporation posts { law_id } to /api/v1/corporation/validate", async () => {
    const fetchImpl = makeFetch({ valid: true });
    const client = new ShirabeClient({ fetch: fetchImpl });
    await client.validateCorporation("1234567890123");
    const { url, init } = firstCall(fetchImpl);
    expect(url).toBe("https://shirabe.dev/api/v1/corporation/validate");
    expect(JSON.parse(init.body as string)).toEqual({ law_id: "1234567890123" });
  });

  it("lookupCorporation posts { law_id } to /api/v1/corporation/lookup", async () => {
    const fetchImpl = makeFetch({ corporation: {}, attribution: [] });
    const client = new ShirabeClient({ fetch: fetchImpl });
    await client.lookupCorporation("1234567890123");
    expect(firstCall(fetchImpl).url).toBe("https://shirabe.dev/api/v1/corporation/lookup");
  });

  it("defaultHeaders are attached to every request", async () => {
    const fetchImpl = makeFetch({ ok: true });
    const client = new ShirabeClient({ fetch: fetchImpl, defaultHeaders: { "X-Client": "custom" } });
    await client.splitName("山田太郎");
    expect(header(firstCall(fetchImpl).init, "X-Client")).toBe("custom");
  });
});

// ---------------------------------------------------------------------------
// Vercel AI SDK アダプタ
// ---------------------------------------------------------------------------

const TOOL_NAMES = [
  "shirabe_normalize_address",
  "shirabe_split_name",
  "shirabe_name_reading",
  "shirabe_validate_corporation",
  "shirabe_lookup_corporation",
  "shirabe_calendar",
  "shirabe_enrich",
];

describe("shirabeAITools (Vercel AI SDK)", () => {
  it("exposes all 7 tools with descriptions", () => {
    const tools = shirabeAITools({ fetch: makeFetch({}) });
    expect(Object.keys(tools).sort()).toEqual([...TOOL_NAMES].sort());
    for (const name of TOOL_NAMES) {
      expect(typeof tools[name].description).toBe("string");
      expect((tools[name].description as string).length).toBeGreaterThan(0);
    }
  });

  it("execute() calls the endpoint and injects X-Client: ai-sdk", async () => {
    const fetchImpl = makeFetch({ reading: "しょうじゆうこ" });
    const tools = shirabeAITools({ fetch: fetchImpl });
    const out = await tools.shirabe_name_reading.execute!(
      { name: "東海林裕子" },
      { toolCallId: "t1", messages: [] } as any
    );
    expect((out as { reading: string }).reading).toBe("しょうじゆうこ");
    const { url, init } = firstCall(fetchImpl);
    expect(url).toBe("https://shirabe.dev/api/v1/text/name-reading");
    expect(header(init, "X-Client")).toBe("ai-sdk");
  });

  it("enrich tool splits fields out of the record", async () => {
    const fetchImpl = makeFetch({ results: {}, attribution: [] });
    const tools = shirabeAITools({ fetch: fetchImpl });
    await tools.shirabe_enrich.execute!(
      { name: "山田太郎", fields: ["name"] },
      { toolCallId: "t1", messages: [] } as any
    );
    const { url, init } = firstCall(fetchImpl);
    expect(url).toBe("https://shirabe.dev/api/v1/enrich");
    expect(JSON.parse(init.body as string)).toEqual({ record: { name: "山田太郎" }, fields: ["name"] });
  });
});

// ---------------------------------------------------------------------------
// LangChain アダプタ
// ---------------------------------------------------------------------------

describe("shirabeLangChainTools (LangChain)", () => {
  it("exposes all 7 tools as named DynamicStructuredTools", () => {
    const tools = shirabeLangChainTools({ fetch: makeFetch({}) });
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
  });

  it("invoke() returns a JSON string and injects X-Client: langchain", async () => {
    const fetchImpl = makeFetch({ family: "山田", given: "太郎" });
    const tools = shirabeLangChainTools({ fetch: fetchImpl });
    const splitTool = tools.find((t) => t.name === "shirabe_split_name")!;
    const out = await splitTool.invoke({ name: "山田太郎" });
    expect(typeof out).toBe("string");
    expect(JSON.parse(out as string)).toEqual({ family: "山田", given: "太郎" });
    expect(header(firstCall(fetchImpl).init, "X-Client")).toBe("langchain");
  });
});
