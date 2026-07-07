import { describe, it, expect, vi, afterEach } from "vitest";
import { ShirabeClient, ShirabeError } from "../src/index";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** typeof fetch に代入可能な、応答固定のモックを作る。 */
function makeFetch(body: unknown, status = 200) {
  return vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => jsonResponse(body, status));
}

/** モックの最初の呼び出し引数を取り出す(url は文字列化、init は非 undefined 化)。 */
function firstCall(fn: ReturnType<typeof makeFetch>): { url: string; init: RequestInit } {
  const [url, init] = fn.mock.calls[0];
  return { url: String(url), init: (init ?? {}) as RequestInit };
}

function header(init: RequestInit, name: string): string | undefined {
  return (init.headers as Record<string, string> | undefined)?.[name];
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ShirabeClient.enrich", () => {
  it("posts record to /api/v1/enrich with X-API-Key and returns the body", async () => {
    const fetchImpl = makeFetch({ results: { address: { status: "ok" } }, attribution: [] });
    const client = new ShirabeClient({ apiKey: "shrb_lic_abc", fetch: fetchImpl });

    const out = await client.enrich({ address: "東京都港区六本木6-10-1" });

    expect(out.results.address?.status).toBe("ok");
    const { url, init } = firstCall(fetchImpl);
    expect(url).toBe("https://shirabe.dev/api/v1/enrich");
    expect(init.method).toBe("POST");
    expect(header(init, "X-API-Key")).toBe("shrb_lic_abc");
    expect(header(init, "Content-Type")).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({ record: { address: "東京都港区六本木6-10-1" } });
  });

  it("includes fields when provided", async () => {
    const fetchImpl = makeFetch({ results: {}, attribution: [] });
    const client = new ShirabeClient({ fetch: fetchImpl });

    await client.enrich({ name: "山田太郎" }, { fields: ["name", "calendar"] });

    const { init } = firstCall(fetchImpl);
    expect(JSON.parse(init.body as string)).toEqual({
      record: { name: "山田太郎" },
      fields: ["name", "calendar"],
    });
  });

  it("omits X-API-Key when no apiKey (anonymous trial)", async () => {
    const fetchImpl = makeFetch({ results: {}, attribution: [] });
    const client = new ShirabeClient({ fetch: fetchImpl });
    await client.enrich({ date: "2026-07-01" });
    expect(header(firstCall(fetchImpl).init, "X-API-Key")).toBeUndefined();
  });

  it("throws ShirabeError on 429 and exposes license_recommend via body", async () => {
    const fetchImpl = makeFetch(
      {
        error: {
          code: "ENRICH_TRIAL_LIMIT_EXCEEDED",
          message: "trial limit reached",
          license_recommend: { sku: "hub_pro" },
        },
      },
      429
    );
    const client = new ShirabeClient({ fetch: fetchImpl });

    await expect(client.enrich({ address: "x" })).rejects.toMatchObject({
      name: "ShirabeError",
      code: "ENRICH_TRIAL_LIMIT_EXCEEDED",
      status: 429,
    });

    try {
      await client.enrich({ address: "x" });
    } catch (err) {
      expect(err).toBeInstanceOf(ShirabeError);
      const body = (err as ShirabeError).body as { error: { license_recommend: { sku: string } } };
      expect(body.error.license_recommend.sku).toBe("hub_pro");
    }
  });

  it("throws ShirabeError on 503 with per-component results accessible via body", async () => {
    const fetchImpl = makeFetch(
      { results: { address: { status: "unavailable" } }, attribution: [] },
      503
    );
    const client = new ShirabeClient({ fetch: fetchImpl });

    try {
      await client.enrich({ address: "x" });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ShirabeError);
      expect((err as ShirabeError).status).toBe(503);
      const body = (err as ShirabeError).body as { results: { address: { status: string } } };
      expect(body.results.address.status).toBe("unavailable");
    }
  });
});

describe("ShirabeClient — config", () => {
  it("uses a custom baseUrl and strips trailing slash", async () => {
    const fetchImpl = makeFetch({ results: {}, attribution: [] });
    const client = new ShirabeClient({ baseUrl: "https://staging.shirabe.dev/", fetch: fetchImpl });
    await client.enrich({ date: "2026-07-01" });
    expect(firstCall(fetchImpl).url).toBe("https://staging.shirabe.dev/api/v1/enrich");
  });

  it("throws at construction when no fetch is available and none injected", () => {
    vi.stubGlobal("fetch", undefined);
    expect(() => new ShirabeClient()).toThrow(/fetch/);
  });
});

describe("ShirabeClient — convenience methods", () => {
  it("calendar() issues a GET with categories query", async () => {
    const fetchImpl = makeFetch({ date: "2026-07-01" });
    const client = new ShirabeClient({ fetch: fetchImpl });
    await client.calendar("2026-07-01", { categories: ["wedding", "moving"] });
    const { url, init } = firstCall(fetchImpl);
    expect(url).toBe("https://shirabe.dev/api/v1/calendar/2026-07-01?categories=wedding%2Cmoving");
    expect(init.method).toBe("GET");
  });

  it("normalizeAddress() posts the address", async () => {
    const fetchImpl = makeFetch({ result: null, candidates: [] });
    const client = new ShirabeClient({ fetch: fetchImpl });
    await client.normalizeAddress("東京都港区六本木6-10-1");
    expect(JSON.parse(firstCall(fetchImpl).init.body as string)).toEqual({
      address: "東京都港区六本木6-10-1",
    });
  });
});
