import Papa, { type ParseResult as PapaResult, type Parser } from "papaparse";
import { formatDate, formatDateTimeSeconds, parseDateTime } from "./time";

export type KlineRow = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  openInterest?: number;
  rawTime: string;
  dayKey: string;
  isNight: boolean;
};

export type ParseResult =
  | { ok: true; data: KlineRow[]; warnings: string[] }
  | { ok: false; error: string; details: string[] };

const REQUIRED_COLUMNS = ["datetime", "open", "high", "low", "close", "volume"];
const OPTIONAL_OI = ["openinterest", "oi", "holding", "position", "持仓量"];
const normalizeColumn = (name: string) => name.toLowerCase().trim().replace(/[\s_-]/g, "");

const nightSession = (date: Date) => {
  const h = date.getHours();
  return h >= 18 || h < 9;
};

export const parseCsvFile = (
  file: File,
  onProgress: (value: number) => void
): Promise<ParseResult> => {
  if (!file.name.toLowerCase().endsWith(".csv")) {
    return Promise.resolve({
      ok: false,
      error: "文件格式不支持",
      details: ["仅支持 .csv 文件", "请导出或另存为 CSV 后重新上传"],
    });
  }
  const maxSize = 50 * 1024 * 1024;
  if (file.size > maxSize) {
    return Promise.resolve({
      ok: false,
      error: "文件过大",
      details: [
        `当前文件 ${(file.size / 1024 / 1024).toFixed(2)}MB，超出 50MB 限制`,
        "请裁剪数据范围或拆分文件后再导入",
      ],
    });
  }

  return new Promise((resolve) => {
    const rows: KlineRow[] = [];
    const warnings: string[] = [];
    const parseErrors: string[] = [];
    let headerChecked = false;
    let oiKey: string | null = null;
    let line = 1;
    let done = false;

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
      worker: true,
      chunkSize: 512 * 1024,
      chunk: (results: PapaResult<Record<string, string>>, parser: Parser) => {
        if (done) return;
        const meta = results.meta;
        if (meta && meta.cursor) {
          onProgress(Math.min(0.95, meta.cursor / file.size));
        }

        if (!headerChecked) {
          const fields = (results.meta.fields ?? []).map(normalizeColumn);
          const missing = REQUIRED_COLUMNS.filter((key) => !fields.includes(key));
          if (missing.length) {
            done = true;
            parser.abort();
            resolve({
              ok: false,
              error: "CSV 缺少必填列",
              details: [
                `缺失列：${missing.join(", ")}`,
                "请确认 CSV 包含 datetime, open, high, low, close, volume",
              ],
            });
            return;
          }
          oiKey = OPTIONAL_OI.find((key) => fields.includes(key)) ?? null;
          headerChecked = true;
        }

        for (const record of results.data) {
          line += 1;
          const normalized: Record<string, string> = {};
          for (const [key, value] of Object.entries(record)) {
            normalized[normalizeColumn(key)] = value;
          }
          const datetimeRaw = normalized["datetime"] ?? "";
          const dt = parseDateTime(datetimeRaw);
          if (!dt) {
            if (parseErrors.length < 6) {
              parseErrors.push(`第 ${line} 行时间格式无效：${datetimeRaw}`);
            }
            continue;
          }

          const num = (value: string, name: string) => {
            const parsed = Number(value);
            if (!value?.trim() || !Number.isFinite(parsed)) {
              if (parseErrors.length < 6) {
                parseErrors.push(`第 ${line} 行 ${name} 无法解析：${value}`);
              }
              return null;
            }
            return parsed;
          };

          const open = num(normalized["open"], "open");
          const high = num(normalized["high"], "high");
          const low = num(normalized["low"], "low");
          const close = num(normalized["close"], "close");
          const volume = num(normalized["volume"], "volume");
          if (open === null || high === null || low === null || close === null || volume === null) {
            continue;
          }

          const oiRaw = oiKey ? normalized[oiKey]?.trim() : undefined;
          const oi = oiRaw ? Number(oiRaw) : undefined;
          if (oiRaw && !Number.isFinite(oi) && warnings.length < 6) {
            warnings.push(`第 ${line} 行 openInterest 无法解析：${oiRaw}`);
          }

          const dayKey = formatDate(dt);
          rows.push({
            time: Math.floor(dt.getTime() / 1000),
            open,
            high,
            low,
            close,
            volume,
            openInterest: Number.isFinite(oi) ? oi : undefined,
            rawTime: formatDateTimeSeconds(dt),
            dayKey,
            isNight: nightSession(dt),
          });
        }
      },
      complete: () => {
        if (done) return;
        onProgress(1);
        if (!rows.length) {
          done = true;
          resolve({
            ok: false,
            error: "未解析到有效数据",
            details: [
              "请确认 CSV 中包含有效的 K 线数据行",
              "检查 datetime 列格式是否为 YYYY-MM-DD HH:mm:ss",
            ],
          });
          return;
        }
        if (parseErrors.length) {
          done = true;
          resolve({
            ok: false,
            error: "CSV 数据存在错误",
            details: parseErrors.concat("请修正后重新上传"),
          });
          return;
        }

        rows.sort((a, b) => a.time - b.time);
        const missingOI = rows.filter(row => row.openInterest === undefined).length;
        warnings.push(`成交量来源：volume；持仓量来源：${oiKey ?? "未找到持仓量列"}（分别读取）`);
        if (missingOI) warnings.push(`有 ${missingOI} 条记录缺少有效持仓量，缺失值不填零，也不以成交量代替。`);
        if (rows.length >= 2) {
          const first = new Date(rows[0].time * 1000);
          const last = new Date(rows[rows.length - 1].time * 1000);
          warnings.push(
            `数据范围：${formatDateTimeSeconds(first)} 至 ${formatDateTimeSeconds(last)}`
          );
        }
        done = true;
        resolve({ ok: true, data: rows, warnings });
      },
      error: (error: Error) => {
        if (done) return;
        done = true;
        resolve({
          ok: false,
          error: "文件解析失败",
          details: [error.message, "请确认文件编码为 UTF-8"],
        });
      },
    });
  });
};
