# 持倉表市值與未實現報酬率設計

Date: 2026-06-21
Status: Approved design, pending implementation plan

## Context

底部 dock 的「持倉 Positions」表格目前有商品、方向、數量、成本、現價、損益與損益分布。PR3 已經讓持倉表使用統一的現價解析邏輯，並在帳務摘要中計算總市值與總未實現損益報酬率。

使用者現在需要在每一檔股票/ETF 持倉列直接看到：

- 這檔部位目前約占多少市值。
- 這檔部位的未實現損益報酬率。

這兩個欄位主要服務股票/ETF 持倉。期貨與選擇權的「市值」語意更接近名目價值、權利金價值或保證金曝險，不應與股票市值混在同一口徑中。

## Goals

- 在持倉表新增「市值」與「報酬率」兩個欄位。
- 兩個欄位只對股票/ETF 持倉產生實質數值。
- 市值使用與畫面現價一致的價格解析口徑，避免券商原生市值與畫面現價互相矛盾。
- 未實現報酬率使用與帳務摘要一致的成本口徑。
- 新欄位可排序，並沿用既有持倉表排序偏好保存機制。
- 不改後端券商登入、券商 provider mapping 或 Position DTO。

## Non-Goals

- 不新增委託表欄位。
- 不重做帳務 Account 摘要。
- 不顯示台新或玉山原生 `marketValue` / `valueNow` 欄位。
- 不在本次加入欄位顯示/隱藏、拖曳排序、欄寬調整或個人化欄位設定。
- 不重新定義期貨/選擇權的市值、名目曝險或保證金曝險。

## Broker API Findings

目前三家 broker 的持倉 API 欄位並不一致：

- 富邦股票 `unrealizedGainsAndLoses` 回成本、股數、未實現獲利與未實現虧損，但不回現價與市值；目前程式將 `last_price` 設為 `0`，由前端行情補價。
- 台新 Nova `positionSummaries` 型別有 `currentPrice`、`marketValue`、`totalProfit`，但目前 app 只 map 出 `last_price` 與 `pnl`。
- 玉山 `getInventories()` 型別有 `priceNow`、`makeASum`、`valueNow`，目前 app 也只 map 出 `last_price` 與 `pnl`。

因此本次採用前端統一計算，原因是：

- 富邦沒有可直接顯示的股票市值欄位。
- 台新/玉山的原生市值可能與 app 畫面現價來源不同。
- PR3 已建立可跨券商運作的現價解析，適合作為畫面欄位的單一口徑。

## Data Definitions

新增欄位只適用股票/ETF row。實作時可沿用目前 `StockPosition` 與 `FuturePosition` 的型別差異，使用 `yd_quantity` 欄位辨識股票持倉。

### 市值

```text
市值 = displayPrice.value × quantity × 1000
```

- `displayPrice.value` 來自既有持倉表現價解析。
- `quantity` 是 app 現有股票持倉單位，對一般股票/ETF 為張。
- `1000` 是每張股數。
- 若現價缺資料，市值為空值，畫面顯示 `—`。

### 未實現報酬率

```text
成本 = averagePrice × quantity × 1000
報酬率 = pnl ÷ 成本
```

- `averagePrice` 使用持倉 row 的 `price`。
- `pnl` 使用券商 provider 已 map 出的未實現損益。
- 若成本小於等於 0，報酬率為空值，畫面顯示 `—`。
- 即使現價缺資料，只要成本與 `pnl` 有效，報酬率仍可顯示。

### 非股票/ETF Row

期貨與選擇權 row 在「市值」與「報酬率」欄位顯示 `—`，tooltip 顯示：

```text
僅股票/ETF 適用
```

## UI Design

持倉表欄位順序調整為：

```text
商品 / 方向 / 數量 / 成本 / 現價 / 市值 / 損益 / 報酬率 / 損益分布 / 操作
```

設計理由：

- 「市值」緊接「現價」，方便使用者從價格看到曝險。
- 「報酬率」緊接「損益」，方便比較金額損益與百分比表現。
- 「損益分布」維持在損益相關欄位之後。

顯示格式：

- 市值使用既有金額格式。
- 報酬率使用既有百分比格式。
- 報酬率正負方向可沿用損益文字顏色：正數用上漲色、負數用下跌色、零值中性。
- 空值顯示 `—`，不顯示 `0`，避免誤導。

## Sorting

新增兩個持倉排序 key：

- `marketValue`
- `returnRate`

互動沿用現有持倉表排序模式：

- 點欄位標題切換升冪/降冪。
- 空值永遠排最後。
- 同值保留原始穩定順序。
- 排序偏好繼續存入既有 positions sort localStorage key。
- 初次打開持倉表時仍維持目前預設：沒有使用者偏好時不主動重排。

排序語意：

- `市值` 依計算後市值排序。
- `報酬率` 依計算後未實現報酬率排序。
- 期貨/選擇權因這兩個欄位為空值，排序時排在最後。

## Implementation Boundaries

建議把列級計算放在前端 helper，而不是直接寫在 JSX 中。 helper 應輸入持倉、解析後現價與合約資訊，輸出表格 row 使用的衍生值：

```ts
interface PositionMetrics {
    marketValue?: number;
    unrealizedReturnRate?: number;
    appliesToStock: boolean;
}
```

持倉表整合點：

- `PositionsTable` 建立 display rows 時，同步計算 `marketValue` 與 `unrealizedReturnRate`。
- `comparePositionRows` 擴充排序 key。
- 表頭新增兩個 sortable headers。
- body 新增兩個 cell。

不需要改：

- 後端 `/api/v1/portfolio/position_unit` 回傳 shape。
- 富邦、台新、玉山 provider mapping。
- 帳務摘要演算法。
- 券商登入精靈或安全儲存流程。

## Testing Plan

單元測試：

- 股票/ETF 市值計算為 `displayPrice.value × quantity × 1000`。
- 股票/ETF 未實現報酬率計算為 `pnl ÷ (price × quantity × 1000)`。
- 現價缺資料時市值為空值。
- 現價缺資料但成本與 `pnl` 有效時，報酬率仍可計算。
- 成本小於等於 0 時，報酬率為空值。
- 期貨/選擇權不產生市值與報酬率。
- `marketValue` 排序使用計算後市值，空值排最後。
- `returnRate` 排序使用計算後報酬率，空值排最後。

驗證：

- `CI=true pnpm test`
- `CI=true pnpm build`

`desktop:build` 不作為本次最小驗證門檻，除非實作過程碰到桌面/Tauri 專屬路徑。

## Acceptance Criteria

- 持倉表看到「市值」與「報酬率」欄位。
- 股票/ETF row 依畫面現價顯示市值。
- 股票/ETF row 依券商未實現損益與成本顯示報酬率。
- 富邦股票即使 provider 不回原生市值，也可在有行情補價時顯示市值。
- 期貨/選擇權 row 在新欄位顯示 `—`，並提示僅股票/ETF 適用。
- `市值` 與 `報酬率` 欄位可排序，排序偏好可保存。
- 沒有使用者排序偏好時，持倉表初次打開不被新欄位改變順序。

## Future Work

- 持倉表欄位顯示/隱藏設定。
- 持倉表欄位順序個人化。
- 欄寬或密度偏好保存。
- 顯示券商原生市值作為 debug tooltip 或進階比較欄位。
- 另外設計期貨/選擇權的名目曝險、權利金市值或保證金曝險欄位。
