# 美元水管｜USD Liquidity

公開網址：https://myttttttt.github.io/usd-liquidity/

每日自動更新的美元流動性觀察頁：銀行準備金、財政部 TGA、ON RRP、淨流動性代理指標，以及年末資金壓力訊號（SOFR 相對 IORB、常備回購使用量、10 年及 30 年期殖利率）。框架來自 2026 年 9 月 FOMC 講座「美元水管」一節。

屬情境觀察及教育用途，不構成投資建議。

## 運作方式

- 數據：FRED 官方 CSV（免 API key），序列見 `scripts/lib.mjs` 的 `SERIES`。
- 自動更新：`.github/workflows/update.yml`。主觸發為 cron-job.org（每日香港 03:30、06:30、21:30，workflow_dispatch）；GitHub 排程每 3 小時一次作後備（可能延遲或漏班）；測試 → 抓數 → 檢查 → 官方數據有新一期才 commit → 部署 GitHub Pages。
- 單一序列抓取失敗會沿用上一版（`data/raw.json`）並在網頁標示；結構或數值不合理則工作流程失敗，GitHub 會發通知。
- 網頁：純靜態 `site/`，手寫 SVG 圖表，沒有外部圖表庫；數字格式及結論規則在 `site/assets/format.mjs`，網頁與數據腳本共用。

## 本機

```bash
node scripts/build-data.mjs        # 重新抓數
npm test                           # 規則回歸測試（不連網）
node scripts/verify-fred.mjs       # 核對網頁數據與 FRED 同日數值
PORT=3071 node scripts/serve.mjs   # 本機預覽
```

## 資料來源

Federal Reserve Bank of St. Louis, FRED；Board of Governors of the Federal Reserve System（H.4.1、H.15）；Federal Reserve Bank of New York（SOFR、ON RRP、回購操作）。本站與上述機構沒有關係。
