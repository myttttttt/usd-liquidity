#!/usr/bin/env node
// 核對網頁數據與 FRED 最新一期是否一致。
// 用法：node scripts/verify-fred.mjs [liquidity.json 的網址或路徑]
// 預設讀本機 site/data/liquidity.json；上線後可傳入正式網址。
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseFredCsv } from "./lib.mjs";

const target = process.argv[2] ?? fileURLToPath(new URL("../site/data/liquidity.json", import.meta.url));
const data = /^https?:/.test(target)
  ? await (await fetch(target, { cache: "no-store" })).json()
  : JSON.parse(await readFile(target, "utf8"));
const s = data.summary;

const checks = [
  ["WRESBAL", s.reserves.date, s.reserves.value, 1e-3],
  ["WTREGEN", s.tga.date, s.tga.value, 1e-3],
  ["RRPONTSYD", s.onrrp.date, s.onrrp.value, 1],
  ["WALCL", s.netliq.date, s.netliq.walcl, 1e-3],
  ["SOFR", s.rates.date, s.rates.sofr, 1],
  ["IORB", s.rates.date, s.rates.iorb, 1],
  ["RPONTTLD", s.srf.date, s.srf.value, 1],
  ["DGS10", s.yields.date, s.yields.y10, 1],
  ["DGS30", s.yields.date, s.yields.y30, 1],
];

let bad = 0;
console.log(`來源：${target}\n數據生成時間：${data.meta.generated_at}\n`);
console.log("序列        網頁日期     網頁數值        FRED同日數值    FRED最新日期  結果");
for (const [id, date, value, scale] of checks) {
  const res = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=2026-01-01`);
  const rows = parseFredCsv(await res.text(), id);
  const same = rows.find((r) => r[0] === date);
  const fredVal = same ? Math.round(same[1] * scale * 1000) / 1000 : null;
  const ok = fredVal != null && Math.abs(fredVal - value) < 1e-6;
  const newer = rows.at(-1)[0] > date ? "（FRED已有較新一期）" : "";
  if (!ok) bad++;
  console.log(`${id.padEnd(11)} ${date}  ${String(value).padEnd(14)}  ${String(fredVal).padEnd(14)}  ${rows.at(-1)[0]}    ${ok ? "一致" : "不一致"}${newer}`);
}
console.log(bad ? `\n❌ ${bad} 項不一致` : "\n✅ 全部與 FRED 同日數值一致");
process.exit(bad ? 1 : 0);
