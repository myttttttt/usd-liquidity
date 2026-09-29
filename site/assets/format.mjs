// 數字、日期及結論文字：網頁（app.js）與數據腳本（scripts/）共用同一份，
// 避免兩邊各寫一套而出現口徑不一。所有金額單位為「十億美元」（billion）。

export const MINUS = "−";

// 參考水位及描述門檻（本站自訂，不是官方標準；網頁「判讀規則」一節逐條列出）
export const RULES = {
  reserveRef: 3000, // 準備金 3 兆美元參考水位
  onrrpLow: 100, // ON RRP 低於 1,000 億美元視為「氣墊接近用盡」
  spreadCalm: -3, // SOFR − IORB 近 5 個交易日平均 ≤ −3 個基點：資金暢順
  spreadStress: 2, // 平均 > +2 個基點：壓力浮現；兩者之間為「貼近 IORB」
  srfSome: 1, // 常備回購近 5 個交易日最高 ≥ 10 億美元：少量使用
  srfHeavy: 10, // ≥ 100 億美元：明顯使用
};

export function fmtUsd(b, { unit = true, signed = false } = {}) {
  if (b == null || !Number.isFinite(b)) return "—";
  const sign = b < 0 ? MINUS : signed && b > 0 ? "+" : "";
  const a = Math.abs(b);
  let s;
  if (a >= 1000) s = (a / 1000).toFixed(2) + "兆";
  else if (a >= 1) s = Math.round(a * 10).toLocaleString("en-US") + "億";
  else if (a === 0) s = "0億";
  else if (a * 10 >= 0.1) s = (a * 10).toFixed(1) + "億";
  else s = (a * 10).toFixed(2) + "億";
  return sign + s + (unit ? "美元" : "");
}

export function fmtPct(v, digits = 2) {
  return v == null || !Number.isFinite(v) ? "—" : v.toFixed(digits) + "%";
}

export function fmtBp(v, { signed = true } = {}) {
  if (v == null || !Number.isFinite(v)) return "—";
  const r = Math.round(v);
  const sign = r < 0 ? MINUS : signed && r > 0 ? "+" : "";
  return sign + Math.abs(r);
}

export function fmtDate(d, { year = true } = {}) {
  if (!d) return "—";
  const [y, m, day] = d.split("-").map(Number);
  return (year ? `${y}年` : "") + `${m}月${day}日`;
}

// 以最新數據生成結論句。規則固定、可重現；不作預測，不給買賣建議。
export function headline(s) {
  const { reserves, tga, onrrp, rates, srf } = s;
  const pressure = rates.status === "above" || srf.status === "heavy";
  const change = (v) => fmtUsd(Math.abs(v));

  let flow;
  if (tga.chg_w > 0 && reserves.chg_w < 0) {
    flow = `最新一週TGA增加${change(tga.chg_w)}，準備金同期減少${change(reserves.chg_w)}。`;
  } else if (tga.chg_w < 0 && reserves.chg_w > 0) {
    flow = `最新一週TGA減少${change(tga.chg_w)}，準備金同期增加${change(reserves.chg_w)}。`;
  } else {
    flow =
      `最新一週準備金${reserves.chg_w >= 0 ? "增加" : "減少"}${change(reserves.chg_w)}，` +
      `TGA${tga.chg_w >= 0 ? "增加" : "減少"}${change(tga.chg_w)}。`;
  }

  if (pressure) {
    const bits = [];
    if (rates.status === "above") bits.push(`SOFR近5個交易日平均較IORB高出${fmtBp(rates.avg5_bp, { signed: false })}個基點`);
    if (srf.status === "heavy") bits.push(`常備回購近5個交易日最多使用${fmtUsd(srf.max5)}`);
    return { title: "短期資金出現壓力訊號", lede: bits.join("，") + "。" + flow, pressure };
  }

  const title =
    (reserves.below_ref ? "準備金低於3兆美元參考水位" : "準備金仍在3兆美元參考水位之上") +
    "，" +
    (onrrp.cushion_low ? "ON RRP氣墊接近用盡" : "ON RRP仍有緩衝");
  const calm =
    rates.status === "at"
      ? "短期借錢利率已貼近IORB，但暫未見持續壓力。"
      : "短期借錢利率仍低於IORB，暫未見資金壓力。";
  return { title, lede: flow + calm, pressure };
}

export const RATE_STATUS = {
  below: { label: "資金暢順", tone: "good" },
  at: { label: "貼近IORB，值得留意", tone: "watch" },
  above: { label: "壓力浮現", tone: "alert" },
};

export const SRF_STATUS = {
  none: { label: "幾乎沒有使用", tone: "good" },
  some: { label: "少量使用", tone: "watch" },
  heavy: { label: "明顯使用", tone: "alert" },
};
