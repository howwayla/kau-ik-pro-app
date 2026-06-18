# PR3 Design: 持倉/委託表格商品顯示、排序與現價來源

Date: 2026-06-19
Status: Approved design, pending implementation plan

## Context

底部 dock 的「持倉 Positions / 委託 Orders / 帳務 Account」目前有三個使用者體驗缺口：

1. 持倉與委託表格只顯示商品代碼，沒有中文簡稱；自選清單已有代碼、名稱與標記的顯示方式，但表格沒有共用。
2. 持倉與委託表格不能排序，使用者無法快速依損益、數量、現價、狀態或時間整理資料。
3. 持倉表的「現價」目前主要直接顯示券商持倉資料的 `last_price`。部分券商或商品可能不回現價，例如富邦股票持倉可能為 `0`，非盤中也應優先用最近收盤價，而不是顯示錯誤或不明來源的價格。

## Goals

- 讓自選清單、持倉表、委託表共用同一套商品顯示邏輯。
- 在持倉與委託表格加入可理解、可記住的排序互動。
- 讓持倉表的現價欄位使用統一資料來源優先序，並清楚標示價格來源。
- 讓帳務摘要的市值與今日未實現損益使用同一套現價解析，避免券商 `last_price = 0` 時造成數字失真。
- 保持非技術使用者可理解：看得到中文名、價格來源、排序狀態，不需要知道 API 細節。

## Non-Goals

- 不改券商登入、憑證或 API onboarding 流程。
- 不重新設計帳務 Account 的版面；帳務本次維持卡片/摘要。
- 不改券商後端回傳格式，除非實作時發現需要補非常小的型別欄位。
- 不新增進階篩選、欄位自訂、匯出 CSV 或多表格群組功能。

## User Decisions

- 商品顯示採用共用 `SymbolCell` 方向，讓自選清單和持倉/委託表格共用代碼、中文簡稱、標記顯示。
- 排序範圍：持倉與委託表格；帳務摘要先不改。
- 排序狀態：每個表格各自記住欄位與升降冪，關掉 app 後仍保留。
- 預設排序：持倉第一次打開維持穩定原順序；委託第一次打開用時間新到舊。
- 現價口徑：即時行情優先；沒有即時資料或非盤中時用行情 snapshot 的最近收盤價；再沒有才用券商回報價或參考價。
- 現價呈現：價格旁顯示小標記，例如「即時」「收盤」「券商」「參考」，完整說明放在 tooltip。
- 可排序欄位：
  - 持倉：商品、方向、數量、成本、現價、損益。
  - 委託：商品、買賣、價格、數量、狀態、時間。

## Proposed Architecture

### 1. Shared Symbol Display

新增共用商品顯示元件，建議拆成兩層：

- `SymbolCell`: 純顯示元件，接受代碼、中文名、狀態標記與尺寸/密度設定。
- `ResolvedSymbolCell`: 表格用便利元件，接受代碼與可選商品類型，透過既有 contract cache 補中文名，再交給 `SymbolCell` 顯示。

自選清單已有合約資料，應直接使用 `SymbolCell`，避免重複查詢。持倉與委託表格可使用 `ResolvedSymbolCell`，先顯示代碼，中文名查到後自然補上。若查詢失敗，畫面維持代碼，不阻塞整張表格。

標記來源沿用既有邏輯：

- 注意股、處置股：沿用 `useRegulatoryFlag`。
- 試算撮合：自選清單可從 tick 狀態傳入標記；表格若沒有 tick 資訊則不顯示。

### 2. Position Price Resolver

新增前端現價解析能力，讓持倉表和帳務摘要使用一致邏輯。輸入應包含：

- 商品代碼與可選商品類型。
- 券商持倉回傳的 `last_price`。
- contract cache 裡的 `reference` / `previous_close` 等合約資料。
- 目前 quote stream 的 tick。
- visible positions 批次取得的行情 snapshot close。

輸出應是一個可顯示與可計算的結構：

```ts
type DisplayPriceSource = 'live' | 'close' | 'broker' | 'reference' | 'missing';

interface DisplayPrice {
    value?: number;
    source: DisplayPriceSource;
    label: '即時' | '收盤' | '券商' | '參考' | '無資料';
    title: string;
}
```

優先序：

1. 有效即時 tick 成交價。
2. 行情 snapshot close / 最近收盤價。
3. 券商持倉回傳 `last_price`，且必須大於 0。
4. 合約參考價或可用的 previous close。
5. 無資料。

「有效即時 tick」指 app 目前 quote stream 中可用、價格大於 0 的 tick。非盤中開啟 app 時通常不會先收到即時 tick，因此會落到 snapshot close 並標示「收盤」。若 app 在盤中開啟後持續到收盤，最後一筆 tick 與 snapshot close 數值通常一致；實作必須避免用已知過期或價格為 0 的 tick 覆蓋收盤價。

表格顯示價格時，顯示 `fmtPrice(value)` 與來源小標記。若沒有可用價格，顯示 `--` 與「無資料」提示。

### 3. Sortable Tables

新增可排序表格狀態，建議用小型 hook 管理：

```ts
type SortDirection = 'asc' | 'desc';

interface SortState<Key extends string> {
    key: Key;
    direction: SortDirection;
}
```

排序狀態需依表格分開持久化，例如：

- `kauIkPro.positions.sort`
- `kauIkPro.orders.sort`

持倉預設排序：

- 若沒有使用者偏好，保留輸入陣列的穩定順序。
- 若實作時需要固定 fallback，可用商品代碼升冪作為穩定 tie-breaker，但不應讓使用者第一次打開時感覺資料突然被刻意重排。

委託預設排序：

- 時間新到舊。
- 以 `Trade.status.order_ts` 作為主要時間欄位；個別資料沒有 `order_ts` 時，以原始陣列順序作為 fallback。

排序必須穩定：

- 空值排在最後。
- 同值保留原始順序。
- 數字欄位用數字比較，文字欄位用字串比較。
- 現價排序使用 `DisplayPrice.value`，不是原始 `last_price`。

### 4. Bottom Dock Integration

持倉表：

- 商品欄改成 `SymbolCell` 顯示代碼與中文名。
- 現價欄改成價格與來源標記。
- 可排序欄位為商品、方向、數量、成本、現價、損益。
- 損益分布與平倉/反向按鈕維持原樣。

委託表：

- 商品欄改成 `SymbolCell` 顯示代碼與中文名。
- 可排序欄位為商品、買賣、價格、數量、狀態、時間。
- 訊息與操作欄維持不可排序。
- 若「成交量」未列入可排序欄位，本次先維持只顯示不排序。

帳務摘要：

- UI 維持卡片。
- 總市值與今日未實現損益使用同一套 `DisplayPrice` 的 value。
- 若某持倉價格無資料，該持倉不得以 `0` 直接拉低總市值；該筆應排除在市值與今日未實現計算之外，並讓 tooltip 說明有部位因缺少價格未納入。

## Error Handling And Edge Cases

- 中文名查詢失敗：顯示代碼，不顯示錯誤 toast。
- 行情資料缺失：顯示券商價或參考價來源標記；都沒有則顯示 `--`。
- 富邦股票 `last_price = 0`：不得顯示為有效現價；應繼續尋找 snapshot close 或參考價。
- 非盤中：即時 tick 不存在或過期時，使用最近收盤價並標示「收盤」。
- 排序偏好讀取失敗：回到預設排序，不阻塞表格。
- 商品資料晚到：表格可先顯示代碼，中文名補上時不應破壞使用者目前排序。

## Testing Plan

### Unit Tests

- `SymbolCell` 在只有代碼、代碼加中文名、代碼加標記時都能穩定顯示。
- 現價解析優先序：
  - 有即時 tick 時使用「即時」。
  - 沒有 tick 但有 snapshot close 時使用「收盤」。
  - snapshot 缺失但券商價大於 0 時使用「券商」。
  - 券商價為 0 時不可當有效價格。
  - 最後 fallback 到參考價或無資料。
- 排序：
  - 持倉可依商品、方向、數量、成本、現價、損益排序。
  - 委託可依商品、買賣、價格、數量、狀態、時間排序。
  - 空值排最後，同值保留原始順序。
  - 排序偏好可保存與讀回。

### Integration / UI Checks

- 自選清單顯示不退化，仍有代碼、中文名、注意/處置/試算標記。
- 持倉表能看到中文名、現價來源標記，且點欄位標題會切換排序方向。
- 委託表能看到中文名，預設新委託在上方，且排序狀態可記住。
- 帳務總市值不因券商持倉現價為 0 而被錯算成 0。

## Implementation Constraints

- 持倉現價解析必須為可見持倉批次取得 snapshot，不可每列各自發 API；優先使用既有 `fetchSnapshots`，並以 resolved contracts 作為輸入。
- snapshot cache 應跟隨可見持倉集合更新，避免持倉變動後仍顯示舊商品價格。
- 委託「時間」排序以 `Trade.status.order_ts` 為主；個別 row 缺值時 fallback 到原始順序，不阻塞排序。
- 若合約型別未知，沿用目前 `ensureContract(code)` 的 STK first、FUT fallback 策略。
