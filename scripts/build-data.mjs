#!/usr/bin/env node
// 由 FRED 官方 CSV（免 API key）抓數，寫入 site/data/liquidity.json。
// 單一序列抓取失敗時沿用上一版數據並標示「未更新」，不會令整頁消失；
// 結構或數值不合理則以非零狀態結束，GitHub Actions 會標示失敗並通知。
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { SERIES, parseFredCsv, buildDataset, validate } from "./lib.mjs";

const START = "2018-01-01";
const OUT = new URL("../site/data/liquidity.json", import.meta.url);
const RAW_CACHE = new URL("../data/raw.json", import.meta.url); // 只供後備，不公開部署
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchSeries(id) {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=${START}`;
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "usd-liquidity-dashboard (+https://github.com/myttttttt/usd-liquidity)" },
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows = parseFredCsv(await res.text(), id);
      if (rows.length === 0) throw new Error("沒有數據");
      return rows;
    } catch (e) {
      lastErr = e;
      await sleep(2000 * attempt);
    }
  }
  throw new Error(`${id}: ${lastErr?.message}`);
}

async function readJson(url) {
  try {
    return JSON.parse(await readFile(url, "utf8"));
  } catch {
    return null;
  }
}

const previous = await readJson(RAW_CACHE);
const raw = {};
const stale = [];
for (const id of Object.keys(SERIES)) {
  try {
    raw[id] = await fetchSeries(id);
  } catch (e) {
    if (previous?.[id]?.length) {
      raw[id] = previous[id];
      stale.push(id);
      console.warn(`⚠️ ${e.message}，沿用上一版數據`);
    } else {
      console.error(`❌ ${e.message}，亦沒有上一版數據可用`);
      process.exit(1);
    }
  }
}

const data = buildDataset(raw);
data.meta.stale = stale;
const errs = validate(data);
if (errs.length) {
  console.error("❌ 數據檢查失敗：\n" + errs.join("\n"));
  process.exit(1);
}

await mkdir(new URL("../site/data/", import.meta.url), { recursive: true });
await mkdir(new URL("../data/", import.meta.url), { recursive: true });
await writeFile(RAW_CACHE, JSON.stringify(raw));
await writeFile(OUT, JSON.stringify(data));

const s = data.summary;
console.log(`✅ ${s.headline.title}`);
console.log(
  `準備金 ${s.reserves.value}（${s.reserves.date}）｜TGA ${s.tga.value}（${s.tga.date}）｜ON RRP ${s.onrrp.value}（${s.onrrp.date}）｜` +
    `淨流動性 ${s.netliq.value}（${s.netliq.date}）｜SOFR−IORB ${s.rates.spread_bp}bp（${s.rates.date}）｜10Y ${s.yields.y10}% 30Y ${s.yields.y30}%`,
);
if (stale.length) console.log(`未更新序列：${stale.join(", ")}`);
