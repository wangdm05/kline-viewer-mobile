import { createReadStream, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import Papa from 'papaparse';
import { parseDateTime, formatDate, formatDateTimeSeconds } from '../src/utils/time.ts';
import { aggregateDaily, tradingDayKey } from '../src/utils/tradingDay.ts';
import type { DailyRow } from '../src/utils/tradingDay.ts';
import type { KlineRow } from '../src/utils/parseCsv.ts';

const source = process.argv[2];
if (!source) throw new Error('Usage: node scripts/prepare-builtin.mts /path/to/OI_Full.csv');
const output = path.resolve('public/data/oi-full');
mkdirSync(output, { recursive: true });
const columns = ['datetime', 'open', 'high', 'low', 'close', 'volume', 'openInterest', 'amount', 'symbol'];
const months: { month: string; file: string; rows: number; first: string; last: string }[] = [];
const daily: DailyRow[] = [];
let currentMonth = '';
let monthRows: string[][] = [];
let currentDay = '';
let dayRows: KlineRow[] = [];
let count = 0;
let lastTime = -Infinity;
let first = '';
let last = '';
const flushMonth = () => {
  if (!monthRows.length) return;
  const csv = Papa.unparse({ fields: columns, data: monthRows }, { newline: '\n' });
  writeFileSync(path.join(output, `${currentMonth}.csv`), csv + '\n');
  months.push({ month: currentMonth, file: `${currentMonth}.csv`, rows: monthRows.length,
    first: monthRows[0][0], last: monthRows[monthRows.length - 1][0] });
  monthRows = [];
};
const flushDay = () => { daily.push(...aggregateDaily(dayRows)); dayRows = []; };
await new Promise<void>((resolve, reject) => {
  Papa.parse<Record<string, string>>(createReadStream(source, { encoding: 'utf8' }), {
    header: true, skipEmptyLines: true,
    step(result, parser) {
      try {
        if (result.errors.length) throw new Error(result.errors[0].message);
        const record = result.data;
        const date = parseDateTime(record.datetime);
        if (!date) throw new Error(`Invalid datetime at row ${count + 2}`);
        const time = date.getTime() / 1000;
        if (time <= lastTime) throw new Error(`Duplicate or unsorted timestamp: ${record.datetime}`);
        const values = ['open', 'high', 'low', 'close', 'volume', 'position'].map(key => {
          const value = Number(record[key]);
          if (!record[key]?.trim() || !Number.isFinite(value)) throw new Error(`Invalid ${key} at ${record.datetime}`);
          return value;
        });
        const [open, high, low, close, volume, openInterest] = values;
        const rawTime = formatDateTimeSeconds(date);
        const month = rawTime.slice(0, 7);
        if (month !== currentMonth) { flushMonth(); currentMonth = month; }
        monthRows.push([rawTime, ...values.map(String), record.amount ?? '', record.symbol ?? '']);
        const dayKey = tradingDayKey(date);
        if (dayKey !== currentDay) { flushDay(); currentDay = dayKey; }
        dayRows.push({ time, open, high, low, close, volume, openInterest,
          rawTime, dayKey: formatDate(date), isNight: date.getHours() >= 18 || date.getHours() < 9 });
        if (!count) first = rawTime;
        last = rawTime;
        lastTime = time;
        count++;
      } catch (error) { reject(error); parser.abort(); }
    },
    complete() { resolve(); }, error: reject,
  });
});
flushMonth(); flushDay();
const hash = createHash('sha256');
for await (const bytes of createReadStream(source)) hash.update(bytes);
const manifest = { version: 1, name: 'OI_Full', sourceFile: path.basename(source),
  sourceBytes: statSync(source).size, sourceSha256: hash.digest('hex'), rows: count,
  first, last, defaultMonth: months[months.length - 1].month, months, daily };
writeFileSync(path.join(output, 'index.json'), JSON.stringify(manifest));
console.log(JSON.stringify({ rows: count, months: months.length, days: daily.length, first, last, output }));
