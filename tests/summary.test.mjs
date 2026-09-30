// 結論規則及格式的回歸測試（合成數據，不連網）
import { test } from "node:test";
import assert from "node:assert/strict";
import { fmtUsd, fmtBp } from "../site/assets/format.mjs";
import { parseFredCsv, parseTreasuryTga, buildDataset, validate, valueAsOf } from "../scripts/lib.mjs";

test("金額格式：兆、億及細數", () => {
  assert.equal(fmtUsd(2930.193), "2.93兆美元");
  assert.equal(fmtUsd(977.084), "9,771億美元");
  assert.equal(fmtUsd(0.851), "8.5億美元");
  assert.equal(fmtUsd(0.001), "0.01億美元");
  assert.equal(fmtUsd(-83.601, { signed: true, unit: false }), "−836億");
  assert.equal(fmtUsd(100.056, { signed: true, unit: false }), "+1,001億");
  assert.equal(fmtBp(-1.6), "−2");
});

test("FRED CSV：略過空值，錯誤表頭會報錯", () => {
  assert.deepEqual(parseFredCsv("observation_date,X\n2026-01-01,1.5\n2026-01-02,\n2026-01-05,.\n", "X"), [["2026-01-01", 1.5]]);
  assert.throws(() => parseFredCsv("<html>", "X"));
});

test("valueAsOf 只取指定日期或之前", () => {
  const rows = [["2026-01-01", 1], ["2026-01-08", 2]];
  assert.equal(valueAsOf(rows, "2026-01-07"), 1);
  assert.equal(valueAsOf(rows, "2025-12-31"), null);
  assert.equal(valueAsOf(rows, "2026-01-07", 0), null);
});

// 合成一組 60 週／300 日的數據，再按情境改最後幾點
function synth({ reserves = 2930, tgaDelta = 100, rrp = 0.8, spread = 0, srf = 0 } = {}) {
  const weeks = [], days = [];
  const start = Date.UTC(2025, 0, 1); // 星期三
  for (let i = 0; i < 60; i++) weeks.push(new Date(start + i * 7 * 864e5).toISOString().slice(0, 10));
  for (let i = 0; i < 420; i++) days.push(new Date(start + i * 864e5).toISOString().slice(0, 10));
  const w = (f) => weeks.map((d, i) => [d, f(i)]);
  const dd = (f) => days.map((d, i) => [d, f(i)]);
  const last = weeks.length - 1;
  return {
    WRESBAL: w((i) => (i === last ? reserves : reserves + 80) * 1000),
    WTREGEN: w((i) => (i === last ? 900 + tgaDelta : 900) * 1000),
    WALCL: w(() => 6700 * 1000),
    TGA_DTS: dd((i) => (i >= 400 ? 1000 : 900) * 1000),
    RRPONTSYD: dd((i) => (i === 100 ? 2500 : rrp)),
    RPONTTLD: dd((i) => (i >= 415 ? srf : 0)),
    SOFR: dd((i) => 3.9 + (i >= 410 ? spread / 100 : -0.05)),
    IORB: dd(() => 3.9),
    IOER: [["2020-01-01", 1.6]],
    DGS10: dd(() => 5.1),
    DGS30: dd(() => 5.4),
  };
}

test("平靜情境：低於3兆、氣墊用盡、貼近IORB", () => {
  const data = buildDataset(synth(), "2026-01-01T00:00:00Z");
  const s = data.summary;
  assert.equal(s.reserves.below_ref, true);
  assert.equal(s.onrrp.cushion_low, true);
  assert.equal(s.rates.status, "at");
  assert.equal(s.srf.status, "none");
  assert.equal(s.headline.title, "準備金跌穿3兆美元，後備資金池幾乎用完");
  assert.equal(s.headline.lede, "市場上的錢（淨流動性）近一個月減少1,000億美元。借錢成本貼近警戒位，但暫未見持續壓力。");
  assert.equal(s.onrrp.peak, 2500);
  assert.deepEqual(validate(data), []);
});

test("壓力情境：SOFR持續高於IORB或常備回購明顯使用", () => {
  const a = buildDataset(synth({ spread: 8 })).summary;
  assert.equal(a.rates.status, "above");
  assert.equal(a.headline.title, "短期借錢出現壓力");
  assert.match(a.headline.lede, /市場借錢利率近5日平均比聯準會利率高8個基點/);
  const b = buildDataset(synth({ srf: 25 })).summary;
  assert.equal(b.srf.status, "heavy");
  assert.match(b.headline.lede, /近5日有機構向聯準會緊急借了250億美元/);
});

test("寬鬆情境：高於3兆及ON RRP仍有緩衝", () => {
  const s = buildDataset(synth({ reserves: 3300, tgaDelta: -50, rrp: 400, spread: -8 })).summary;
  assert.equal(s.headline.title, "準備金仍高於3兆美元，後備資金池仍有緩衝");
  assert.equal(s.rates.status, "below");
  assert.match(s.headline.lede, /借錢成本正常。$/);
});

test("每日淨流動性＝總資產（沿用最近週三）－每日TGA－ON RRP", () => {
  const data = buildDataset(synth());
  const n = data.summary.netliq;
  assert.equal(n.value, Math.round((6700 - 1000 - 0.8) * 1000) / 1000);
  assert.equal(n.chg_1m, -100);
  assert.ok(data.meta.walcl_date <= n.date);
});

test("財政部每日TGA：三種舊新格式都讀到", () => {
  const rows = [
    { record_date: "2018-01-02", account_type: "Federal Reserve Account", open_today_bal: "1", close_today_bal: "190038" },
    { record_date: "2021-10-01", account_type: "Treasury General Account (TGA)", open_today_bal: "215160", close_today_bal: "132452" },
    { record_date: "2022-04-18", account_type: "Treasury General Account (TGA) Opening Balance", open_today_bal: "578473", close_today_bal: "null" },
    { record_date: "2022-04-18", account_type: "Treasury General Account (TGA) Closing Balance", open_today_bal: "841253", close_today_bal: "null" },
    { record_date: "2022-04-18", account_type: "Short-Term Cash Investments (Table V)", open_today_bal: "0", close_today_bal: "0" },
  ];
  assert.deepEqual(parseTreasuryTga(rows), [["2018-01-02", 190038], ["2021-10-01", 132452], ["2022-04-18", 841253]]);
});
