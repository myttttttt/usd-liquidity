// 美元水管：讀取 data/liquidity.json，畫首屏結論、手寫 SVG 圖表及表格。
// 沒有外部圖表庫；所有數字格式及結論規則來自 format.mjs（與數據腳本共用）。
import { fmtUsd, fmtPct, fmtBp, fmtDate, RATE_STATUS, SRF_STATUS } from "./format.mjs";

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const DAY = 864e5;
const toT = (d) => Date.parse(d + "T00:00:00Z");
const fmtMonth = (d) => { const [y, m] = d.split("-").map(Number); return `${y}年${m}月`; };
const charts = [];

// ---------- 外觀 ----------
function initTheme() {
  const btn = $("#theme-toggle");
  const sync = () => {
    const cur = document.documentElement.dataset.theme;
    $("#theme-label").textContent = cur === "dark" ? "淺色" : "深色";
    btn.setAttribute("aria-label", cur === "dark" ? "切換至淺色外觀" : "切換至深色外觀");
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = cur === "dark" ? "#171819" : "#f2ede3";
  };
  btn.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("usdliq-theme", next); } catch {}
    sync();
  });
  sync();
}

// ---------- 首屏及數字卡 ----------
function splitUsd(b) {
  const s = fmtUsd(b, { unit: false });
  const m = s.match(/^(.*?)(兆|億)$/);
  return m ? [m[1], m[2] + "美元"] : [s, ""];
}
const pctText = (p) => (p < 0.1 ? p.toFixed(2) : p < 10 ? p.toFixed(1) : p.toFixed(0)) + "%";
const signed = (v) => fmtUsd(v, { signed: true, unit: false });

// 數字卡：名稱＋數值、一句「怎樣看」、變化＋狀態標籤
function metric({ id, color, name, sub, value, unit, read, foot, chip }) {
  return `<article class="metric" data-od-id="m-${id}">
    <div class="m-top"><h3>${color ? `<i class="sw" style="--c:var(${color})"></i>` : ""}${name}${sub ? `<small>${sub}</small>` : ""}</h3><span class="m-val">${value}<span class="u">${unit}</span></span></div>
    <p class="read">${read}</p>
    <div class="m-foot"><span>${foot}</span>${chip ? `<span class="chip ${chip[0]}">${chip[1]}</span>` : ""}</div>
  </article>`;
}

function renderHero(data) {
  const s = data.summary;
  const latest = [s.onrrp.date, s.netliq.date, s.rates.date].sort().at(-1);
  $("#asof").textContent = `數據更新至${fmtDate(latest)}`;
  $("#where-sub").textContent = `講座的三條線。準備金及政府戶口為每週平均，最新至${fmtDate(s.reserves.date, { year: false })}。`;
  // 按逗號分句，每句不拆開換行
  const parts = s.headline.title.split("，");
  $("#headline").innerHTML = parts.map((p, i) => `<span class="clause">${esc(p)}${i < parts.length - 1 ? "，" : ""}</span>`).join("");
  $("#lede").textContent = s.headline.lede;

  // 淨流動性
  const n = s.netliq;
  const [nv, nu] = splitUsd(n.value);
  $("#nl-value").innerHTML = `${nv}<span class="u">${nu}</span>`;
  $("#nl-date").textContent = fmtDate(n.date, { year: false });
  const chg = (label, v) => v == null ? "" :
    `<span class="chip ${v >= 0 ? "good" : "watch"}">${label} <b>${signed(v)}</b></span>`;
  $("#nl-chg").innerHTML = chg("近1週", n.chg_1w) + chg("近1個月", n.chg_1m);
  const u = (v) => `<b>${fmtUsd(v, { unit: false })}</b>`;
  $("#formula").innerHTML = `聯準會總資產 ${u(n.walcl)}（${fmtDate(n.walcl_date, { year: false })}）− 政府戶口 ${u(n.tga)} − 後備資金池 ${u(n.rrp)}（${fmtDate(n.date, { year: false })}）＝ ${u(n.value)}美元`;

  // 錢去了哪裡
  const val = (b) => splitUsd(b);
  const [rv, ru] = val(s.reserves.value), [tv, tu] = val(s.tga.value), [ov, ou] = val(s.onrrp.value);
  $("#kpis").innerHTML = [
    metric({
      id: "reserves", color: "--s1", name: "準備金", sub: "銀行的錢", value: rv, unit: ru,
      read: "銀行存在聯準會的錢；低於3兆要留意",
      foot: `較上週 <b>${signed(s.reserves.chg_w)}</b>`,
      chip: s.reserves.below_ref ? ["watch", "跌穿3兆"] : ["good", "高於3兆"],
    }),
    metric({
      id: "tga", color: "--s2", name: "政府戶口", sub: "TGA", value: tv, unit: tu,
      read: "上升＝政府從市場抽走錢",
      foot: `較上週 <b>${signed(s.tga.chg_w)}</b>`,
      chip: s.tga.chg_w > 0 ? ["watch", "上升中"] : ["good", "回落中"],
    }),
    metric({
      id: "onrrp", color: "--s3", name: "後備資金池", sub: "ON RRP", value: ov, unit: ou,
      read: "越低＝市場緩衝越少",
      foot: `高峰 <b>${fmtUsd(s.onrrp.peak, { unit: false })}</b>（${fmtMonth(s.onrrp.peak_date)}）`,
      chip: s.onrrp.cushion_low ? ["watch", `只剩高峰${pctText(s.onrrp.pct_of_peak)}`] : ["good", `約為高峰${pctText(s.onrrp.pct_of_peak)}`],
    }),
  ].join("");

  // 借錢壓力
  const r = s.rates, f = s.srf;
  const [fv, fu] = val(f.value);
  $("#pressure-metrics").innerHTML = [
    metric({
      id: "spread", name: "借錢成本差距", sub: "SOFR − IORB", value: fmtBp(r.spread_bp), unit: "個基點",
      read: "高於0＝市場借錢比聯準會利率貴",
      foot: `SOFR <b>${fmtPct(r.sofr)}</b>・IORB <b>${fmtPct(r.iorb)}</b>`,
      chip: [RATE_STATUS[r.status].tone, RATE_STATUS[r.status].label],
    }),
    metric({
      id: "srf", name: "向聯準會緊急借錢", sub: "常備回購", value: fv, unit: fu,
      read: "用得多＝市場缺錢",
      foot: `近5日最多 <b>${fmtUsd(f.max5, { unit: false })}</b>`,
      chip: [SRF_STATUS[f.status].tone, SRF_STATUS[f.status].label],
    }),
  ].join("");

  // 長期利率
  const y = s.yields;
  const bp = (v) => v == null ? "—" : `${fmtBp(v)}個基點`;
  $("#yield-metrics").innerHTML = [
    metric({ id: "y10", name: "10年期國債", value: y.y10.toFixed(2), unit: "%", read: "越高＝長期借錢越貴", foot: `近1個月 <b>${bp(y.y10_chg_1m)}</b>` }),
    metric({ id: "y30", name: "30年期國債", value: y.y30 == null ? "—" : y.y30.toFixed(2), unit: "%", read: "越高＝長期借錢越貴", foot: `近1個月 <b>${bp(y.y30_chg_1m)}</b>` }),
  ].join("");
}

// ---------- 圖表 ----------
function niceStep(x) {
  const e = Math.floor(Math.log10(x)), f = x / 10 ** e;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * 10 ** e;
}
function niceTicks(lo, hi, n) {
  if (lo === hi) { lo -= 1; hi += 1; }
  const step = niceStep((hi - lo) / n);
  const a = Math.floor(lo / step + 1e-9) * step, b = Math.ceil(hi / step - 1e-9) * step;
  const out = [];
  for (let v = a; v <= b + step / 2; v += step) out.push(Math.round(v / step) * step);
  return out;
}
function lastIndexAtOrBefore(rows, t) {
  let lo = 0, hi = rows.length - 1, hit = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (rows[mid].t <= t) { hit = mid; lo = mid + 1; } else hi = mid - 1; }
  return hit;
}

const pctFmt = (v) => `${v > 0.05 ? "+" : v < -0.05 ? "−" : ""}${Math.abs(v).toFixed(1)}%`;
const priceTick = (v, step) => Math.abs(v) >= 10000
  ? `${(v / 1000).toLocaleString("en-US", { maximumFractionDigits: step >= 1000 ? 0 : 1 })}k`
  : v.toLocaleString("en-US", { maximumFractionDigits: step >= 1 ? 0 : step >= 0.1 ? 1 : 2 });

class Chart {
  constructor(el, cfg) {
    this.el = el;
    this.cfg = cfg;
    this.range = cfg.range;
    const prep = (s) => ({
      ...s,
      rows: s.rows.filter((r) => r[s.col ?? 1] != null).map((r) => ({ d: r[0], t: toT(r[0]), v: s.map ? s.map(r) : r[s.col ?? 1] })),
    });
    this.base = cfg.series.map(prep);
    // 可加入的對比資產；加入後全部改為「由起點計的升跌%」，避免兩條刻度
    this.extra = (cfg.compare ?? []).map(prep).filter((s) => s.rows.length);
    this.active = new Set();
    this.series = this.base;
    const cmp = this.extra.length
      ? `<div class="cmp" role="group" aria-label="加入對比"><span>對比</span>${this.extra
          .map((s) => `<button type="button" data-k="${s.key}" aria-pressed="false"><i class="sw${s.dash ? " dash" : ""}" style="--c:var(${s.color})"></i>${esc(s.label)}</button>`).join("")}</div>`
      : "";
    el.innerHTML = `<div class="chart-top"><div class="legend"></div>
      <div class="seg" role="group" aria-label="時間範圍">${Object.keys(cfg.ranges)
        .map((k) => `<button type="button" data-r="${k}" aria-pressed="${k === this.range}">${k}</button>`).join("")}</div></div>
      ${cmp}
      <div class="plot"><svg tabindex="0" role="img" aria-label="${esc(cfg.aria)}"></svg></div>`;
    el.querySelectorAll(".cmp button").forEach((b) => b.addEventListener("click", () => {
      const k = b.dataset.k;
      this.active.has(k) ? this.active.delete(k) : this.active.add(k);
      b.setAttribute("aria-pressed", String(this.active.has(k)));
      this.series = [...this.base, ...this.extra.filter((s) => this.active.has(s.key))];
      this.hover = null;
      this.render();
    }));
    this.legend = $(".legend", el);
    this.svg = $("svg", el);
    this.plot = $(".plot", el);
    el.querySelectorAll(".seg button").forEach((b) => b.addEventListener("click", () => {
      this.range = b.dataset.r;
      el.querySelectorAll(".seg button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      this.hover = null;
      this.render();
    }));
    this.bindPointer();
    let raf = 0;
    new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => this.render()); }).observe(this.plot);
  }

  render() {
    const cfg = this.cfg;
    const W = Math.max(240, Math.floor(this.plot.clientWidth));
    const narrow = W < 520;
    const H1 = narrow ? 210 : 280, H2 = narrow ? 92 : 112, GAP = 30;
    const tEnd = Math.max(...this.series.map((s) => s.rows.at(-1).t));
    const days = cfg.ranges[this.range];
    const tStart = days ? tEnd - days * DAY : Math.min(...this.base.map((s) => s.rows[0].t));

    const vis = this.series.map((s) => {
      const i0 = Math.max(0, lastIndexAtOrBefore(s.rows, tStart));
      return s.rows.slice(s.rows[i0].t < tStart && i0 + 1 < s.rows.length ? i0 + 1 : i0);
    });
    // 分格：第一格放主線；每個加入的對比資產各佔一格，各自刻度，共用日期軸（不用雙刻度）
    const groups = [{ idx: this.base.map((_, i) => i), h: H1, main: true }];
    for (let i = this.base.length; i < this.series.length; i++) groups.push({ idx: [i], h: H2 });
    for (const g of groups) {
      let lo = Infinity, hi = -Infinity;
      for (const i of g.idx) for (const r of vis[i]) { if (r.v < lo) lo = r.v; if (r.v > hi) hi = r.v; }
      if (g.main) {
        for (const ref of cfg.refs ?? []) { lo = Math.min(lo, ref.y); hi = Math.max(hi, ref.y); }
        if (cfg.zero || cfg.type === "bar") { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
      }
      if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
      g.ticks = niceTicks(lo, hi, g.main ? (narrow ? 4 : 5) : 3);
      const step = g.ticks.length > 1 ? g.ticks[1] - g.ticks[0] : 1;
      g.labels = g.ticks.map((v) => (g.main ? cfg.yTick(v, step) : priceTick(v, step)));
    }
    const ml = Math.max(...groups.flatMap((g) => g.labels.map((l) => l.length))) * 7 + 10;
    const m = { l: ml, r: 8, t: cfg.marks ? 20 : 8, b: 22 };
    let top = m.t;
    for (const g of groups) { g.top = top; g.bot = top + g.h; top = g.bot + GAP; }
    const H = groups.at(-1).bot + m.b;
    const pw = W - m.l - m.r;
    const X = (t) => m.l + ((t - tStart) / (tEnd - tStart)) * pw;
    const Ys = [];
    for (const g of groups) {
      const lo = g.ticks[0], hi = g.ticks.at(-1);
      g.Y = (v) => g.top + (1 - (v - lo) / (hi - lo)) * g.h;
      for (const i of g.idx) Ys[i] = g.Y;
    }
    const Y = groups[0].Y, lo = groups[0].ticks[0];
    Object.assign(this, { W, H, m, X, Ys, tStart, tEnd, vis, pw });

    let g = `<g class="grid">`;
    for (const gr of groups) gr.ticks.forEach((v, k) => {
      g += `<line x1="${m.l}" x2="${W - m.r}" y1="${gr.Y(v)}" y2="${gr.Y(v)}"/>`;
      g += `<text x="${m.l - 6}" y="${gr.Y(v) + 4}" text-anchor="end">${gr.labels[k]}</text>`;
    });
    for (const gr of groups.slice(1)) {
      const sr = this.series[gr.idx[0]];
      g += `<text class="mk" x="${m.l}" y="${gr.top - 10}">${esc(sr.label)}${sr.unit ? `（${esc(sr.unit)}）` : ""}</text>`;
    }
    g += `</g>`;

    // X 軸：跨度長用年份，中用月份，短用日期（每週一）
    const span = (tEnd - tStart) / DAY;
    const xt = [];
    const s0 = new Date(tStart), s1 = new Date(tEnd);
    if (span > 500) {
      for (let y = s0.getUTCFullYear() + 1; y <= s1.getUTCFullYear(); y++) xt.push([Date.UTC(y, 0, 1), String(y)]);
    } else if (span > 120) {
      const step = narrow ? 3 : 2;
      for (let d = new Date(Date.UTC(s0.getUTCFullYear(), s0.getUTCMonth() + 1, 1)); d <= s1; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) {
        if (d.getUTCMonth() % step !== 0) continue;
        xt.push([d.getTime(), d.getUTCMonth() === 0 ? String(d.getUTCFullYear()) : `${d.getUTCMonth() + 1}月`]);
      }
    } else {
      const stepDays = span > 45 ? (narrow ? 21 : 14) : 7;
      let t = tStart + ((8 - s0.getUTCDay()) % 7) * DAY;
      for (; t <= tEnd; t += stepDays * DAY) { const d = new Date(t); xt.push([t, `${d.getUTCMonth() + 1}/${d.getUTCDate()}`]); }
    }
    const minGap = 40;
    let lastX = -Infinity, every = 1;
    for (const [t] of xt) { const x = X(t); if (x - lastX < minGap) { every = 2; break; } lastX = x; }
    let ax = "";
    xt.forEach(([t, l], i) => {
      if (i % every) return;
      const x = X(t);
      ax += `<text x="${x}" y="${H - 6}" text-anchor="middle">${l}</text>`;
    });

    let refs = "";
    for (const ref of cfg.refs ?? []) refs += `<line class="ref" x1="${m.l}" x2="${W - m.r}" y1="${Y(ref.y)}" y2="${Y(ref.y)}"/>`;
    if (cfg.zero && lo < 0) refs += `<line class="zero" x1="${m.l}" x2="${W - m.r}" y1="${Y(0)}" y2="${Y(0)}"/>`;

    let marks = "", prevEnd = -Infinity;
    for (const mk of cfg.marks ?? []) {
      const t = toT(mk.d);
      if (t < tStart || t > tEnd) continue;
      const x = X(t);
      marks += `<line class="mark" x1="${x}" x2="${x}" y1="${m.t}" y2="${H - m.b}"/>`;
      const text = narrow && mk.short ? mk.short : mk.label;
      const w = [...text].reduce((n, ch) => n + (/[\x00-\x7f]/.test(ch) ? 6.5 : 11), 0);
      const anchor = x + w / 2 > W - m.r ? "end" : x - w / 2 < m.l ? "start" : "middle";
      const x0 = anchor === "end" ? x - w : anchor === "start" ? x : x - w / 2;
      if (x0 > prevEnd + 6) { marks += `<text class="mk" x="${x}" y="13" text-anchor="${anchor}">${esc(text)}</text>`; prevEnd = x0 + w; }
    }

    let paths = "";
    this.series.forEach((s, i) => {
      const rows = vis[i];
      if (!rows.length) return;
      if (cfg.type === "bar") {
        const buckets = new Map();
        for (const r of rows) { const k = Math.floor(X(r.t)); if (!buckets.has(k) || r.v > buckets.get(k)) buckets.set(k, r.v); }
        const bw = Math.max(1, Math.min(4, (pw / rows.length) * 0.8));
        let d = "";
        for (const [k, v] of buckets) if (v > 0) d += `M${k + 0.5} ${Ys[i](0)}V${Math.min(Ys[i](v), Ys[i](0) - 1)}`;
        paths += `<path class="bars" d="${d}" style="stroke-width:${bw}"/>`;
      } else {
        // 每個像素只保留首、最低、最高、尾四點，保留形狀並減少節點
        let d = "", cur = null, pts = [];
        const flush = () => {
          if (!pts.length) return;
          const a = pts[0], z = pts.at(-1);
          let mn = a, mx = a;
          for (const p of pts) { if (p.v < mn.v) mn = p; if (p.v > mx.v) mx = p; }
          for (const p of [a, mn, mx, z].sort((p, q) => p.t - q.t)) d += `${d ? "L" : "M"}${X(p.t).toFixed(1)} ${Ys[i](p.v).toFixed(1)}`;
          pts = [];
        };
        for (const r of rows) { const k = Math.round(X(r.t)); if (k !== cur) { flush(); cur = k; } pts.push(r); }
        flush();
        paths += `<path class="series" d="${d}" style="stroke:var(${s.color});stroke-width:${s.width ?? 2}px${s.dash ? ";stroke-dasharray:6 4" : ""}"/>`;
      }
    });

    this.svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    this.svg.setAttribute("width", W);
    this.svg.setAttribute("height", H);
    this.svg.innerHTML = g + refs + marks + paths + `<g class="hover"></g>` + ax;
    this.drawHover();
  }

  bindPointer() {
    const move = (e) => {
      if (!this.X) return;
      const rect = this.svg.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * this.W;
      if (x < this.m.l - 4 || x > this.W - this.m.r + 4) return;
      const t = this.tStart + ((x - this.m.l) / this.pw) * (this.tEnd - this.tStart);
      const rows = this.vis[0];
      let i = lastIndexAtOrBefore(rows, t);
      if (i < 0) i = 0;
      if (i + 1 < rows.length && Math.abs(rows[i + 1].t - t) < Math.abs(rows[i].t - t)) i += 1;
      this.hover = i;
      this.drawHover();
    };
    this.svg.addEventListener("pointermove", move);
    this.svg.addEventListener("pointerdown", move);
    this.svg.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") { this.hover = null; this.drawHover(); } });
    this.svg.addEventListener("keydown", (e) => {
      const n = this.vis?.[0]?.length ?? 0;
      if (!n) return;
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const cur = this.hover ?? n - 1;
        this.hover = Math.max(0, Math.min(n - 1, cur + (e.key === "ArrowLeft" ? -1 : 1)));
        this.drawHover();
      } else if (e.key === "Escape") { this.hover = null; this.drawHover(); }
    });
    this.svg.addEventListener("blur", () => { this.hover = null; this.drawHover(); });
  }

  drawHover() {
    const cfg = this.cfg;
    const layer = $("g.hover", this.svg);
    const at = this.hover == null ? null : this.vis[0][this.hover];
    const values = this.series.map((s, i) => {
      if (!at) return s.rows.at(-1);
      const j = lastIndexAtOrBefore(this.vis[i], at.t);
      return j >= 0 ? this.vis[i][j] : null;
    });
    if (layer) {
      if (!at) layer.innerHTML = "";
      else {
        const x = this.X(at.t);
        let h = `<line class="cross" x1="${x}" x2="${x}" y1="${this.m.t}" y2="${this.H - this.m.b}"/>`;
        values.forEach((r, i) => {
          if (!r || r.t < this.tStart) return;
          const color = cfg.type === "bar" ? "var(--bar)" : `var(${this.series[i].color})`;
          h += `<circle class="dot" cx="${this.X(r.t)}" cy="${this.Ys[i](r.v)}" r="4.5" style="fill:${color}"/>`;
        });
        layer.innerHTML = h;
      }
    }
    const cmp = this.series.length > this.base.length;
    // 數值已在卡片大字顯示的圖表：未觸碰時只顯示提示，避免重複
    if (!at && cfg.idleHint && !cmp) { this.legend.innerHTML = `<span class="lg-hint">${cfg.idleHint}</span>`; return; }
    const dateLabel = (at ? fmtDate(at.d) : `最新（${fmtDate(values[0].d, { year: false })}）`) + (cmp ? "・括號內為所選期間的升跌" : "");
    let lg = `<span class="lg-date">${dateLabel}</span>`;
    values.forEach((r, i) => {
      const s = this.series[i];
      const sw = cfg.type === "bar" ? "var(--bar)" : `var(${s.color})`;
      const first = this.vis[i][0];
      const chg = cmp && r && first ? ` <small class="lg-chg">${pctFmt((r.v / first.v - 1) * 100)}</small>` : "";
      lg += `<span class="lg"><i class="sw${s.dash ? " dash" : ""}" style="--c:${sw}"></i>${esc(s.label)} <b>${r ? (s.fmt ?? cfg.fmt)(r.v) : "—"}</b>${chg}</span>`;
    });
    for (const ref of cfg.refs ?? []) lg += `<span class="lg"><i class="sw dash" style="--c:var(--ref)"></i>${esc(ref.label)}</span>`;
    this.legend.innerHTML = lg;
  }
}

function renderCharts(data) {
  const { weekly: w, daily: d } = data;
  // 兆美元刻度：間距越細，小數位越多
  const tri = (v, step) => `${(v / 1000).toFixed(step >= 1000 ? 0 : step >= 100 ? 1 : 2)}兆`;
  const long = { "1年": 365, "3年": 1095, "全部": null };
  const peak = data.summary.onrrp;

  charts.push(new Chart($("#chart-net"), {
    aria: "市場上的錢（淨流動性）每日走勢，單位兆美元",
    range: "3個月", ranges: { "1個月": 31, "3個月": 92, "1年": 365, "全部": null },
    series: [{ label: "淨流動性", color: "--text", width: 2.5, rows: d.netliq }],
    compare: [
      { key: "btc", label: "BTC", unit: "美元", color: "--c-btc", rows: data.compare.btc, fmt: (v) => v.toLocaleString("en-US", { maximumFractionDigits: v >= 1000 ? 0 : 2 }) },
      { key: "gold", label: "黃金", unit: "美元／盎司", color: "--c-gold", rows: data.compare.gold, fmt: (v) => v.toLocaleString("en-US", { maximumFractionDigits: v >= 1000 ? 0 : 2 }) },
      { key: "eth", label: "ETH", unit: "美元", color: "--c-eth", dash: true, rows: data.compare.eth, fmt: (v) => v.toLocaleString("en-US", { maximumFractionDigits: v >= 1000 ? 0 : 2 }) },
      { key: "usd", label: "美元指數", unit: "指數", color: "--c-usd", rows: data.compare.usd, fmt: (v) => v.toFixed(2) },
    ],
    idleHint: "按圖查看每日數值",
    yTick: tri,
    fmt: (v) => fmtUsd(v, { unit: false }),
  }));

  charts.push(new Chart($("#chart-three"), {
    aria: "準備金、政府戶口及後備資金池走勢，單位兆美元",
    range: "全部", ranges: long,
    series: [
      { label: "準備金", color: "--s1", rows: w.reserves },
      { label: "政府戶口", color: "--s2", rows: w.tga },
      { label: "後備資金池", color: "--s3", rows: d.onrrp },
    ],
    refs: [{ y: 3000, label: "3兆參考水位" }],
    marks: [
      { d: "2019-09-17", label: "2019年9月借錢風波", short: "2019年9月" },
      { d: peak.peak_date, label: "後備資金池高峰", short: "高峰" },
    ],
    zero: true,
    yTick: tri,
    fmt: (v) => fmtUsd(v, { unit: false }),
  }));

  charts.push(new Chart($("#chart-spread"), {
    aria: "SOFR減準備金利率的差距，單位個基點",
    range: "1年", ranges: long,
    series: [{ label: "差距", color: "--text", rows: d.rates, map: (r) => Math.round((r[1] - r[2]) * 1000) / 10 }],
    zero: true,
    yTick: (v) => fmtBp(v),
    fmt: (v) => `${fmtBp(v)}個基點`,
  }));

  charts.push(new Chart($("#chart-srf"), {
    aria: "聯準會隔夜回購操作使用量，單位億美元",
    range: "1年", ranges: long, type: "bar",
    series: [{ label: "使用量", color: "--bar", rows: d.srf }],
    yTick: (v, step) => `${(v * 10).toLocaleString("en-US", { maximumFractionDigits: step * 10 >= 1 ? 0 : 2 })}億`,
    fmt: (v) => fmtUsd(v),
  }));

  charts.push(new Chart($("#chart-yields"), {
    aria: "美國10年及30年期國債殖利率走勢，單位百分比",
    range: "1年", ranges: long,
    series: [
      { label: "10年期", color: "--s1", rows: d.yields, col: 1 },
      { label: "30年期", color: "--s2", rows: d.yields, col: 2 },
    ],
    refs: [{ y: 5, label: "5%" }],
    yTick: (v, step) => `${v.toFixed(step >= 1 ? 0 : step >= 0.1 ? 1 : 2)}%`,
    fmt: (v) => fmtPct(v),
  }));
}

// ---------- 表格 ----------
function renderTables(data) {
  const { weekly: w, daily: d, summary: s, meta } = data;
  const u = (v) => fmtUsd(v, { unit: false });
  const rrpAt = (date) => { let v = null; for (const r of d.onrrp) { if (r[0] > date) break; v = r[1]; } return v; };
  const tga = new Map(w.tga);
  const rows = w.reserves.slice(-8).reverse().map(([date, v]) =>
    `<tr><td>${fmtDate(date)}</td><td class="n">${u(v)}</td><td class="n">${u(tga.get(date))}</td><td class="n">${u(rrpAt(date))}</td></tr>`).join("");
  $("#table-three").innerHTML = `<thead><tr><th>最近8週（週三）</th><th class="n">準備金（週平均）</th><th class="n">政府戶口（週平均）</th><th class="n">後備資金池（當日）</th></tr></thead><tbody>${rows}</tbody>`;

  const fred = (id) => `<a href="https://fred.stlouisfed.org/series/${id}" target="_blank" rel="noopener">FRED ${id}</a>`;
  const dts = `<a href="https://fiscaldata.treasury.gov/datasets/daily-treasury-statement/" target="_blank" rel="noopener">財政部每日報表</a>`;
  const src = [
    ["市場上的錢（淨流動性）", "本站計算", "每日", s.netliq.date, fmtUsd(s.netliq.value)],
    ["準備金", fred("WRESBAL"), "週平均", s.reserves.date, fmtUsd(s.reserves.value)],
    ["政府戶口（週）", fred("WTREGEN"), "週平均", s.tga.date, fmtUsd(s.tga.value)],
    ["政府戶口（日）", dts, "每日收市", s.netliq.date, fmtUsd(s.netliq.tga)],
    ["後備資金池", fred("RRPONTSYD"), "每日", s.onrrp.date, fmtUsd(s.onrrp.value)],
    ["聯準會總資產", fred("WALCL"), "週三", s.netliq.walcl_date, fmtUsd(s.netliq.walcl)],
    ["SOFR", fred("SOFR"), "每日", s.rates.date, fmtPct(s.rates.sofr)],
    ["IORB", fred("IORB"), "每日", s.rates.date, fmtPct(s.rates.iorb)],
    ["緊急借錢（常備回購）", fred("RPONTTLD"), "每日", s.srf.date, fmtUsd(s.srf.value)],
    ["10年期國債", fred("DGS10"), "每日", s.yields.date, fmtPct(s.yields.y10)],
    ["30年期國債", fred("DGS30"), "每日", s.yields.date, fmtPct(s.yields.y30)],
  ];
  const c = s.compare ?? {};
  const px = (v) => v == null ? "—" : v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  const bnb = `<a href="https://www.binance.com/en/trade/PAXG_USDT" target="_blank" rel="noopener">Binance PAXG/USDT</a>`;
  if (c.btc) src.push(["對比：BTC", fred("CBBTCUSD"), "Coinbase每日（美元）", c.btc.date, px(c.btc.value)]);
  if (c.eth) src.push(["對比：ETH", fred("CBETHUSD"), "Coinbase每日（美元）", c.eth.date, px(c.eth.value)]);
  if (c.gold) src.push(["對比：黃金", bnb, "PAXG代幣每日收市（美元，1枚＝1盎司金）", c.gold.date, px(c.gold.value)]);
  if (c.usd) src.push(["對比：美元指數", fred("DTWEXBGS"), "聯準會廣義美元指數", c.usd.date, px(c.usd.value)]);
  // 手機上表格可橫向捲動；數值及日期放前面
  $("#table-sources").innerHTML = `<thead><tr><th>指標</th><th class="n">最新數值</th><th>日期</th><th>來源</th><th>口徑</th></tr></thead><tbody>${src
    .map(([n, link, k, dt, v]) => `<tr><td>${n}</td><td class="n">${v}</td><td>${fmtDate(dt)}</td><td>${link}</td><td>${k}</td></tr>`).join("")}</tbody>`;

  $("#checked-at").textContent = `最後自動抓取：${hkTime(meta.generated_at)}（香港時間）`;
}

function hkTime(iso) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${+p.year}年${+p.month}月${+p.day}日 ${p.hour}:${p.minute}`;
}

function renderStale(data) {
  const { meta, summary: s } = data;
  const notes = [];
  const age = (Date.now() - Date.parse(meta.generated_at)) / 36e5;
  if (age > 36) notes.push(`自動更新可能延誤：最後一次成功抓取數據為${hkTime(meta.generated_at)}（香港時間）。`);
  if ((Date.now() - toT(s.reserves.date)) / DAY > 13) notes.push("準備金數據已超過兩週未有新一期，可能是官方延遲公布或抓取失敗。");
  if (meta.stale?.length) notes.push(`以下序列今次未能更新，暫時沿用上一版數據：${meta.stale.join("、")}。`);
  if (notes.length) { const el = $("#stale-banner"); el.textContent = notes.join(" "); el.hidden = false; }
}

async function main() {
  initTheme();
  let data;
  try {
    const res = await fetch("data/liquidity.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch {
    $("#asof").textContent = "暫時未能載入數據，請稍後重新整理。";
    return;
  }
  renderHero(data);
  renderCharts(data);
  renderTables(data);
  renderStale(data);
}

main();
