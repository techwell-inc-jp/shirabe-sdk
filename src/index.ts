/**
 * Shirabe official thin SDK — 依存ゼロの型付き fetch wrapper。
 *
 * 目玉は複合 enrich(`POST /api/v1/enrich`): 住所・人名・法人番号・暦を 1 メソッド
 * `client.enrich(record)` で横断正規化する。coding agent が npm からそのまま利用できる。
 *
 * - ランタイム依存ゼロ(グローバル fetch を使用、注入も可)。
 * - Node 18+ / Cloudflare Workers / Deno / モダンブラウザで動作。
 */

/** Shirabe family の API 名(enrich の component)。 */
export type EnrichComponent = "address" | "name" | "corporation" | "calendar";

/** enrich の入力レコード。全フィールド optional、1 つ以上必須。 */
export interface EnrichRecord {
  /** 住所(正規化対象)。 */
  address?: string;
  /** 人名(姓名分割・読み推定)。 */
  name?: string;
  /** 法人名(corporate_number と択一)。 */
  company_name?: string;
  /** 法人番号(13 桁)。 */
  corporate_number?: string;
  /** 日付(YYYY-MM-DD)。 */
  date?: string;
}

/** 各 component の処理状態。 */
export type EnrichComponentStatus = "ok" | "skipped" | "unavailable" | "error";

/** component 結果。status === "ok" のとき component 固有のペイロードを持つ。 */
export interface EnrichComponentResult {
  status: EnrichComponentStatus;
  reason?: string;
  [payload: string]: unknown;
}

/** enrich レスポンス本体。 */
export interface EnrichResponse {
  results: Partial<Record<EnrichComponent, EnrichComponentResult>>;
  attribution: Array<Record<string, unknown>>;
}

/** enrich の呼び出しオプション。 */
export interface EnrichOptions {
  /** 対象 component を限定。省略時は record の入力から自動推定。 */
  fields?: EnrichComponent[];
  /** この呼び出しに限り中断シグナルを渡す。 */
  signal?: AbortSignal;
}

/** ShirabeClient の構築オプション。 */
export interface ShirabeClientOptions {
  /**
   * API キー。`X-API-Key` ヘッダに付与する。
   * enrich は Hub Pro/Enterprise license(`shrb_lic_...`)専用(匿名は体験枠 500 回/月)。
   */
  apiKey?: string;
  /** ベース URL(既定 https://shirabe.dev)。 */
  baseUrl?: string;
  /** fetch 実装の注入(グローバル fetch が無い環境向け)。 */
  fetch?: typeof fetch;
  /**
   * 全リクエストに付与する既定ヘッダ。
   *
   * tool wrapper(`shirabe-sdk/ai` / `shirabe-sdk/langchain`)は利用元チャネルを
   * サーバー側の計測に伝えるため `X-Client`(例 `ai-sdk` / `langchain`)を注入する。
   * `X-API-Key` / `Content-Type` はリクエスト側の指定が優先される。
   */
  defaultHeaders?: Record<string, string>;
}

/**
 * Shirabe API が非 2xx を返したときに throw されるエラー。
 *
 * `body` に解析済みレスポンス本体を保持するため、429/403 の `license_recommend` や
 * 503 の per-component `results` を catch 側で参照できる。
 */
export class ShirabeError extends Error {
  /** API のエラーコード(`error.code`)。解析できない場合は "HTTP_ERROR"。 */
  readonly code: string;
  /** HTTP ステータスコード。 */
  readonly status: number;
  /** 解析済みレスポンス本体(JSON でなければ文字列)。 */
  readonly body: unknown;

  constructor(message: string, code: string, status: number, body: unknown) {
    super(message);
    this.name = "ShirabeError";
    this.code = code;
    this.status = status;
    this.body = body;
  }
}

const DEFAULT_BASE_URL = "https://shirabe.dev";

/**
 * Shirabe API クライアント(thin、依存ゼロ)。
 *
 * @example
 * const shirabe = new ShirabeClient({ apiKey: process.env.SHIRABE_API_KEY });
 * const out = await shirabe.enrich({
 *   address: "東京都港区六本木6-10-1",
 *   name: "山田太郎",
 *   corporate_number: "1234567890123",
 *   date: "2026-07-01",
 * });
 * out.results.address?.status; // "ok"
 */
export class ShirabeClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly defaultHeaders: Record<string, string>;

  constructor(options: ShirabeClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.defaultHeaders = { ...options.defaultHeaders };
    const f = options.fetch ?? globalThis.fetch;
    if (typeof f !== "function") {
      throw new Error(
        "global fetch is not available; pass a fetch implementation via { fetch } (Node < 18 etc.)"
      );
    }
    this.fetchImpl = f;
  }

  /**
   * 複合 enrich — 住所・人名・法人番号・暦を 1 コールで横断正規化する。
   *
   * Hub Pro/Enterprise license 専用(匿名は体験枠 500 回/月/IP)。component は部分成功し、
   * 全 component 利用不能(HTTP 503)時は {@link ShirabeError}(`body.results` 参照可)。
   *
   * @param record 1 つ以上のフィールドを持つレコード
   * @param options fields の明示指定 / AbortSignal
   * @returns 合成結果(results + 集約 attribution)
   * @throws {ShirabeError} 非 2xx(400/401/403/429/503)時
   */
  enrich(record: EnrichRecord, options: EnrichOptions = {}): Promise<EnrichResponse> {
    const payload: { record: EnrichRecord; fields?: EnrichComponent[] } = { record };
    if (options.fields) payload.fields = options.fields;
    return this.request<EnrichResponse>("POST", "/api/v1/enrich", {
      body: payload,
      signal: options.signal,
    });
  }

  /**
   * 単日の暦情報(六曜・暦注・干支・二十四節気・用途別スコア)を取得する。
   *
   * @param date YYYY-MM-DD
   * @param options categories(用途カテゴリの絞り込み)/ AbortSignal
   */
  calendar(
    date: string,
    options: { categories?: string[]; signal?: AbortSignal } = {}
  ): Promise<unknown> {
    const query = options.categories?.length
      ? `?categories=${encodeURIComponent(options.categories.join(","))}`
      : "";
    return this.request("GET", `/api/v1/calendar/${encodeURIComponent(date)}${query}`, {
      signal: options.signal,
    });
  }

  /**
   * 単一住所を正規化する(ABR 準拠、CC BY 4.0 attribution 同梱)。
   *
   * @param address 正規化対象の住所
   * @param options AbortSignal
   */
  normalizeAddress(address: string, options: { signal?: AbortSignal } = {}): Promise<unknown> {
    return this.request("POST", "/api/v1/address/normalize", {
      body: { address },
      signal: options.signal,
    });
  }

  /**
   * 氏名を姓と名に分割する(IPAdic ベース)。
   *
   * @param name フルネーム(例 "山田太郎")
   * @param options AbortSignal
   */
  splitName(name: string, options: { signal?: AbortSignal } = {}): Promise<unknown> {
    return this.request("POST", "/api/v1/text/name-split", {
      body: { name },
      signal: options.signal,
    });
  }

  /**
   * 氏名の読み(ふりがな)を推定する(IPAdic + JMnedict 2 段照合、異読 candidates 付き)。
   *
   * 読みが一意に定まらない前提で、最頻の読み + 収載読みの全網羅 + 出典を返す。
   *
   * @param name フルネーム(例 "東海林裕子")
   * @param options AbortSignal
   */
  nameReading(name: string, options: { signal?: AbortSignal } = {}): Promise<unknown> {
    return this.request("POST", "/api/v1/text/name-reading", {
      body: { name },
      signal: options.signal,
    });
  }

  /**
   * 法人番号(13 桁)の形式・checksum(mod 9)・実在を 3 段判定する。
   *
   * @param lawId 法人番号(13 桁)
   * @param options AbortSignal
   */
  validateCorporation(lawId: string, options: { signal?: AbortSignal } = {}): Promise<unknown> {
    return this.request("POST", "/api/v1/corporation/validate", {
      body: { law_id: lawId },
      signal: options.signal,
    });
  }

  /**
   * 法人番号(13 桁)から法人情報(商号・所在地・法人種別・閉鎖情報)を lookup する。
   *
   * @param lawId 法人番号(13 桁)
   * @param options AbortSignal
   */
  lookupCorporation(lawId: string, options: { signal?: AbortSignal } = {}): Promise<unknown> {
    return this.request("POST", "/api/v1/corporation/lookup", {
      body: { law_id: lawId },
      signal: options.signal,
    });
  }

  /**
   * 低レベルリクエスト(任意の Shirabe エンドポイントを叩く escape hatch)。
   *
   * @throws {ShirabeError} 非 2xx 時(body を保持)
   */
  async request<T = unknown>(
    method: string,
    path: string,
    options: { body?: unknown; signal?: AbortSignal } = {}
  ): Promise<T> {
    const headers: Record<string, string> = { ...this.defaultHeaders };
    if (this.apiKey) headers["X-API-Key"] = this.apiKey;
    const init: RequestInit = { method, headers, signal: options.signal };
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(options.body);
    }

    const res = await this.fetchImpl(`${this.baseUrl}${path}`, init);
    const parsed = await parseBody(res);

    if (!res.ok) {
      throw new ShirabeError(errorMessage(parsed, res.status), errorCode(parsed), res.status, parsed);
    }
    return parsed as T;
  }
}

/** レスポンス本体を JSON として解析する(JSON でなければ文字列で返す)。 */
async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** 解析済み body から `error.code` を取り出す(無ければ "HTTP_ERROR")。 */
function errorCode(body: unknown): string {
  const err = (body as { error?: { code?: unknown } } | null)?.error;
  return typeof err?.code === "string" ? err.code : "HTTP_ERROR";
}

/** 解析済み body から `error.message` を取り出す(無ければ status からの既定文)。 */
function errorMessage(body: unknown, status: number): string {
  const err = (body as { error?: { message?: unknown } } | null)?.error;
  return typeof err?.message === "string" ? err.message : `Shirabe API responded ${status}`;
}
