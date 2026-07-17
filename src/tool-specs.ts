/**
 * Shirabe tool 群の共有仕様 — framework 非依存。
 *
 * `shirabe-sdk/ai`(Vercel AI SDK)と `shirabe-sdk/langchain`(LangChain)の両アダプタが
 * この 1 箇所の仕様(name / description / zod schema / invoke)から tool を生成する。
 * zod に依存するため core(`shirabe-sdk`)からは import しない(core は依存ゼロを維持)。
 */
import { z } from "zod";
import type { ShirabeClient, EnrichComponent } from "./index.js";

/** framework 非依存の tool 仕様。 */
export interface ShirabeToolSpec {
  /** tool 名(snake_case、`shirabe_` prefix)。 */
  name: string;
  /** LLM 向けの説明(英語、いつ呼ぶべきかを明示)。 */
  description: string;
  /** 入力スキーマ(zod)。 */
  schema: z.ZodTypeAny;
  /** client と検証済み引数から API を呼ぶ。 */
  invoke: (client: ShirabeClient, args: any) => Promise<unknown>;
}

const enrichComponents: readonly EnrichComponent[] = ["address", "name", "corporation", "calendar"];

/**
 * Shirabe が公開する tool 群(live で匿名呼出可能なエンドポイントに対応)。
 *
 * すべて日本固有データの「確定値」を構造化 JSON で返す。読み・法人番号など
 * LLM が幻覚しやすい値を、出典付きの権威データで裏取りするのが用途。
 */
export const toolSpecs: readonly ShirabeToolSpec[] = [
  {
    name: "shirabe_normalize_address",
    description:
      "Normalize a Japanese address into structured components (prefecture, city, town, etc.) " +
      "using the official ABR (Address Base Registry) data. Returns the canonical form plus " +
      "attribution. Use when you need the authoritative parsed form of a Japanese address string.",
    schema: z.object({
      address: z.string().describe("A Japanese address string, e.g. 東京都港区六本木6-10-1"),
    }),
    invoke: (client, args) => client.normalizeAddress(args.address),
  },
  {
    name: "shirabe_split_name",
    description:
      "Split a Japanese full name into family name and given name (IPAdic-based). " +
      "Use when you have a full Japanese personal name and need the surname/given-name boundary.",
    schema: z.object({
      name: z.string().describe("A Japanese full name, e.g. 山田太郎"),
    }),
    invoke: (client, args) => client.splitName(args.name),
  },
  {
    name: "shirabe_name_reading",
    description:
      "Estimate the reading (furigana) of a Japanese personal name via IPAdic + JMnedict " +
      "two-stage lookup. Japanese name readings are NOT unique, so this returns the most likely " +
      "reading PLUS the full set of attested reading candidates and the source. " +
      "Use instead of guessing a reading; never assume a single reading.",
    schema: z.object({
      name: z.string().describe("A Japanese full name, e.g. 東海林裕子"),
    }),
    invoke: (client, args) => client.nameReading(args.name),
  },
  {
    name: "shirabe_validate_corporation",
    description:
      "Validate a Japanese corporate number (houjin bangou, 13 digits): format, mod-9 checksum, " +
      "and existence in the National Tax Agency registry. Use to check a corporate number before " +
      "trusting it; LLMs frequently miscompute the checksum.",
    schema: z.object({
      law_id: z.string().describe("A 13-digit Japanese corporate number, e.g. 1234567890123"),
    }),
    invoke: (client, args) => client.validateCorporation(args.law_id),
  },
  {
    name: "shirabe_lookup_corporation",
    description:
      "Look up a Japanese corporation by its corporate number (houjin bangou, 13 digits) and return " +
      "the registered company name, address, corporate type, and closure info, with attribution. " +
      "Use to resolve a corporate number to authoritative company details.",
    schema: z.object({
      law_id: z.string().describe("A 13-digit Japanese corporate number, e.g. 1234567890123"),
    }),
    invoke: (client, args) => client.lookupCorporation(args.law_id),
  },
  {
    name: "shirabe_calendar",
    description:
      "Get Japanese calendar information for a single date: rokuyo (六曜), koyomi notes, zodiac, " +
      "solar terms, and per-purpose auspiciousness scores. Use for questions about Japanese " +
      "calendar/almanac values on a given date (e.g. is it a good day for a wedding?).",
    schema: z.object({
      date: z.string().describe("A date in YYYY-MM-DD, e.g. 2026-07-01"),
      categories: z
        .array(z.string())
        .optional()
        .describe("Optional purpose categories to score, e.g. ['wedding','moving']"),
    }),
    invoke: (client, args) => client.calendar(args.date, { categories: args.categories }),
  },
  {
    name: "shirabe_enrich",
    description:
      "Composite enrichment: normalize a Japanese address, split/read a name, resolve a corporate " +
      "number, and look up calendar info in ONE call. Provide any subset of fields. Requires a Hub " +
      "Pro/Enterprise license API key (anonymous callers get a 500/month trial). Use when a record " +
      "mixes several Japanese identifiers and you want them all normalized together.",
    schema: z.object({
      address: z.string().optional().describe("Japanese address to normalize"),
      name: z.string().optional().describe("Japanese personal name to split/read"),
      company_name: z.string().optional().describe("Company name (alternative to corporate_number)"),
      corporate_number: z.string().optional().describe("13-digit Japanese corporate number"),
      date: z.string().optional().describe("Date (YYYY-MM-DD) for calendar info"),
      fields: z
        .array(z.enum(enrichComponents as [EnrichComponent, ...EnrichComponent[]]))
        .optional()
        .describe("Limit which components to process; defaults to those inferred from the record"),
    }),
    invoke: (client, args) => {
      const { fields, ...record } = args;
      return client.enrich(record, fields ? { fields } : {});
    },
  },
];
