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

// ---------- 首屏 ----------
function splitUsd(b) {
  const s = fmtUsd(b, { unit: false });
  const m = s.match(/^(.*?)(兆|億)$/);
  return m ? [m[1], m[2] + "美元"] : [s, ""];
}
const pctText = (p) => (p < 0.1 ? p.toFixed(2) : p < 10 ? p.toFixed(1) : p.toFixed(0)) + "%";

function kpi({ id, color, name, def, value, chg, note, chip }) {
  const [n, unit] = splitUsd(value);
  return `<article class="kpi" data-od-id="kpi-${id}">
    <h2 class="kpi-name"><i class="sw" style="--c:var(${color})"></i>${name}</h2>
    <p class="kpi-def">${def}</p>
    <p class="kpi-val">${n}<small>${unit}</small></p>
    <p class="kpi-chg"><span>${chg}</span><span>${note}</span></p>
    <span class="chip ${chip[0]}">${chip[1]}</span>
  </article>`;
}

function renderHero(data) {
  const s = data.summary;
  $("#asof").textContent = `週數據截至${fmtDate(s.reserves.date)}・日數據截至${fmtDate(s.onrrp.date, { year: false })}`;
  // 按逗號分句，每句不拆開換行，避免「參考水／位」這類斷字
  const parts = s.headline.title.split("，");
  $("#headline").innerHTML = parts.map((p, i) => `<span class="clause">${esc(p)}${i < parts.length - 1 ? "，" : ""}</span>`).join("");
  $("#lede").textContent = s.headline.lede;

  const signed = (v) => fmtUsd(v, { signed: true, unit: false });
  $("#kpis").innerHTML = [
    kpi({
      id: "reserves", color: "--s1", name: "準備金", def: "銀行在聯準會的結算資金",
      value: s.reserves.value,
      chg: `較上週 <b class="num">${signed(s.reserves.chg_w)}</b>`,
      note: `${fmtDate(s.reserves.date, { year: false })}止一週平均`,
      chip: s.reserves.below_ref
        ? ["watch", `低於3兆參考水位 ${signed(s.reserves.gap_ref)}`]
        : ["good", `高於3兆參考水位 ${signed(s.reserves.gap_ref)}`],
    }),
    kpi({
      id: "tga", color: "--s2", name: "TGA", def: "財政部在聯準會的現金戶口",
      value: s.tga.value,
      chg: `較上週 <b class="num">${signed(s.tga.chg_w)}</b>`,
      note: `${fmtDate(s.tga.date, { year: false })}止一週平均`,
      chip: s.tga.chg_w > 0 ? ["watch", "上升中：資金流入政府水缸"] : ["good", "回落中：資金流回市場水缸"],
    }),
    kpi({
      id: "onrrp", color: "--s3", name: "ON RRP", def: "機構隔夜停泊現金的氣墊",
      value: s.onrrp.value,
      chg: `高峰 <b class="num">${fmtUsd(s.onrrp.peak, { unit: false })}</b>（${fmtMonth(s.onrrp.peak_date)}）`,
      note: `${fmtDate(s.onrrp.date, { year: false })}數值`,
      chip: s.onrrp.cushion_low
        ? ["watch", `只剩高峰的${pctText(s.onrrp.pct_of_peak)}`]
        : ["good", `約為高峰的${pctText(s.onrrp.pct_of_peak)}`],
    }),
  ].join("");

  const r = s.rates, f = s.srf;
  const tone = r.status === "above" || f.status === "heavy" ? "alert" : r.status === "at" || f.status === "some" ? "watch" : "good";
  const overall = { good: "未見壓力", watch: "未見持續壓力，值得留意", alert: "出現壓力訊號" }[tone];
  $("#pressure-card").innerHTML = `<section class="pressure" data-od-id="pressure-card" aria-label="年末壓力訊號">
    <div class="pressure-head"><h2>年末壓力訊號</h2><span class="chip ${tone}">${overall}</span></div>
    <div class="pm">
      <span class="pm-name">SOFR相對IORB</span><span class="pm-val num">${fmtBp(r.spread_bp)}個基點</span>
      <span class="pm-def">SOFR ${fmtPct(r.sofr)}（隔夜借美元的市場利率）減IORB ${fmtPct(r.iorb)}（聯準會付給銀行的利率）；近5日平均${fmtBp(r.avg5_bp)}個基點，${RATE_STATUS[r.status].label}</span>
    </div>
    <div class="pm">
      <span class="pm-name">常備回購</span><span class="pm-val num">${fmtUsd(f.value)}</span>
      <span class="pm-def">聯準會隨時開放的短期借錢窗口；${fmtDate(f.date, { year: false })}數值，近5日最高${fmtUsd(f.max5)}，${SRF_STATUS[f.status].label}</span>
    </div>
  </section>`;
}

function bindValues(s) {
  const fmts = { usd: (v) => fmtUsd(v), date: (v) => fmtDate(v), month: fmtMonth };
  for (const el of document.querySelectorAll("[data-v]")) {
    const [path, f] = el.dataset.v.split("|");
    const v = path.split(".").reduce((o, k) => o?.[k], s);
    if (v != null) el.textContent = fmts[f] ? fmts[f](v) : v;
  }
  const n = s.netliq;
  const u = (v) => fmtUsd(v, { unit: false });
  $("#formula").innerHTML = `
    <span>聯準會總資產</span><b>${u(n.walcl)}</b><span class="eq">−</span>
    <span>TGA</span><b>${u(n.tga)}</b><span class="eq">−</span>
    <span>ON RRP</span><b>${u(n.rrp_wed)}</b><span class="eq">＝</span>
    <span class="total"><b>${fmtUsd(n.value)}</b></span>
    <span>（${fmtDate(n.date, { year: false })}；較上週${fmtUsd(n.chg_w, { signed: true })}）</span>`;
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

class Chart {
  constructor(el, cfg) {
    this.el = el;
    this.cfg = cfg;
    this.range = cfg.range;
    this.series = cfg.series.map((s) => ({
      ...s,
      rows: s.rows.filter((r) => r[s.col ?? 1] != null).map((r) => ({ d: r[0], t: toT(r[0]), v: s.map ? s.map(r) : r[s.col ?? 1] })),
    }));
    el.innerHTML = `<div class="chart-top"><div class="legend"></div>
      <div class="seg" role="group" aria-label="時間範圍">${Object.keys(cfg.ranges)
        .map((k) => `<button type="button" data-r="${k}" aria-pressed="${k === this.range}">${k}</button>`).join("")}</div></div>
      <div class="plot"><svg tabindex="0" role="img" aria-label="${esc(cfg.aria)}"></svg></div>`;
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
    const H = narrow ? 210 : 280;
    const tEnd = Math.max(...this.series.map((s) => s.rows.at(-1).t));
    const days = cfg.ranges[this.range];
    const tStart = days ? tEnd - days * DAY : Math.min(...this.series.map((s) => s.rows[0].t));

    const vis = this.series.map((s) => {
      const i0 = Math.max(0, lastIndexAtOrBefore(s.rows, tStart));
      return s.rows.slice(s.rows[i0].t < tStart && i0 + 1 < s.rows.length ? i0 + 1 : i0);
    });
    let lo = Infinity, hi = -Infinity;
    for (const rows of vis) for (const r of rows) { if (r.v < lo) lo = r.v; if (r.v > hi) hi = r.v; }
    for (const ref of cfg.refs ?? []) { lo = Math.min(lo, ref.y); hi = Math.max(hi, ref.y); }
    if (cfg.zero || cfg.type === "bar") { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
    const ticks = niceTicks(lo, hi, narrow ? 4 : 5);
    lo = ticks[0]; hi = ticks.at(-1);
    const labels = ticks.map(cfg.yTick);
    const ml = Math.max(...labels.map((l) => l.length)) * 7 + 10;
    const m = { l: ml, r: 8, t: cfg.marks ? 20 : 8, b: 22 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    const X = (t) => m.l + ((t - tStart) / (tEnd - tStart)) * pw;
    const Y = (v) => m.t + (1 - (v - lo) / (hi - lo)) * ph;
    Object.assign(this, { W, H, m, X, Y, tStart, tEnd, vis, pw });

    let g = `<g class="grid">`;
    ticks.forEach((v, i) => {
      g += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}"/>`;
      g += `<text x="${m.l - 6}" y="${Y(v) + 4}" text-anchor="end">${labels[i]}</text>`;
    });
    g += `</g>`;

    // X 軸：跨度長用年份，短用月份
    const span = (tEnd - tStart) / DAY;
    const xt = [];
    const s0 = new Date(tStart), s1 = new Date(tEnd);
    if (span > 500) {
      for (let y = s0.getUTCFullYear() + 1; y <= s1.getUTCFullYear(); y++) xt.push([Date.UTC(y, 0, 1), String(y)]);
    } else {
      const step = narrow ? 3 : 2;
      for (let d = new Date(Date.UTC(s0.getUTCFullYear(), s0.getUTCMonth() + 1, 1)); d <= s1; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) {
        if (d.getUTCMonth() % step !== 0) continue;
        xt.push([d.getTime(), d.getUTCMonth() === 0 ? String(d.getUTCFullYear()) : `${d.getUTCMonth() + 1}月`]);
      }
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
        for (const [k, v] of buckets) if (v > 0) d += `M${k + 0.5} ${Y(0)}V${Math.min(Y(v), Y(0) - 1)}`;
        paths += `<path class="bars" d="${d}" style="stroke-width:${bw}"/>`;
      } else {
        // 每個像素只保留首、最低、最高、尾四點，保留形狀並減少節點
        let d = "", cur = null, pts = [];
        const flush = () => {
          if (!pts.length) return;
          const a = pts[0], z = pts.at(-1);
          let mn = a, mx = a;
          for (const p of pts) { if (p.v < mn.v) mn = p; if (p.v > mx.v) mx = p; }
          for (const p of [a, mn, mx, z].sort((p, q) => p.t - q.t)) d += `${d ? "L" : "M"}${X(p.t).toFixed(1)} ${Y(p.v).toFixed(1)}`;
          pts = [];
        };
        for (const r of rows) { const k = Math.round(X(r.t)); if (k !== cur) { flush(); cur = k; } pts.push(r); }
        flush();
        paths += `<path class="series" d="${d}" style="stroke:var(${s.color})"/>`;
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
          if (!r) return;
          const color = cfg.type === "bar" ? "var(--bar)" : `var(${this.series[i].color})`;
          h += `<circle class="dot" cx="${this.X(r.t)}" cy="${this.Y(r.v)}" r="4.5" style="fill:${color}"/>`;
        });
        layer.innerHTML = h;
      }
    }
    const dateLabel = at ? fmtDate(at.d) : `最新（${fmtDate(values[0].d, { year: false })}）`;
    let lg = `<span class="lg-date">${dateLabel}</span>`;
    values.forEach((r, i) => {
      const s = this.series[i];
      const sw = cfg.type === "bar" ? "var(--bar)" : `var(${s.color})`;
      lg += `<span class="lg"><i class="sw" style="--c:${sw}"></i>${esc(s.label)} <b>${r ? cfg.fmt(r.v) : "—"}</b></span>`;
    });
    for (const ref of cfg.refs ?? []) lg += `<span class="lg"><i class="sw dash" style="--c:var(--ref)"></i>${esc(ref.label)}</span>`;
    this.legend.innerHTML = lg;
  }
}

function renderCharts(data) {
  const { weekly: w, daily: d } = data;
  const tri = (v) => `${(v / 1000).toFixed(Math.abs(v) % 1000 === 0 ? 0 : 1)}兆`;
  const range3 = { "1年": 365, "3年": 1095, "全部": null };
  const peak = data.summary.onrrp;

  charts.push(new Chart($("#chart-three"), {
    aria: "準備金、TGA及ON RRP走勢圖，單位兆美元",
    range: "全部", ranges: range3,
    series: [
      { label: "準備金", color: "--s1", rows: w.reserves },
      { label: "TGA", color: "--s2", rows: w.tga },
      { label: "ON RRP", color: "--s3", rows: d.onrrp },
    ],
    refs: [{ y: 3000, label: "3兆參考水位（非官方紅線）" }],
    marks: [
      { d: "2019-09-17", label: "2019年9月回購風波", short: "2019年9月" },
      { d: peak.peak_date, label: "ON RRP高峰", short: "RRP高峰" },
    ],
    zero: true,
    yTick: tri,
    fmt: (v) => fmtUsd(v, { unit: false }),
  }));

  charts.push(new Chart($("#chart-net"), {
    aria: "淨流動性代理指標走勢圖，單位兆美元",
    range: "3年", ranges: range3,
    series: [{ label: "淨流動性代理指標", color: "--accent", rows: w.netliq, col: 4 }],
    yTick: tri,
    fmt: (v) => fmtUsd(v, { unit: false }),
  }));

  charts.push(new Chart($("#chart-spread"), {
    aria: "SOFR減準備金利率的差距，單位個基點",
    range: "1年", ranges: range3,
    series: [{ label: "SOFR − IORB", color: "--text", rows: d.rates, map: (r) => Math.round((r[1] - r[2]) * 1000) / 10 }],
    zero: true,
    yTick: (v) => fmtBp(v),
    fmt: (v) => `${fmtBp(v)}個基點`,
  }));

  charts.push(new Chart($("#chart-srf"), {
    aria: "聯準會隔夜回購操作使用量，單位億美元",
    range: "1年", ranges: range3, type: "bar",
    series: [{ label: "使用量", color: "--bar", rows: d.srf }],
    yTick: (v) => `${Math.round(v * 10).toLocaleString("en-US")}億`,
    fmt: (v) => fmtUsd(v),
  }));

  charts.push(new Chart($("#chart-yields"), {
    aria: "美國10年及30年期國債殖利率走勢圖，單位百分比",
    range: "1年", ranges: range3,
    series: [
      { label: "10年期", color: "--s1", rows: d.yields, col: 1 },
      { label: "30年期", color: "--s2", rows: d.yields, col: 2 },
    ],
    refs: [{ y: 5, label: "5%" }],
    yTick: (v) => `${v.toFixed(v % 1 ? 1 : 0)}%`,
    fmt: (v) => fmtPct(v),
  }));
}

// ---------- 表格 ----------
function renderTables(data) {
  const { weekly: w, daily: d, summary: s, meta } = data;
  const u = (v) => fmtUsd(v, { unit: false });
  const rrpAt = (date) => { let v = null; for (const r of d.onrrp) { if (r[0] > date) break; v = r[1]; } return v; };
  const tga = new Map(w.tga), net = new Map(w.netliq.map((r) => [r[0], r[4]]));
  const rows = w.reserves.slice(-8).reverse().map(([date, v]) =>
    `<tr><td>${fmtDate(date)}</td><td class="n">${u(v)}</td><td class="n">${u(tga.get(date))}</td><td class="n">${u(rrpAt(date))}</td><td class="n">${u(net.get(date))}</td></tr>`).join("");
  $("#table-three").innerHTML = `<thead><tr><th>週三</th><th class="n">準備金（週平均）</th><th class="n">TGA（週平均）</th><th class="n">ON RRP（當日）</th><th class="n">淨流動性代理</th></tr></thead><tbody>${rows}</tbody>`;

  const fred = (id) => `<a href="https://fred.stlouisfed.org/series/${id}" target="_blank" rel="noopener">${id}</a>`;
  const src = [
    ["準備金", "WRESBAL", "週平均（截至週三）", s.reserves.date, fmtUsd(s.reserves.value)],
    ["TGA", "WTREGEN", "週平均（截至週三）", s.tga.date, fmtUsd(s.tga.value)],
    ["ON RRP", "RRPONTSYD", "每日", s.onrrp.date, fmtUsd(s.onrrp.value)],
    ["聯準會總資產", "WALCL", "週三水平", s.netliq.date, fmtUsd(s.netliq.walcl)],
    ["SOFR", "SOFR", "每日", s.rates.date, fmtPct(s.rates.sofr)],
    ["IORB", "IORB", "每日", s.rates.date, fmtPct(s.rates.iorb)],
    ["常備回購", "RPONTTLD", "每日", s.srf.date, fmtUsd(s.srf.value)],
    ["10年期殖利率", "DGS10", "每日", s.yields.date, fmtPct(s.yields.y10)],
    ["30年期殖利率", "DGS30", "每日", s.yields.date, fmtPct(s.yields.y30)],
  ];
  // 手機上表格可橫向捲動；最重要的數值及日期放前面
  $("#table-sources").innerHTML = `<thead><tr><th>指標</th><th class="n">最新數值</th><th>最新日期</th><th>FRED代號</th><th>口徑</th></tr></thead><tbody>${src
    .map(([n, id, k, dt, v]) => `<tr><td>${n}</td><td class="n">${v}</td><td>${fmtDate(dt)}</td><td>${fred(id)}</td><td>${k}</td></tr>`).join("")}</tbody>`;

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
  bindValues(data.summary);
  renderCharts(data);
  renderTables(data);
  renderStale(data);
}

main();
