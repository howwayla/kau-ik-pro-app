// src/components/candle-chart.tsx — K-bar candlestick + volume chart
// (lightweight-charts v5), live-updated from the SSE tick stream.

import {
    CandlestickSeries,
    ColorType,
    createChart,
    HistogramSeries,
    LineSeries,
    type IChartApi,
    type IPriceLine,
    type ISeriesApi,
    type UTCTimestamp,
} from 'lightweight-charts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuote } from '../hooks/use-stream';
import { bollinger, ema, sma, vwap } from '../lib/indicators';
import { cancelOrder, fetchKbars, updateOrderPrice } from '../lib/backend';
import { setPickedPrice } from '../lib/price-sync';
import { notify, placeQuickOrder } from '../lib/trade';
import {
    addTrigger,
    rearmTrigger,
    removeConditionOrder,
    removeTrigger,
    updateTriggerPrice,
    useConditionOrders,
    useTriggers,
} from '../lib/triggers';
import { closeOrReverse } from '../lib/position-actions';
import type { Position } from '../lib/types/portfolio';
import { contractMultiplier } from '../lib/utils/multiplier';
import type { ContractBase } from '../lib/types/contract';
import type { Candle } from '../lib/types/market';
import { ACTIVE_ORDER_STATUSES, type Trade } from '../lib/types/order';
import { fmtPrice } from '../lib/utils/format';
import { roundToTick } from '../lib/utils/ticksize';
import { chartFontSize, getChartColors, useThemeSettings } from '../lib/theme-store';
import {
    aggregate,
    bucketTime,
    dateStrOffset,
    kbarsToCandles,
    wallClockToUtc,
} from '../lib/utils/kbars';
import * as panel from './panel.css';
import * as styles from './candle-chart.css';

const TIMEFRAMES = [
    { label: '1m', minutes: 1, days: 3 },
    { label: '5m', minutes: 5, days: 10 },
    { label: '15m', minutes: 15, days: 20 },
    { label: '60m', minutes: 60, days: 60 },
    { label: '1D', minutes: 1440, days: 1825 },
    { label: '1W', minutes: 10080, days: 3650 },
    { label: '1M', minutes: 43200, days: 6000 },
] as const;

type TradeMode = 'observe' | 'buy' | 'sell' | 'stop' | 'take' | 'alert';

const TRADE_MODES: { key: TradeMode; label: string }[] = [
    { key: 'observe', label: '游標' },
    { key: 'buy', label: '點價買' },
    { key: 'sell', label: '點價賣' },
    { key: 'stop', label: '停損' },
    { key: 'take', label: '停利' },
    { key: 'alert', label: '警示' },
];

const INDICATORS: { key: string; label: string; color: string }[] = [
    { key: 'ma5', label: 'MA5', color: '#e0a43c' },
    { key: 'ma10', label: 'MA10', color: '#3d8bff' },
    { key: 'ma20', label: 'MA20', color: '#b06fff' },
    { key: 'ma60', label: 'MA60', color: '#7e8798' },
    { key: 'ema12', label: 'EMA12', color: '#19b6c9' },
    { key: 'bb', label: 'BB(20,2)', color: '#8b94a7' },
    { key: 'vwap', label: 'VWAP', color: '#f5f7fa' },
];

interface ChartBracketSettings {
    enabled: boolean;
    stkStopPct: number; // % below entry (stocks)
    stkTakePct: number;
    futStopTicks: number; // points away from entry (futures)
    futTakeTicks: number;
}

const BRACKET_SETTINGS_KEY = 'sj-pro-chart-bracket';

function loadBracketSettings(): ChartBracketSettings {
    try {
        const raw = localStorage.getItem(BRACKET_SETTINGS_KEY);
        if (raw) {
            const v = JSON.parse(raw);
            return {
                enabled: Boolean(v.enabled),
                stkStopPct: Number(v.stkStopPct) || 1,
                stkTakePct: Number(v.stkTakePct) || 2,
                futStopTicks: Number(v.futStopTicks) || 20,
                futTakeTicks: Number(v.futTakeTicks) || 40,
            };
        }
    } catch {
        // defaults
    }
    return {
        enabled: false,
        stkStopPct: 1,
        stkTakePct: 2,
        futStopTicks: 20,
        futTakeTicks: 40,
    };
}

function loadIndicators(): Set<string> {
    try {
        const raw = localStorage.getItem('sj-pro-indicators');
        if (raw) return new Set(JSON.parse(raw));
    } catch {
        // defaults
    }
    return new Set();
}

type ChartStyle = 'candle' | 'line';

function loadChartStyle(): ChartStyle {
    try {
        if (localStorage.getItem('sj-pro-chart-style') === 'line')
            return 'line';
    } catch {
        // default
    }
    return 'candle';
}

export function CandleChart({
    contract,
    trades = [],
    positions = [],
    onOrdersChanged,
}: {
    contract: ContractBase;
    trades?: Trade[];
    positions?: Position[];
    onOrdersChanged?: () => void;
}) {
    const hostRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
    const volSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
    // 折線模式的收盤價 series（與 K 棒共用右側價格軸，二擇一顯示）
    const lineSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
    const lastBarRef = useRef<Candle | null>(null);
    // 換 symbol/timeframe 載入期間擋住 live tick 寫入：此時 series 還掛著
    // 舊 timeframe 的資料，用新 timeframe 的分桶時間 update 會因「時間
    // 倒退」讓 lightweight-charts 直接 throw → 整頁黑屏
    const loadingRef = useRef(true);
    // 日K以上的當根棒：歷史部分的量（today 的量用 tick.total_volume 疊加）
    const liveVolBaseRef = useRef<{ bucket: number; volume: number } | null>(
        null,
    );
    // 歷史最後一根日K（判斷今日是否已含在歷史內，避免量重複計）
    const lastDailyRef = useRef<{ time: number; volume: number } | null>(null);
    const [tfIdx, setTfIdx] = useState(1); // default 5m
    const [chartStyle, setChartStyle] = useState<ChartStyle>(loadChartStyle);
    const [empty, setEmpty] = useState(false);
    const quote = useQuote(contract.code);
    const tf = TIMEFRAMES[tfIdx] ?? TIMEFRAMES[1];
    const themeSettings = useThemeSettings();
    const colors = getChartColors(themeSettings);
    const themeKey = `${themeSettings.mode}-${themeSettings.convention}-${themeSettings.fontScale}`;
    const [mode, setMode] = useState<TradeMode>('observe');
    const [tradeQty, setTradeQty] = useState(1);
    const [indicators, setIndicators] = useState<Set<string>>(loadIndicators);
    const [indMenuOpen, setIndMenuOpen] = useState(false);
    const [dataVersion, setDataVersion] = useState(0);
    const barsRef = useRef<Candle[]>([]);
    const indSeriesRef = useRef<ISeriesApi<'Line'>[]>([]);
    const triggers = useTriggers().filter((t) => t.code === contract.code);
    const conditionOrders = useConditionOrders().filter(
        (c) =>
            c.code === contract.code ||
            (contract.target_code && c.code === contract.target_code),
    );
    const triggersRef = useRef(triggers);
    triggersRef.current = triggers;
    const triggerLinesRef = useRef(new Map<string, IPriceLine>());
    // prices the autoscaler should keep visible (trigger lines + position)
    const scaleLinePricesRef = useRef<number[]>([]);
    const [bracketCfg, setBracketCfg] = useState<ChartBracketSettings>(
        loadBracketSettings,
    );
    const [bracketMenuOpen, setBracketMenuOpen] = useState(false);
    const bracketCfgRef = useRef(bracketCfg);
    bracketCfgRef.current = bracketCfg;
    const saveBracketCfg = (patch: Partial<ChartBracketSettings>) => {
        setBracketCfg((prev) => {
            const next = { ...prev, ...patch };
            localStorage.setItem(BRACKET_SETTINGS_KEY, JSON.stringify(next));
            return next;
        });
    };
    // open position on this symbol (alias-aware)
    const position =
        positions.find(
            (p) =>
                p.code === contract.code ||
                (contract.target_code && p.code === contract.target_code),
        ) ?? null;
    const positionRef = useRef(position);
    positionRef.current = position;
    const workingOrders = useMemo(
        () =>
            trades.filter(
                (t) =>
                    (t.contract.code === contract.code ||
                        (contract.target_code &&
                            t.contract.code === contract.target_code)) &&
                    ACTIVE_ORDER_STATUSES.has(t.status.status),
            ),
        [trades, contract],
    );
    const workingOrdersRef = useRef(workingOrders);
    workingOrdersRef.current = workingOrders;
    const orderLinesRef = useRef(new Map<string, IPriceLine>());
    const onOrdersChangedRef = useRef(onOrdersChanged);
    onOrdersChangedRef.current = onOrdersChanged;

    // refs so the chart click handler always sees current values
    const modeRef = useRef(mode);
    modeRef.current = mode;
    const qtyRef = useRef(tradeQty);
    qtyRef.current = tradeQty;
    const contractRef = useRef(contract);
    contractRef.current = contract;
    const lastPriceRef = useRef<number | null>(null);
    const chartStyleRef = useRef(chartStyle);
    chartStyleRef.current = chartStyle;

    // 游標 legend：hover 顯示該根棒的開高低收量；未 hover 顯示最新一根
    const legendRef = useRef<HTMLDivElement>(null);
    const hoverTimeRef = useRef<number | null>(null);
    const barsByTimeRef = useRef(new Map<number, Candle>());
    const paintLegend = (bar: Candle | null) => {
        const el = legendRef.current;
        if (!el) return;
        if (!bar) {
            el.textContent = '';
            return;
        }
        const c = getChartColors(themeSettingsRef.current);
        const dir = bar.close >= bar.open ? c.up : c.down;
        const lab = (s: string) => `<span style="color:${c.text}">${s}</span>`;
        const val = (n: number) =>
            `<span style="color:${dir}">${fmtPrice(n)}</span>`;
        el.innerHTML =
            `${lab('開')}${val(bar.open)} ${lab('高')}${val(bar.high)} ` +
            `${lab('低')}${val(bar.low)} ${lab('收')}${val(bar.close)} ` +
            `${lab('量')}<span style="color:${dir}">${Math.round(
                bar.volume,
            ).toLocaleString('en-US')}</span>`;
    };
    const paintLegendRef = useRef(paintLegend);
    paintLegendRef.current = paintLegend;

    // chart lifecycle
    useEffect(() => {
        const host = hostRef.current;
        if (!host) return;
        const c = getChartColors(themeSettingsRef.current);
        const chart = createChart(host, {
            layout: {
                background: { type: ColorType.Solid, color: 'transparent' },
                textColor: c.text,
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: chartFontSize(10),
                attributionLogo: false,
            },
            grid: {
                vertLines: { color: c.grid },
                horzLines: { color: c.grid },
            },
            crosshair: {
                vertLine: {
                    color: c.crosshair,
                    labelBackgroundColor: c.labelBg,
                },
                horzLine: {
                    color: c.crosshair,
                    labelBackgroundColor: c.labelBg,
                },
            },
            rightPriceScale: { borderColor: c.border },
            timeScale: {
                borderColor: c.border,
                timeVisible: true,
                secondsVisible: false,
            },
            autoSize: true,
        });
        const candles = chart.addSeries(CandlestickSeries, {
            upColor: c.up,
            downColor: c.down,
            borderUpColor: c.up,
            borderDownColor: c.down,
            wickUpColor: c.up,
            wickDownColor: c.down,
            // stretch the auto-scale to keep stop/take/position lines on
            // screen — but only within 60% of the data range, so a far-away
            // line can't squash the candles into a sliver
            autoscaleInfoProvider: (original: () => {
                priceRange: { minValue: number; maxValue: number } | null;
                margins?: { above: number; below: number };
            } | null) => {
                const res = original();
                if (!res?.priceRange) return res;
                const { minValue, maxValue } = res.priceRange;
                const span = maxValue - minValue || maxValue * 0.01 || 1;
                let lo = minValue;
                let hi = maxValue;
                for (const price of scaleLinePricesRef.current) {
                    if (price > 0) {
                        lo = Math.min(lo, price);
                        hi = Math.max(hi, price);
                    }
                }
                // stretch cap: anything within daily-limit distance (~12%)
                // must stay visible; only truly unreachable lines (stale
                // GTC far away) get clipped so candles aren't squashed
                const loCap = Math.max(span * 2, minValue * 0.12);
                const hiCap = Math.max(span * 2, maxValue * 0.12);
                lo = Math.max(lo, minValue - loCap);
                hi = Math.min(hi, maxValue + hiCap);
                return { ...res, priceRange: { minValue: lo, maxValue: hi } };
            },
        });
        const vol = chart.addSeries(HistogramSeries, {
            priceFormat: { type: 'volume' },
            priceScaleId: 'vol',
        });
        chart.priceScale('vol').applyOptions({
            scaleMargins: { top: 0.82, bottom: 0 },
        });
        const closeLine = chart.addSeries(LineSeries, {
            color: c.crosshair,
            lineWidth: 2,
            visible: chartStyleRef.current === 'line',
        });
        candles.applyOptions({
            visible: chartStyleRef.current === 'candle',
        });
        chartRef.current = chart;
        candleSeriesRef.current = candles;
        volSeriesRef.current = vol;
        lineSeriesRef.current = closeLine;

        chart.subscribeClick((param) => {
            const m = modeRef.current;
            if (!param.point) return;
            const raw = candles.coordinateToPrice(param.point.y);
            if (raw === null) return;
            const c = contractRef.current;
            const price = roundToTick(c, Number(raw));
            if (m === 'observe') {
                setPickedPrice(c.code, price); // sync to order tickets
                return;
            }
            const qty = qtyRef.current;
            const last = lastPriceRef.current;
            setMode('observe'); // one-shot
            if (m === 'buy' || m === 'sell') {
                const action = m === 'buy' ? 'Buy' : 'Sell';
                // auto-bracket: offsets ride along and the server arms the
                // OCO pair off the ACTUAL fill price
                const cfg = bracketCfgRef.current;
                const isFut =
                    c.security_type === 'FUT' || c.security_type === 'OPT';
                const bracket = cfg.enabled
                    ? isFut
                        ? {
                              stop_offset: cfg.futStopTicks,
                              take_offset: cfg.futTakeTicks,
                              expiry: 'day' as const,
                          }
                        : {
                              stop_offset:
                                  Math.round(price * cfg.stkStopPct) / 100,
                              take_offset:
                                  Math.round(price * cfg.stkTakePct) / 100,
                              expiry: 'day' as const,
                          }
                    : undefined;
                placeQuickOrder(c, action, price, qty, { bracket })
                    .then((trade) =>
                        notify({
                            kind: 'ok',
                            title: `📈 圖表${action === 'Buy' ? '買進' : '賣出'}已送出`,
                            body: `${c.code} ${qty} @ ${fmtPrice(price)} (${trade.status.status})${bracket ? '＋自動括號' : ''}`,
                        }),
                    )
                    .catch((e) =>
                        notify({
                            kind: 'err',
                            title: '圖表下單失敗',
                            body: e instanceof Error ? e.message : String(e),
                        }),
                    );
                return;
            }
            // stop / take triggers — direction inferred from click vs last
            if (last === null) {
                notify({
                    kind: 'err',
                    title: '無法掛觸價單',
                    body: '尚未收到即時成交價',
                });
                return;
            }
            const below = price <= last;
            if (m === 'alert') {
                void addTrigger({
                    contract: c,
                    condition: below ? 'below' : 'above',
                    price,
                    action: 'Sell', // unused for alerts
                    quantity: 0,
                    kind: 'alert',
                });
                return;
            }
            if (m === 'stop') {
                void addTrigger({
                    contract: c,
                    condition: below ? 'below' : 'above',
                    price,
                    action: below ? 'Sell' : 'Buy',
                    quantity: qty,
                    kind: 'stop',
                });
            } else {
                void addTrigger({
                    contract: c,
                    condition: below ? 'below' : 'above',
                    price,
                    action: below ? 'Buy' : 'Sell',
                    quantity: qty,
                    kind: 'take',
                });
            }
        });

        chart.subscribeCrosshairMove((param) => {
            // 游標 OHLCV legend：滑出圖表或棒區外時回到最新一根
            if (param.point && param.time !== undefined) {
                const t = Number(param.time);
                hoverTimeRef.current = t;
                paintLegendRef.current(
                    barsByTimeRef.current.get(t) ?? lastBarRef.current,
                );
            } else {
                hoverTimeRef.current = null;
                paintLegendRef.current(lastBarRef.current);
            }
            if (!param.point) return;
            const raw = candles.coordinateToPrice(param.point.y);
            if (raw === null) return;
            const c = contractRef.current;
            setPickedPrice(c.code, roundToTick(c, Number(raw)));
        });

        return () => {
            chart.remove();
            chartRef.current = null;
            candleSeriesRef.current = null;
            volSeriesRef.current = null;
            lineSeriesRef.current = null;
        };
    }, []);

    // keep latest theme readable inside the chart-creation effect
    const themeSettingsRef = useRef(themeSettings);
    themeSettingsRef.current = themeSettings;

    // restyle chart on theme change
    useEffect(() => {
        const chart = chartRef.current;
        if (!chart) return;
        chart.applyOptions({
            layout: { textColor: colors.text, fontSize: chartFontSize(10) },
            grid: {
                vertLines: { color: colors.grid },
                horzLines: { color: colors.grid },
            },
            crosshair: {
                vertLine: {
                    color: colors.crosshair,
                    labelBackgroundColor: colors.labelBg,
                },
                horzLine: {
                    color: colors.crosshair,
                    labelBackgroundColor: colors.labelBg,
                },
            },
            rightPriceScale: { borderColor: colors.border },
            timeScale: { borderColor: colors.border },
        });
        candleSeriesRef.current?.applyOptions({
            upColor: colors.up,
            downColor: colors.down,
            borderUpColor: colors.up,
            borderDownColor: colors.down,
            wickUpColor: colors.up,
            wickDownColor: colors.down,
        });
        lineSeriesRef.current?.applyOptions({ color: colors.crosshair });
        paintLegend(
            (hoverTimeRef.current !== null
                ? barsByTimeRef.current.get(hoverTimeRef.current)
                : null) ?? lastBarRef.current,
        );
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [themeKey]);

    // K棒 ↔ 折線切換（委託/觸價線掛在活動 series 上，由各自 effect 重掛）
    useEffect(() => {
        candleSeriesRef.current?.applyOptions({
            visible: chartStyle === 'candle',
        });
        lineSeriesRef.current?.applyOptions({
            visible: chartStyle === 'line',
        });
        localStorage.setItem('sj-pro-chart-style', chartStyle);
    }, [chartStyle]);

    // load kbars on symbol/timeframe change (and recolor volume on theme change)
    useEffect(() => {
        let cancelled = false;
        loadingRef.current = true;
        lastBarRef.current = null;
        liveVolBaseRef.current = null;
        setEmpty(false);
        fetchKbars(contract, dateStrOffset(tf.days), dateStrOffset(0))
            .then((k) => {
                if (cancelled || !candleSeriesRef.current) return;
                const daily = kbarsToCandles(k);
                const lastRaw = daily[daily.length - 1];
                lastDailyRef.current = lastRaw
                    ? { time: lastRaw.time, volume: lastRaw.volume }
                    : null;
                const bars = aggregate(daily, tf.minutes);
                if (bars.length === 0) {
                    setEmpty(true);
                    // 清掉舊 timeframe 的 series 資料再放行 live tick，
                    // 否則 tick 自建新棒會撞舊資料的時間軸
                    candleSeriesRef.current.setData([]);
                    volSeriesRef.current?.setData([]);
                    lineSeriesRef.current?.setData([]);
                    barsRef.current = [];
                    barsByTimeRef.current = new Map();
                    paintLegend(null);
                    loadingRef.current = false;
                    return;
                }
                candleSeriesRef.current.setData(
                    bars.map((b) => ({
                        time: b.time as UTCTimestamp,
                        open: b.open,
                        high: b.high,
                        low: b.low,
                        close: b.close,
                    })),
                );
                volSeriesRef.current?.setData(
                    bars.map((b) => ({
                        time: b.time as UTCTimestamp,
                        value: b.volume,
                        color:
                            b.close >= b.open ? colors.upVol : colors.downVol,
                    })),
                );
                lineSeriesRef.current?.setData(
                    bars.map((b) => ({
                        time: b.time as UTCTimestamp,
                        value: b.close,
                    })),
                );
                lastBarRef.current = bars[bars.length - 1] ?? null;
                barsRef.current = bars;
                barsByTimeRef.current = new Map(bars.map((b) => [b.time, b]));
                hoverTimeRef.current = null;
                paintLegend(lastBarRef.current);
                loadingRef.current = false;
                setDataVersion((v) => v + 1);
                chartRef.current?.timeScale().scrollToRealTime();
            })
            .catch(() => {
                if (cancelled) return;
                setEmpty(true);
                candleSeriesRef.current?.setData([]);
                volSeriesRef.current?.setData([]);
                lineSeriesRef.current?.setData([]);
                barsRef.current = [];
                barsByTimeRef.current = new Map();
                paintLegend(null);
                loadingRef.current = false;
            });
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [contract, tf, themeKey]);

    // live tick -> update current bar
    const tick = quote?.tick;
    if (tick && tick.code === contract.code) {
        const p = Number(tick.close);
        if (Number.isFinite(p)) lastPriceRef.current = p;
    }
    useEffect(() => {
        if (!tick || tick.code !== contract.code) return;
        if (tick.simtrade) return; // 試撮 never paints into candles
        if (loadingRef.current) return; // 載入中：series 還是舊資料，不可寫
        const series = candleSeriesRef.current;
        if (!series) return;
        const price = Number(tick.close);
        if (!Number.isFinite(price)) return;
        const tickTime = wallClockToUtc(`${tick.date}T${tick.time}`);
        const bucket = bucketTime(tickTime, tf.minutes);
        let bar = lastBarRef.current;
        const dailyPlus = tf.minutes >= 1440; // 日/週/月
        // 日K以上用 tick 自帶的「日內」開高低與總量合成今日部分，
        // 量 = 歷史部分 + 今日總量（不靠逐筆累加，避免漏掉訂閱前的量）
        const dayOpen = Number(tick.open) || price;
        const dayHigh = Number(tick.high) || price;
        const dayLow = Number(tick.low) || price;
        if (!bar || bucket > bar.time) {
            bar = dailyPlus
                ? {
                      time: bucket,
                      open: dayOpen,
                      high: dayHigh,
                      low: dayLow,
                      close: price,
                      volume: tick.total_volume,
                  }
                : {
                      time: bucket,
                      open: price,
                      high: price,
                      low: price,
                      close: price,
                      volume: tick.volume,
                  };
            liveVolBaseRef.current = { bucket, volume: 0 };
        } else if (dailyPlus) {
            if (
                !liveVolBaseRef.current ||
                liveVolBaseRef.current.bucket !== bucket
            ) {
                // 第一筆今日 tick：base = 歷史量；若歷史已含今日
                //（收盤後重開圖），先扣掉那根的量避免重複計
                const last = lastDailyRef.current;
                const todayBucket = bucketTime(tickTime, 1440);
                const histIncludesToday =
                    last && bucketTime(last.time, 1440) === todayBucket;
                liveVolBaseRef.current = {
                    bucket,
                    volume:
                        bar.volume - (histIncludesToday ? last.volume : 0),
                };
            }
            bar.high = Math.max(bar.high, dayHigh);
            bar.low = Math.min(bar.low, dayLow);
            bar.close = price;
            bar.volume = liveVolBaseRef.current.volume + tick.total_volume;
        } else {
            bar.high = Math.max(bar.high, price);
            bar.low = Math.min(bar.low, price);
            bar.close = price;
            bar.volume += tick.volume;
        }
        lastBarRef.current = bar;
        series.update({
            time: bar.time as UTCTimestamp,
            open: bar.open,
            high: bar.high,
            low: bar.low,
            close: bar.close,
        });
        volSeriesRef.current?.update({
            time: bar.time as UTCTimestamp,
            value: bar.volume,
            color: bar.close >= bar.open ? colors.upVol : colors.downVol,
        });
        lineSeriesRef.current?.update({
            time: bar.time as UTCTimestamp,
            value: bar.close,
        });
        barsByTimeRef.current.set(bar.time, bar);
        if (
            hoverTimeRef.current === null ||
            hoverTimeRef.current === bar.time
        ) {
            paintLegend(bar);
        }
    }, [tick, contract.code, tf.minutes]);

    // overlay indicators
    useEffect(() => {
        const chart = chartRef.current;
        if (!chart) return;
        for (const series of indSeriesRef.current) {
            try {
                chart.removeSeries(series);
            } catch {
                // already gone with chart teardown
            }
        }
        indSeriesRef.current = [];
        const bars = barsRef.current;
        if (bars.length === 0) return;
        const addLine = (
            data: { time: number; value: number }[],
            color: string,
            width: 1 | 2 = 1,
        ) => {
            const series = chart.addSeries(LineSeries, {
                color,
                lineWidth: width,
                priceLineVisible: false,
                lastValueVisible: false,
                crosshairMarkerVisible: false,
            });
            series.setData(
                data.map((d) => ({
                    time: d.time as UTCTimestamp,
                    value: d.value,
                })),
            );
            indSeriesRef.current.push(series);
        };
        for (const ind of INDICATORS) {
            if (!indicators.has(ind.key)) continue;
            if (ind.key.startsWith('ma')) {
                addLine(sma(bars, Number(ind.key.slice(2))), ind.color);
            } else if (ind.key === 'ema12') {
                addLine(ema(bars, 12), ind.color);
            } else if (ind.key === 'vwap') {
                addLine(vwap(bars), ind.color, 2);
            } else if (ind.key === 'bb') {
                const b = bollinger(bars);
                addLine(b.mid, ind.color);
                addLine(b.upper, ind.color);
                addLine(b.lower, ind.color);
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dataVersion, indicators]);

    const toggleIndicator = (key: string) => {
        setIndicators((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            localStorage.setItem(
                'sj-pro-indicators',
                JSON.stringify([...next]),
            );
            return next;
        });
    };

    // draw working-order price lines (buy=up color / sell=down color)
    const orderKey = JSON.stringify(
        workingOrders.map((t) => [
            t.order.id,
            t.status.modified_price || t.order.price,
            t.order.quantity - t.status.deal_quantity,
        ]),
    );
    useEffect(() => {
        // price line 隨可見 series 走：隱藏 series 的 price line 不會渲染
        const series =
            chartStyle === 'line'
                ? lineSeriesRef.current
                : candleSeriesRef.current;
        if (!series) return;
        const lines = new Map<string, IPriceLine>();
        for (const t of workingOrdersRef.current) {
            const price = t.status.modified_price || t.order.price;
            const remaining = t.order.quantity - t.status.deal_quantity;
            lines.set(
                t.order.id,
                series.createPriceLine({
                    price,
                    color: t.order.action === 'Buy' ? colors.up : colors.down,
                    lineWidth: 2,
                    lineStyle: 0, // solid
                    axisLabelVisible: true,
                    title: `${t.order.action === 'Buy' ? '買' : '賣'}${remaining} ⠿`,
                }),
            );
        }
        orderLinesRef.current = lines;
        return () => {
            for (const line of lines.values()) series.removePriceLine(line);
            orderLinesRef.current = new Map();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [orderKey, themeKey, contract.code, chartStyle]);

    // drag a line (working order OR stop/take/alert trigger) to reprice it
    useEffect(() => {
        const host = hostRef.current;
        if (!host) return;
        type Hit =
            | { kind: 'order'; trade: Trade; line: IPriceLine }
            | { kind: 'trigger'; id: string; code: string; line: IPriceLine };
        let dragging: (Hit & { price: number; orig: number }) | null = null;

        const yOf = (e: MouseEvent) =>
            e.clientY - host.getBoundingClientRect().top;

        const findNear = (y: number): Hit | null => {
            const series = candleSeriesRef.current;
            if (!series) return null;
            for (const t of workingOrdersRef.current) {
                const line = orderLinesRef.current.get(t.order.id);
                if (!line) continue;
                const coord = series.priceToCoordinate(line.options().price);
                if (coord !== null && Math.abs(coord - y) <= 6) {
                    return { kind: 'order', trade: t, line };
                }
            }
            for (const t of triggersRef.current) {
                const line = triggerLinesRef.current.get(t.id);
                if (!line) continue;
                const coord = series.priceToCoordinate(line.options().price);
                if (coord !== null && Math.abs(coord - y) <= 6) {
                    return { kind: 'trigger', id: t.id, code: t.code, line };
                }
            }
            return null;
        };

        const hover = (e: MouseEvent) => {
            if (dragging) return;
            host.style.cursor = findNear(yOf(e)) ? 'ns-resize' : '';
        };

        const down = (e: MouseEvent) => {
            if (e.button !== 0) return;
            const hit = findNear(yOf(e));
            if (!hit) return;
            e.preventDefault();
            e.stopPropagation();
            chartRef.current?.applyOptions({
                handleScroll: false,
                handleScale: false,
            });
            dragging = {
                ...hit,
                price: hit.line.options().price,
                orig: hit.line.options().price,
            };

            const move = (ev: MouseEvent) => {
                const series = candleSeriesRef.current;
                if (!series || !dragging) return;
                const raw = series.coordinateToPrice(yOf(ev));
                if (raw === null) return;
                const np = roundToTick(contractRef.current, Number(raw));
                dragging.price = np;
                dragging.line.applyOptions({ price: np });
            };
            const up = () => {
                document.removeEventListener('mousemove', move, true);
                document.removeEventListener('mouseup', up, true);
                chartRef.current?.applyOptions({
                    handleScroll: true,
                    handleScale: true,
                });
                const d = dragging;
                dragging = null;
                if (!d || d.price === d.orig) return;
                if (d.kind === 'trigger') {
                    // optimistic server PATCH — store reverts on failure
                    void updateTriggerPrice(d.id, d.price).then(() =>
                        notify({
                            kind: 'ok',
                            title: '✏️ 觸價已調整',
                            body: `${d.code} ${fmtPrice(d.orig)} → ${fmtPrice(d.price)}`,
                        }),
                    );
                    return;
                }
                const orig =
                    d.trade.status.modified_price || d.trade.order.price;
                updateOrderPrice(d.trade.order.id, d.price)
                    .then(() => {
                        notify({
                            kind: 'ok',
                            title: '✏️ 改價已送出',
                            body: `${d.trade.contract.code} ${fmtPrice(orig)} → ${fmtPrice(d.price)}`,
                        });
                        onOrdersChangedRef.current?.();
                    })
                    .catch((err) => {
                        notify({
                            kind: 'err',
                            title: '改價失敗',
                            body:
                                err instanceof Error
                                    ? err.message
                                    : String(err),
                        });
                        onOrdersChangedRef.current?.();
                    });
            };
            document.addEventListener('mousemove', move, true);
            document.addEventListener('mouseup', up, true);
        };

        host.addEventListener('mousedown', down, true); // capture: beat chart pan
        host.addEventListener('mousemove', hover, true);
        return () => {
            host.removeEventListener('mousedown', down, true);
            host.removeEventListener('mousemove', hover, true);
        };
    }, []);

    // draw trigger price lines on the visible price series (draggable via
    // the unified drag handler above; suspended ones render grey)
    useEffect(() => {
        const series =
            chartStyle === 'line'
                ? lineSeriesRef.current
                : candleSeriesRef.current;
        if (!series) return;
        const lines = new Map<string, IPriceLine>();
        for (const t of triggers) {
            const suspended = t.state === 'suspended';
            lines.set(
                t.id,
                series.createPriceLine({
                    price: t.price,
                    color: suspended
                        ? '#5a6372'
                        : t.kind === 'stop'
                          ? '#e0a43c'
                          : t.kind === 'alert'
                            ? '#8b94a7'
                            : colors.crosshair,
                    lineWidth: 1,
                    lineStyle: 2, // dashed
                    axisLabelVisible: true,
                    title: `${suspended ? '⏸' : ''}${
                        t.kind === 'alert'
                            ? '警示'
                            : `${t.kind === 'stop' ? '停損' : '停利'}${t.action === 'Buy' ? '買' : '賣'}${t.quantity}`
                    } ⠿`,
                }),
            );
        }
        triggerLinesRef.current = lines;
        scaleLinePricesRef.current = [
            ...triggers.map((t) => t.price),
            ...(positionRef.current ? [positionRef.current.price] : []),
        ];
        chartRef.current
            ?.priceScale('right')
            .applyOptions({ autoScale: true }); // re-run the autoscaler
        return () => {
            for (const line of lines.values()) series.removePriceLine(line);
            triggerLinesRef.current = new Map();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [JSON.stringify(triggers), themeKey, contract.code, chartStyle]);

    // position average-price line（持倉均價）
    useEffect(() => {
        const series = candleSeriesRef.current;
        if (!series || !position) return;
        const line = series.createPriceLine({
            price: position.price,
            color: position.direction === 'Buy' ? colors.up : colors.down,
            lineWidth: 2,
            lineStyle: 3, // large dashed
            axisLabelVisible: true,
            title: `持倉${position.direction === 'Buy' ? '多' : '空'}${position.quantity}`,
        });
        return () => {
            series.removePriceLine(line);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        position?.price,
        position?.quantity,
        position?.direction,
        themeKey,
        contract.code,
    ]);

    // one-click breakeven: move (or create) the stop to the entry price
    const breakeven = async () => {
        const pos = positionRef.current;
        if (!pos) return;
        const c = contractRef.current;
        const be = roundToTick(c, pos.price);
        const stops = triggersRef.current.filter(
            (t) => t.kind === 'stop' && t.state === 'active',
        );
        if (stops.length > 0) {
            for (const t of stops) await updateTriggerPrice(t.id, be);
            notify({
                kind: 'ok',
                title: '🛡 保本完成',
                body: `${c.code} 停損已移至進場均價 ${fmtPrice(be)}`,
            });
            return;
        }
        const lots = Math.max(1, Math.floor(pos.quantity + 1e-9));
        await addTrigger({
            contract: c,
            condition: pos.direction === 'Buy' ? 'below' : 'above',
            price: be,
            action: pos.direction === 'Buy' ? 'Sell' : 'Buy',
            quantity: lots,
            kind: 'stop',
        });
    };

    return (
        <div className={styles.wrap}>
            <div className={styles.toolbar}>
                {TIMEFRAMES.map((t, i) => (
                    <button
                        key={t.label}
                        className={styles.tfBtn[i === tfIdx ? 'active' : 'normal']}
                        onClick={() => setTfIdx(i)}
                    >
                        {t.label}
                    </button>
                ))}
                <span className={styles.toolbarDivider} />
                <button
                    className={
                        styles.tfBtn[
                            chartStyle === 'candle' ? 'active' : 'normal'
                        ]
                    }
                    title='K 棒圖'
                    onClick={() => setChartStyle('candle')}
                >
                    K
                </button>
                <button
                    className={
                        styles.tfBtn[
                            chartStyle === 'line' ? 'active' : 'normal'
                        ]
                    }
                    title='收盤價折線圖（簡化呈現）'
                    onClick={() => setChartStyle('line')}
                >
                    線
                </button>
                <span className={styles.toolbarDivider} />
                {TRADE_MODES.map((m) => (
                    <button
                        key={m.key}
                        className={
                            styles.modeBtn[
                                mode === m.key
                                    ? m.key === 'observe'
                                        ? 'active'
                                        : 'armed'
                                    : 'normal'
                            ]
                        }
                        onClick={() => setMode(m.key)}
                    >
                        {m.label}
                    </button>
                ))}
                <input
                    className={styles.qtyInput}
                    value={tradeQty}
                    inputMode='numeric'
                    title='下單數量'
                    onChange={(e) => {
                        const v = Number(e.target.value);
                        if (Number.isInteger(v) && v >= 1) setTradeQty(v);
                    }}
                />
                <div style={{ position: 'relative' }}>
                    <button
                        className={
                            styles.modeBtn[bracketCfg.enabled ? 'armed' : 'normal']
                        }
                        title='點價進場時自動帶停損/停利括號（以實際成交價為基準）— 右鍵或再點開啟設定'
                        onClick={() => {
                            if (bracketCfg.enabled) setBracketMenuOpen((o) => !o);
                            else saveBracketCfg({ enabled: true });
                        }}
                        onContextMenu={(e) => {
                            e.preventDefault();
                            setBracketMenuOpen((o) => !o);
                        }}
                    >
                        括{bracketCfg.enabled ? '✓' : ''}
                    </button>
                    {bracketMenuOpen && (
                        <>
                            <div
                                className={styles.indBackdrop}
                                onClick={() => setBracketMenuOpen(false)}
                            />
                            <div className={styles.indMenu}>
                                <button
                                    className={styles.indItem}
                                    onClick={() =>
                                        saveBracketCfg({
                                            enabled: !bracketCfg.enabled,
                                        })
                                    }
                                >
                                    {bracketCfg.enabled
                                        ? '✓ 自動括號啟用中'
                                        : '啟用自動括號'}
                                </button>
                                <div className={styles.indItem}>
                                    股票 損
                                    <input
                                        className={styles.qtyInput}
                                        value={bracketCfg.stkStopPct}
                                        inputMode='decimal'
                                        onChange={(e) => {
                                            const v = Number(e.target.value);
                                            if (v > 0)
                                                saveBracketCfg({
                                                    stkStopPct: v,
                                                });
                                        }}
                                    />
                                    % 利
                                    <input
                                        className={styles.qtyInput}
                                        value={bracketCfg.stkTakePct}
                                        inputMode='decimal'
                                        onChange={(e) => {
                                            const v = Number(e.target.value);
                                            if (v > 0)
                                                saveBracketCfg({
                                                    stkTakePct: v,
                                                });
                                        }}
                                    />
                                    %
                                </div>
                                <div className={styles.indItem}>
                                    期貨 損
                                    <input
                                        className={styles.qtyInput}
                                        value={bracketCfg.futStopTicks}
                                        inputMode='numeric'
                                        onChange={(e) => {
                                            const v = Number(e.target.value);
                                            if (v > 0)
                                                saveBracketCfg({
                                                    futStopTicks: v,
                                                });
                                        }}
                                    />
                                    點 利
                                    <input
                                        className={styles.qtyInput}
                                        value={bracketCfg.futTakeTicks}
                                        inputMode='numeric'
                                        onChange={(e) => {
                                            const v = Number(e.target.value);
                                            if (v > 0)
                                                saveBracketCfg({
                                                    futTakeTicks: v,
                                                });
                                        }}
                                    />
                                    點
                                </div>
                            </div>
                        </>
                    )}
                </div>
                <div style={{ position: 'relative' }}>
                    <button
                        className={
                            styles.modeBtn[
                                indicators.size > 0 ? 'active' : 'normal'
                            ]
                        }
                        onClick={() => setIndMenuOpen((o) => !o)}
                    >
                        指標{indicators.size > 0 ? ` ${indicators.size}` : ''}
                    </button>
                    {indMenuOpen && (
                        <>
                            <div
                                className={styles.indBackdrop}
                                onClick={() => setIndMenuOpen(false)}
                            />
                            <div className={styles.indMenu}>
                                {INDICATORS.map((ind) => (
                                    <button
                                        key={ind.key}
                                        className={styles.indItem}
                                        onClick={() =>
                                            toggleIndicator(ind.key)
                                        }
                                    >
                                        <span
                                            className={styles.indSwatch}
                                            style={{ background: ind.color }}
                                        />
                                        {ind.label}
                                        {indicators.has(ind.key) && ' ✓'}
                                    </button>
                                ))}
                            </div>
                        </>
                    )}
                </div>
            </div>
            <div ref={hostRef} className={styles.chartHost}>
                <div ref={legendRef} className={styles.legend} />
                {empty && (
                    <div className={styles.emptyMsg}>
                        <span className={panel.mono}>無 K 線資料</span>
                    </div>
                )}
                {mode !== 'observe' && (
                    <div className={styles.modeHint}>
                        {mode === 'buy' && '點擊圖表價位 → 限價買進'}
                        {mode === 'sell' && '點擊圖表價位 → 限價賣出'}
                        {mode === 'stop' && '點擊價位掛停損（觸價市價單）'}
                        {mode === 'take' && '點擊價位掛停利（觸價市價單）'}
                        {mode === 'alert' && '點擊價位設定到價警示（只通知不下單）'}
                    </div>
                )}
                {(workingOrders.length > 0 ||
                    triggers.length > 0 ||
                    conditionOrders.length > 0 ||
                    position) && (
                    <div className={styles.triggerList}>
                        {position && (
                            <div className={styles.triggerRow}>
                                <span
                                    className={
                                        panel.dirText[
                                            position.direction === 'Buy'
                                                ? 'up'
                                                : 'down'
                                        ]
                                    }
                                >
                                    持倉{position.direction === 'Buy' ? '多' : '空'}
                                    {position.quantity} @{fmtPrice(position.price)}{' '}
                                    {(() => {
                                        const last = Number(
                                            quote?.tick?.close ??
                                                position.last_price,
                                        );
                                        const dir =
                                            position.direction === 'Buy' ? 1 : -1;
                                        const pnl =
                                            (last - position.price) *
                                            position.quantity *
                                            contractMultiplier(contract) *
                                            dir;
                                        return `${pnl >= 0 ? '+' : ''}${Math.round(pnl).toLocaleString()}`;
                                    })()}
                                </span>
                                <span>
                                    <button
                                        className={styles.orderCancel}
                                        title='保本：停損移至進場均價'
                                        onClick={() => void breakeven()}
                                    >
                                        BE
                                    </button>{' '}
                                    <button
                                        className={styles.orderCancel}
                                        title='市價平倉'
                                        onClick={() =>
                                            void closeOrReverse(
                                                position,
                                                'close',
                                            ).then(() =>
                                                onOrdersChangedRef.current?.(),
                                            ).catch(() => undefined)
                                        }
                                    >
                                        平倉
                                    </button>
                                </span>
                            </div>
                        )}
                        {workingOrders.map((t) => {
                            const price =
                                t.status.modified_price || t.order.price;
                            const remaining =
                                t.order.quantity - t.status.deal_quantity;
                            return (
                                <div
                                    key={t.order.id}
                                    className={styles.triggerRow}
                                >
                                    <span
                                        className={
                                            panel.dirText[
                                                t.order.action === 'Buy'
                                                    ? 'up'
                                                    : 'down'
                                            ]
                                        }
                                    >
                                        委{t.order.action === 'Buy' ? '買' : '賣'}
                                        {remaining} @{fmtPrice(price)}
                                    </span>
                                    <button
                                        className={styles.orderCancel}
                                        title='刪單'
                                        onClick={() =>
                                            cancelOrder(t.order.id)
                                                .then(() => {
                                                    notify({
                                                        kind: 'ok',
                                                        title: '🗑 刪單已送出',
                                                        body: `${t.contract.code} @${fmtPrice(price)}`,
                                                    });
                                                    onOrdersChangedRef.current?.();
                                                })
                                                .catch((e) =>
                                                    notify({
                                                        kind: 'err',
                                                        title: '刪單失敗',
                                                        body:
                                                            e instanceof Error
                                                                ? e.message
                                                                : String(e),
                                                    }),
                                                )
                                        }
                                    >
                                        CANCEL
                                    </button>
                                </div>
                            );
                        })}
                        {triggers.map((t) => (
                            <div key={t.id} className={styles.triggerRow}>
                                <span
                                    style={
                                        t.state === 'suspended'
                                            ? { opacity: 0.55 }
                                            : undefined
                                    }
                                >
                                    {t.state === 'suspended' && '⏸ '}
                                    {t.kind === 'stop'
                                        ? '⛔'
                                        : t.kind === 'take'
                                          ? '🎯'
                                          : '🔔'}{' '}
                                    {t.condition === 'below' ? '≤' : '≥'}
                                    {fmtPrice(t.price)}
                                    {t.kind !== 'alert' &&
                                        ` ${t.action === 'Buy' ? '買' : '賣'}${t.quantity}`}
                                </span>
                                <span>
                                    {t.state === 'suspended' && (
                                        <button
                                            className={styles.orderCancel}
                                            title='重新啟用（若價格已穿越會立即觸發）'
                                            onClick={() =>
                                                void rearmTrigger(t.id)
                                            }
                                        >
                                            ▶
                                        </button>
                                    )}{' '}
                                    <button
                                        className={styles.triggerRemove}
                                        onClick={() => void removeTrigger(t.id)}
                                    >
                                        ✕
                                    </button>
                                </span>
                            </div>
                        ))}
                        {conditionOrders.map((c) => (
                            <div key={c.guid} className={styles.triggerRow}>
                                <span title={`券商端條件單 ${c.guid}（${c.raw_status}）`}>
                                    🏦 {c.action === 'Buy' ? '買' : '賣'}
                                    {c.quantity}
                                    {c.price ? ` @${fmtPrice(c.price)}` : ' 市價'}
                                    {c.tpsl.stop !== undefined &&
                                        ` 損${fmtPrice(c.tpsl.stop)}`}
                                    {c.tpsl.take !== undefined &&
                                        ` 利${fmtPrice(c.tpsl.take)}`}
                                    {c.status && ` · ${c.status}`}
                                </span>
                                <button
                                    className={styles.triggerRemove}
                                    title='撤銷券商端條件單'
                                    onClick={() =>
                                        void removeConditionOrder(
                                            c.guid,
                                            c.account_type,
                                        )
                                    }
                                >
                                    ✕
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
