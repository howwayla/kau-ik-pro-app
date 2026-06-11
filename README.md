# Nova Pro — 專業交易終端 Trading Terminal

A professional, fully-customizable trading terminal for Taiwan markets
(TWSE / TPEX / TAIFEX). Forked from
[shioaji-pro-app](https://github.com/Sinotrade/shioaji-pro-app) and rewired to:

- **交易** — 台新 [Nova API](https://ml-fugle-api.tssco.com.tw/FugleSDK/docs/trading/introduction/)（`taishin-sdk`）
  或富邦[新一代 API](https://www.fbs.com.tw/TradeAPI/docs/trading/introduction)（`fubon-neo`）
- **行情** — [富果行情 API](https://developer.fugle.tw/docs/data/intro)（REST + WebSocket）

React 19 + TypeScript + Vite 前端維持不變，原本的 shioaji sidecar 改為
本 repo 內建的 **Node.js local server**（`server/`），對前端提供相同的
REST + SSE 介面（`127.0.0.1:8080`），對外橋接券商 SDK 與富果行情。

```
React 前端 ── HTTP REST + SSE ──► server/（Fastify）
                                    ├─ TRADE_PROVIDER:  mock │ fubon │ nova
                                    └─ MARKET_PROVIDER: mock │ fugle
```

預設 **mock 模式**：不需要任何憑證即可完整體驗（確定性模擬行情 +
紙上交易撮合），拿到 API key / 憑證後切換環境變數即接真實來源。

以專業交易終端為目標：即時行情、K 線、五檔、閃電下單、圖表點價下單、
停損停利觸價單、可拖拉的自訂版面。

![Nova Pro — 富果即時行情（試撮時段，注意試/處標記）](docs/screenshot-dark.png)

| Dark | Light |
|------|-------|
| ![dark](docs/screenshot-dark.png) | ![light](docs/screenshot-light.png) |

## Features 功能

- **即時行情** — 單一 SSE 連線串流 tick / 五檔，自選清單成交閃動（只在真實成交時閃，試撮不閃）
- **K 線圖** — lightweight-charts，1m/5m/15m/60m/1D，即時 tick 更新當根 K 棒
  - **點價下單**：點圖表價位直接限價買賣
  - **停損 / 停利**：在圖上掛觸價單（觸價送市價單），虛線顯示、可取消
  - **委託管理**：未成交委託顯示為實線、overlay 有 CANCEL 按鈕、**拖曳委託線即改價**
  - **Hover 同步**：十字線價位即時同步到下單面板
- **閃電下單** — 價格梯點擊即下單（左欄買/右欄賣），含安全開關
- **五檔報價** — 量能條視覺化，點價帶入下單面板
- **成交明細** — 開啟即載入歷史 tick
- **下單面板** — 整股/零股、ROD/IOC/FOK、期貨倉別，兩段式確認防誤觸
- **持倉 / 委託 / 帳務** — 即時損益、刪單、權益數與保證金
- **排行榜** — 漲幅 / 量 / 額 scanner，點擊即加入追蹤
- **交易安全** — 風控 Kill Switch（單筆上限/日虧上限/一鍵鎖單）、
  Esc×2 全部刪單、括號單（成交後自動掛 OCO 停損停利）、持倉一鍵平倉/反手、
  委託改量、下單預估成本（手續費/稅/契約值）
- **快捷鍵** — B/S 切換買賣、Esc×2 全刪單、⌘K 商品搜尋跳轉
- **技術指標** — MA5/10/20/60、EMA、布林通道、VWAP 疊圖
- **大盤狀態列** — 加權指數與台指期基差常駐頂部
- **到價警示** — 圖上點擊設警示線（只通知不下單），音效＋toast
- **分析面板** — 損益分析（權益曲線/勝率/賺賠比）、分價量表＋內外盤比、
  個股籌碼卡（融資券/借券/處置股）、選擇權 T 字報價（TXO）
- **行情回放** — 重播當日歷史 tick 練盤感（1x–100x 變速）
- **委託簿熱圖** — 五檔掛單牆的時間序列視覺化
- **自訂版面** — react-grid-layout 拖拉移動/縮放，面板可任意新增（多開 K 線圖）、
  每個面板可「連動自選」或「鎖定商品」、可彈出成獨立視窗（多螢幕）、
  版面可命名儲存/載入
- **音效回報** — 成交/委託/警示分音色（可關閉）
- **斷線自愈** — SSE 重連後自動重新訂閱所有商品
- **主題** — 深色 / 純黑 / 淺色 × 紅漲綠跌(台式) / 綠漲紅跌(美式)

## 券商支援矩陣

| Provider | 證券下單 | 期貨/選擇權下單 | 登入方式 | 狀態 |
|---|---|---|---|---|
| `mock`（預設） | ✅ 模擬撮合 | ✅ 模擬撮合 + 保證金 | 不需要 | 可用 |
| `fubon` 富邦新一代 | ✅ | ✅ | 身分證字號＋密碼＋憑證 .pfx | Skeleton（照官方文件實作，待 SDK 實測，搜尋 `TODO(verify)`） |
| `nova` 台新 Nova | ✅ | ❌（前端自動隱藏期權下單 UI） | 身分證字號＋密碼＋憑證 .pfx | Skeleton（Phase 3，搜尋 `TODO(phase3)`） |

行情：`mock`（預設）或 `fugle`（富果，已支援 — 在 app 表頭「行情」選單貼上
API Key 即可切換，免改設定檔）。注意：**台指期／選擇權行情需要富果方案包含
期權行情**，若 API 回 403 會自動降級（證券行情不受影響，期權面板顯示無資料），
server log 會有明確警告。

期權下單能力由 server 在 `GET /api/v1/info` 回傳的
`capabilities.futures_trading` 決定，前端據此顯示/隱藏期權下單介面 —
期權**行情**（選擇權 T 字報價、台指期基差）無論哪家券商都保留。

## Getting Started 開始使用

### 1. Prerequisites 前置需求

- [Node.js](https://nodejs.org/) 20+ 與 [pnpm](https://pnpm.io/)
- （mock 模式不需要其他東西）

### 2. 安裝與啟動（mock 模式）

```sh
pnpm install
pnpm dev:all     # 同時啟動 vite 前端 + server（mock 行情與交易）
```

開啟 [http://localhost:5173](http://localhost:5173) —— dev server 會把
`/api` 代理到 `localhost:8080`。頂部會顯示「模擬環境」徽章。

也可以分開跑：`pnpm dev:server`（後端）+ `pnpm dev`（前端）。

### 3. 接真實券商 / 行情（之後）

```sh
cp .env.example .env   # 填入金鑰；.env 已被 .gitignore 排除，請勿 commit
```

- **富果行情**：到 [developer.fugle.tw](https://developer.fugle.tw/) 申請
  API key，設 `MARKET_PROVIDER=fugle`、`FUGLE_API_KEY=...`
  （注意各方案的 WebSocket 訂閱數與 REST rate limit）
- **富邦交易**：開戶＋申請憑證後，從官網下載 `fubon-neo-<version>.tgz`
  放入 `server/vendor/`，執行
  `pnpm --filter nova-pro-server add file:vendor/fubon-neo-<version>.tgz`，
  設 `TRADE_PROVIDER=fubon` 與 `BROKER_*` 四個變數，
  並解掉 `server/src/providers/fubon/` 內所有 `TODO(verify)`
- **台新 Nova 交易**：同上模式，SDK 為 `taishinsdk-<version>.tgz`，
  設 `TRADE_PROVIDER=nova`，完成 `TODO(phase3)`

> ⚠️ 接上真實券商後，每一筆委託都是真實交易。請先以最小單位（零股／
> 一口小台）驗證所有 `TODO(verify)` 的欄位對應，再正常使用。

## Server API（與前端的契約）

`server/` 完整複刻原 shioaji sidecar 的介面：`/api/v1/health`、`/info`、
`/auth/accounts`、`/data/{contracts,snapshots,kbars,ticks,scanner,credit_enquire,short_stock_sources,regulatory_punish}`、
`/stream/{subscribe,unsubscribe,data(SSE)}`、
`/order/{place_order,cancel_order,update_price,update_qty,trades}`、
`/portfolio/{position_unit,account_balance,margin,profit_loss}`、`/watchlist`。

SSE events：`tick_stk` / `tick_fop` / `bidask_stk` / `bidask_fop` /
`order_event` / `heartbeat`。

## Desktop App 桌面版（暫未接線）

`src-tauri/` 保留自原專案，但目前以 web 模式開發為主；Node server
尚未包裝為 Tauri sidecar。

## Safety notes 安全提醒與免責聲明

- 預設為**模擬環境**；頂部會顯示「模擬環境」徽章，正式環境為紅色「正式環境」
- 閃電下單預設**鎖定**，需手動啟用；圖表點價下單為 one-shot 模式
- 停損/停利為**客戶端觸價單**，只在頁面開啟時監控
- 正式環境的每一筆委託都是真實交易，請自行承擔風險

> **免責聲明**：本軟體為開源專案，依 MIT 授權「現狀（AS IS）」提供，
> 不附任何明示或默示之保證。本軟體非投資建議；串接真實券商後之所有
> 交易盈虧、因軟體缺陷／行情延遲／斷線等造成之任何損失，均由使用者
> 自行承擔。作者與貢獻者不對任何交易結果負責。憑證、密碼與 API Key
> 僅儲存於使用者本機，請妥善保管。

## Stack

- React 19 + TypeScript + Vite 8
- [vanilla-extract](https://vanilla-extract.style/) — zero-runtime themable CSS
- [lightweight-charts](https://tradingview.github.io/lightweight-charts/) v5
- [react-grid-layout](https://github.com/react-grid-layout/react-grid-layout) v2
- [Fastify](https://fastify.dev/) local server — REST + Server-Sent Events
- 台新 Nova API / 富邦新一代 API（交易）＋富果行情 API（行情）

## License

MIT — 見 [LICENSE](LICENSE)。本專案 fork 自
[Sinotrade/shioaji-pro-app](https://github.com/Sinotrade/shioaji-pro-app)（MIT），
保留原作者版權聲明；修改與新增部分版權屬本專案作者。
「Shioaji」「Nova」「富果」等名稱為各原公司之商標，僅作描述性使用。
