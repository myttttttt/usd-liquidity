// 結論規則及格式的回歸測試（合成數據，不連網）
import { test } from "node:test";
import assert from "node:assert/strict";
import { fmtUsd, fmtBp } from "../site/assets/format.mjs";
import { parseFredCsv, buildDataset, validate, valueAsOf } from "../scripts/lib.mjs";

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
  assert.equal(s.headline.title, "準備金低於3兆美元參考水位，ON RRP氣墊接近用盡");
  assert.match(s.headline.lede, /^最新一週TGA增加1,000億美元，準備金同期減少800億美元。/);
  assert.equal(s.onrrp.peak, 2500);
  assert.deepEqual(validate(data), []);
});

test("壓力情境：SOFR持續高於IORB或常備回購明顯使用", () => {
  const a = buildDataset(synth({ spread: 8 })).summary;
  assert.equal(a.rates.status, "above");
  assert.equal(a.headline.title, "短期資金出現壓力訊號");
  assert.match(a.headline.lede, /SOFR近5個交易日平均較IORB高出8個基點/);
  const b = buildDataset(synth({ srf: 25 })).summary;
  assert.equal(b.srf.status, "heavy");
  assert.match(b.headline.lede, /常備回購近5個交易日最多使用250億美元/);
});

test("寬鬆情境：高於3兆及ON RRP仍有緩衝", () => {
  const s = buildDataset(synth({ reserves: 3300, tgaDelta: -50, rrp: 400, spread: -8 })).summary;
  assert.equal(s.headline.title, "準備金仍在3兆美元參考水位之上，ON RRP仍有緩衝");
  assert.equal(s.rates.status, "below");
  assert.match(s.headline.lede, /仍低於IORB/);
});

test("淨流動性＝總資產－TGA週平均－ON RRP", () => {
  const n = buildDataset(synth()).summary.netliq;
  assert.equal(n.value, Math.round((6700 - 1000 - 0.8) * 1000) / 1000);
});
