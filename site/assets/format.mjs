// 數字、日期及結論文字：網頁（app.js）與數據腳本（scripts/）共用同一份，
// 避免兩邊各寫一套而出現口徑不一。所有金額單位為「十億美元」（billion）。

export const MINUS = "−";

// 參考線及描述門檻（本站自訂，不是官方標準；網頁「判讀規則」一節逐條列出）
export const RULES = {
  reserveRef: 3000, // 準備金 3 兆美元參考線
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

// 以最新數據生成結論句（人話版）。規則固定、可重現；不作預測，不給買賣建議。
export function headline(s) {
  const { reserves, onrrp, rates, srf, netliq } = s;
  const pressure = rates.status === "above" || srf.status === "heavy";
  const money =
    netliq.chg_1m == null
      ? ""
      : `市場上的錢（淨流動性）近一個月${netliq.chg_1m >= 0 ? "增加" : "減少"}${fmtUsd(Math.abs(netliq.chg_1m))}。`;

  if (pressure) {
    const bits = [];
    if (rates.status === "above") bits.push(`市場借錢利率近5日平均比聯準會利率高${fmtBp(rates.avg5_bp, { signed: false })}個基點`);
    if (srf.status === "heavy") bits.push(`近5日有機構向聯準會緊急借了${fmtUsd(srf.max5)}`);
    return { title: "短期借錢出現壓力", lede: bits.join("，") + "。" + money, pressure };
  }

  const title =
    (reserves.below_ref ? "準備金跌穿3兆美元" : "準備金仍高於3兆美元") +
    "，" +
    (onrrp.cushion_low ? "備用錢包幾乎用完" : "備用錢包仍有緩衝");
  const calm = rates.status === "at" ? "借錢成本貼近警戒位，但暫未見持續壓力。" : "借錢成本正常。";
  return { title, lede: money + calm, pressure };
}

export const RATE_STATUS = {
  below: { label: "正常", tone: "good" },
  at: { label: "貼近警戒位", tone: "watch" },
  above: { label: "借錢變貴", tone: "alert" },
};

export const SRF_STATUS = {
  none: { label: "幾乎無人使用", tone: "good" },
  some: { label: "少量使用", tone: "watch" },
  heavy: { label: "大量使用", tone: "alert" },
};
