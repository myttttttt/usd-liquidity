#!/usr/bin/env node
// 核對網頁數據與 FRED 最新一期是否一致。
// 用法：node scripts/verify-fred.mjs [liquidity.json 的網址或路徑]
// 預設讀本機 site/data/liquidity.json；上線後可傳入正式網址。
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseFredCsv, parseTreasuryTga } from "./lib.mjs";

const target = process.argv[2] ?? fileURLToPath(new URL("../site/data/liquidity.json", import.meta.url));
const data = /^https?:/.test(target)
  ? await (await fetch(target, { cache: "no-store" })).json()
  : JSON.parse(await readFile(target, "utf8"));
const s = data.summary;

const checks = [
  ["WRESBAL", s.reserves.date, s.reserves.value, 1e-3],
  ["WTREGEN", s.tga.date, s.tga.value, 1e-3],
  ["RRPONTSYD", s.onrrp.date, s.onrrp.value, 1],
  ["WALCL", s.netliq.walcl_date, s.netliq.walcl, 1e-3],
  ["SOFR", s.rates.date, s.rates.sofr, 1],
  ["IORB", s.rates.date, s.rates.iorb, 1],
  ["RPONTTLD", s.srf.date, s.srf.value, 1],
  ["DGS10", s.yields.date, s.yields.y10, 1],
  ["DGS30", s.yields.date, s.yields.y30, 1],
  ...(s.compare?.btc ? [["CBBTCUSD", s.compare.btc.date, s.compare.btc.value, 1]] : []),
  ...(s.compare?.eth ? [["CBETHUSD", s.compare.eth.date, s.compare.eth.value, 1]] : []),
  ...(s.compare?.usd ? [["DTWEXBGS", s.compare.usd.date, s.compare.usd.value, 1]] : []),
  ...(s.compare?.spx ? [["SP500", s.compare.spx.date, s.compare.spx.value, 1]] : []),
  ...(s.compare?.ndx ? [["NASDAQ100", s.compare.ndx.date, s.compare.ndx.value, 1]] : []),
];

let bad = 0;
console.log(`來源：${target}\n數據生成時間：${data.meta.generated_at}\n`);
console.log("序列        網頁日期     網頁數值        FRED同日數值    FRED最新日期  結果");
for (const [id, date, value, scale] of checks) {
  const res = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=2026-01-01`);
  const rows = parseFredCsv(await res.text(), id);
  const same = rows.find((r) => r[0] === date);
  const fredVal = same ? Math.round(same[1] * scale * 1000) / 1000 : null;
  const tol = id.startsWith("CB") || ["DTWEXBGS", "SP500", "NASDAQ100"].includes(id) ? 0.006 : 1e-6; // 對比資產存兩位小數
  const ok = fredVal != null && Math.abs(fredVal - value) < tol;
  const newer = rows.at(-1)[0] > date ? "（FRED已有較新一期）" : "";
  if (!ok) bad++;
  console.log(`${id.padEnd(11)} ${date}  ${String(value).padEnd(14)}  ${String(fredVal).padEnd(14)}  ${rows.at(-1)[0]}    ${ok ? "一致" : "不一致"}${newer}`);
}
// 每日政府戶口：與美國財政部每日報表同日收市結餘核對
{
  const url = `https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/dts/operating_cash_balance?filter=record_date:eq:${s.netliq.date}&fields=record_date,account_type,open_today_bal,close_today_bal`;
  const rows = parseTreasuryTga((await (await fetch(url)).json()).data);
  const v = rows[0] ? Math.round(rows[0][1]) / 1000 : null;
  const ok = v != null && Math.abs(v - s.netliq.tga) < 1e-6;
  if (!ok) bad++;
  console.log(`${"TGA_DTS".padEnd(11)} ${s.netliq.date}  ${String(s.netliq.tga).padEnd(14)}  ${String(v).padEnd(14)}  (財政部)      ${ok ? "一致" : "不一致"}`);
  const calc = Math.round((s.netliq.walcl - s.netliq.tga - s.netliq.rrp) * 1000) / 1000;
  const ok2 = Math.abs(calc - s.netliq.value) < 1e-6;
  if (!ok2) bad++;
  console.log(`淨流動性 ${s.netliq.value} ＝ ${s.netliq.walcl} − ${s.netliq.tga} − ${s.netliq.rrp}：${ok2 ? "算式一致" : "算式不一致"}`);
}
// 黃金（PAXG）：與 Binance 同日日線收市核對
if (s.compare?.gold) {
  const t0 = Date.parse(s.compare.gold.date + "T00:00:00Z");
  const k = await (await fetch(`https://data-api.binance.vision/api/v3/klines?symbol=PAXGUSDT&interval=1d&startTime=${t0}&limit=1`)).json();
  const v = k[0] ? Math.round(Number(k[0][4]) * 100) / 100 : null;
  const ok = v != null && Math.abs(v - s.compare.gold.value) < 0.006;
  if (!ok) bad++;
  console.log(`${"PAXGUSDT".padEnd(11)} ${s.compare.gold.date}  ${String(s.compare.gold.value).padEnd(14)}  ${String(v).padEnd(14)}  (Binance)     ${ok ? "一致" : "不一致"}`);
}
console.log(bad ? `\n❌ ${bad} 項不一致` : "\n✅ 全部與官方同日數值一致");
process.exit(bad ? 1 : 0);
