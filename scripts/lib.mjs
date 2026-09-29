// 數據整理：FRED CSV → 網頁用的 liquidity.json。純函數，方便測試。
import { RULES, headline } from "../site/assets/format.mjs";

// FRED 序列：id、原始單位換算成十億美元的倍數
export const SERIES = {
  WRESBAL: { scale: 1e-3, note: "準備金，週平均（百萬美元）" },
  WTREGEN: { scale: 1e-3, note: "TGA，週平均（百萬美元）" },
  WALCL: { scale: 1e-3, note: "聯準會總資產，週三水平（百萬美元）" },
  RRPONTSYD: { scale: 1, note: "ON RRP，每日（十億美元）" },
  RPONTTLD: { scale: 1, note: "隔夜回購操作總額，每日（十億美元）" },
  SOFR: { scale: 1, note: "SOFR，每日（%）" },
  IORB: { scale: 1, note: "準備金利率，2021-07-29 起（%）" },
  IOER: { scale: 1, note: "超額準備金利率，至 2021-07-28（%）" },
  DGS10: { scale: 1, note: "10 年期國債殖利率（%）" },
  DGS30: { scale: 1, note: "30 年期國債殖利率（%）" },
};

export function parseFredCsv(text, id) {
  const lines = text.trim().split(/\r?\n/);
  const header = lines[0]?.split(",") ?? [];
  if (header.length !== 2 || header[1].trim() !== id) {
    throw new Error(`${id}: 回應不是預期的 CSV（表頭：${lines[0]?.slice(0, 80)}）`);
  }
  const out = [];
  for (const line of lines.slice(1)) {
    const [d, raw] = line.split(",");
    const v = raw?.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || v === "" || v === "." || v == null) continue;
    const n = Number(v);
    if (Number.isFinite(n)) out.push([d, n]);
  }
  return out;
}

const round = (v, p = 3) => (v == null ? null : Math.round(v * 10 ** p) / 10 ** p);
const scaled = (rows, k) => rows.map(([d, v]) => [d, round(v * k)]);

// 找出 ≤ 指定日期的最後一個數值（二分搜尋）；rows 必須按日期遞增
export function valueAsOf(rows, d, maxLagDays = Infinity) {
  let lo = 0, hi = rows.length - 1, hit = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid][0] <= d) { hit = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (hit < 0) return null;
  const lag = (Date.parse(d) - Date.parse(rows[hit][0])) / 864e5;
  return lag <= maxLagDays ? rows[hit][1] : null;
}

export function buildDataset(raw, generatedAt = new Date().toISOString()) {
  const b = (id) => scaled(raw[id], SERIES[id].scale);
  const reserves = b("WRESBAL");
  const tga = b("WTREGEN");
  const walcl = b("WALCL");
  const onrrp = b("RRPONTSYD");
  const srf = b("RPONTTLD");

  // 淨流動性代理指標＝總資產（WALCL，週三水平）－TGA（WTREGEN，截至該週三的週平均，與卡片同一口徑）
  // －ON RRP（RRPONTSYD，該週三或之前最近一個工作天）。市場常用寫法，只作方向參考。
  const netliq = [];
  for (const [d, assets] of walcl) {
    const t = valueAsOf(tga, d, 0);
    const r = valueAsOf(onrrp, d, 6);
    if (t == null || r == null) continue;
    netliq.push([d, assets, t, r, round(assets - t - r)]);
  }

  // SOFR 對照準備金利率：2021-07-29 前用 IOER，之後用 IORB
  const ref = [...raw.IOER.filter(([d]) => d < "2021-07-29"), ...raw.IORB].sort((a, c) => (a[0] < c[0] ? -1 : 1));
  const rates = [];
  for (const [d, sofr] of raw.SOFR) {
    const r = valueAsOf(ref, d, 7);
    if (r != null) rates.push([d, sofr, r]);
  }

  // 10 年與 30 年殖利率按日期合併
  const y30 = new Map(raw.DGS30);
  const yields = raw.DGS10.map(([d, v]) => [d, v, y30.get(d) ?? null]);

  const data = {
    meta: {
      generated_at: generatedAt,
      start: raw.WRESBAL[0]?.[0],
      units: "金額單位：十億美元；利率單位：%",
      source: "Federal Reserve Bank of St. Louis, FRED；原始數據來自聯準會 H.4.1、H.15 及紐約聯儲",
      stale: [],
    },
    weekly: { reserves, tga, netliq },
    daily: { onrrp, rates, srf, yields },
  };
  data.summary = summarize(data);
  return data;
}

const last = (rows, back = 0) => rows[rows.length - 1 - back];

export function summarize({ weekly, daily }) {
  const R = weekly.reserves, T = weekly.tga, N = weekly.netliq;
  const reserves = {
    date: last(R)[0],
    value: last(R)[1],
    prev: last(R, 1)[1],
    chg_w: round(last(R)[1] - last(R, 1)[1]),
    chg_4w: round(last(R)[1] - last(R, 4)[1]),
    ref: RULES.reserveRef,
    gap_ref: round(last(R)[1] - RULES.reserveRef),
    below_ref: last(R)[1] < RULES.reserveRef,
  };
  const tga = {
    date: last(T)[0],
    value: last(T)[1],
    prev: last(T, 1)[1],
    chg_w: round(last(T)[1] - last(T, 1)[1]),
    chg_4w: round(last(T)[1] - last(T, 4)[1]),
  };

  const O = daily.onrrp;
  const peak = O.reduce((m, r) => (r[1] > m[1] ? r : m), O[0]);
  const onrrp = {
    date: last(O)[0],
    value: last(O)[1],
    peak_date: peak[0],
    peak: peak[1],
    pct_of_peak: round((last(O)[1] / peak[1]) * 100, 4),
    cushion_low: last(O)[1] < RULES.onrrpLow,
  };

  const netliq = {
    date: last(N)[0],
    value: last(N)[4],
    walcl: last(N)[1],
    tga: last(N)[2],
    rrp_wed: last(N)[3],
    chg_w: round(last(N)[4] - last(N, 1)[4]),
    chg_4w: round(last(N)[4] - last(N, 4)[4]),
  };

  const Q = daily.rates;
  const bp = (r) => round((r[1] - r[2]) * 100, 1);
  const last5 = Q.slice(-5), last20 = Q.slice(-20);
  const avg5 = round(last5.reduce((s, r) => s + bp(r), 0) / last5.length, 1);
  const max20 = last20.reduce((m, r) => (bp(r) > bp(m) ? r : m), last20[0]);
  const rates = {
    date: last(Q)[0],
    sofr: last(Q)[1],
    iorb: last(Q)[2],
    spread_bp: bp(last(Q)),
    avg5_bp: avg5,
    max20_bp: bp(max20),
    max20_date: max20[0],
    status: avg5 <= RULES.spreadCalm ? "below" : avg5 > RULES.spreadStress ? "above" : "at",
  };

  const S = daily.srf;
  const s5 = S.slice(-5);
  const m5 = s5.reduce((m, r) => (r[1] > m[1] ? r : m), s5[0]);
  const srf = {
    date: last(S)[0],
    value: last(S)[1],
    max5: m5[1],
    max5_date: m5[0],
    status: m5[1] >= RULES.srfHeavy ? "heavy" : m5[1] >= RULES.srfSome ? "some" : "none",
  };

  const Y = daily.yields.filter((r) => r[1] != null);
  const ly = last(Y);
  const monthAgo = new Date(Date.parse(ly[0]) - 30 * 864e5).toISOString().slice(0, 10);
  const y10m = valueAsOf(Y.map((r) => [r[0], r[1]]), monthAgo);
  const y30m = valueAsOf(Y.filter((r) => r[2] != null).map((r) => [r[0], r[2]]), monthAgo);
  const yields = {
    date: ly[0],
    y10: ly[1],
    y30: ly[2],
    y10_chg_1m: y10m == null ? null : round((ly[1] - y10m) * 100, 0),
    y30_chg_1m: y30m == null || ly[2] == null ? null : round((ly[2] - y30m) * 100, 0),
  };

  const s = { reserves, tga, onrrp, netliq, rates, srf, yields };
  s.headline = headline(s);
  return s;
}

// 結構及合理範圍檢查：發現問題即回傳錯誤清單（工作流程會因此失敗並通知）
export function validate(data) {
  const errs = [];
  const checkRows = (name, rows, lo, hi, col = 1) => {
    if (!Array.isArray(rows) || rows.length < 50) return errs.push(`${name}: 數據太少（${rows?.length ?? 0}）`);
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0] <= rows[i - 1][0]) return errs.push(`${name}: 日期未按順序（${rows[i][0]}）`);
    }
    const bad = rows.find((r) => r[col] != null && (r[col] < lo || r[col] > hi));
    if (bad) errs.push(`${name}: 數值超出合理範圍 ${bad[0]} = ${bad[col]}`);
  };
  checkRows("準備金", data.weekly.reserves, 500, 8000);
  checkRows("TGA", data.weekly.tga, 0, 3000);
  checkRows("淨流動性", data.weekly.netliq, 1000, 12000, 4);
  checkRows("ON RRP", data.daily.onrrp, 0, 3500);
  checkRows("SOFR", data.daily.rates, -1, 12);
  checkRows("常備回購", data.daily.srf, 0, 1000);
  checkRows("10 年期殖利率", data.daily.yields, 0, 15);
  if (!data.summary?.headline?.title) errs.push("結論句未能生成");
  return errs;
}
