// server/src/providers/mock/market.ts — MarketDataProvider backed by the
// deterministic mock engine.

import type {
    ContractInfo,
    CreditEnquire,
    HistoryTicks,
    KBars,
    OptContract,
    ScannerItem,
    ScannerType,
    SecurityType,
    ShortSource,
    Snapshot,
    SseBidAsk,
    SseTick,
} from '../../types/dto.ts';
import type {
    BidAskChannel,
    ContractKey,
    MarketDataProvider,
    StreamQuoteType,
    TickChannel,
} from '../market-data.ts';
import { hashStr, mulberry32 } from './prng.ts';
import { MockMarketEngine, dateStr } from './random-walk.ts';
import { roundToTick, type SeedInstrument } from './seed.ts';

export class MockMarketDataProvider implements MarketDataProvider {
    readonly engine = new MockMarketEngine();

    async init(): Promise<void> {}

    contractCount(): number {
        return this.engine.instrumentCount();
    }

    private toContractInfo(inst: SeedInstrument): ContractInfo {
        const rand = mulberry32(hashStr(`info:${inst.code}`));
        const reference = this.engine.prevCloseFor(inst.code);
        return {
            exchange: inst.exchange,
            code: inst.code,
            security_type: inst.security_type,
            target_code: inst.target_code,
            name: inst.name,
            currency: 'TWD',
            limit_up: roundToTick(inst, reference * 1.1),
            limit_down: roundToTick(inst, reference * 0.9),
            reference,
            day_trade: inst.security_type === 'STK' ? 'Yes' : '',
            update_date: dateStr(new Date()).replace(/-/g, '/'),
            category: inst.category,
            margin_trading_balance: Math.round(rand() * 5000),
            short_selling_balance: Math.round(rand() * 2000),
        };
    }

    async resolveContract(
        code: string,
        type: SecurityType,
    ): Promise<ContractInfo | null> {
        const inst = this.engine.getInstrument(code);
        if (!inst) return null;
        if (type && inst.security_type !== type) return null;
        return this.toContractInfo(inst);
    }

    async listOptionContracts(): Promise<OptContract[]> {
        return this.engine.listOptionContracts();
    }

    async snapshots(keys: ContractKey[]): Promise<Snapshot[]> {
        const out: Snapshot[] = [];
        for (const key of keys) {
            const snap = this.engine.snapshot(key.code);
            if (snap) out.push(snap);
        }
        return out;
    }

    async kbars(key: ContractKey, start: string, end: string): Promise<KBars> {
        return this.engine.kbars(key.code, start, end);
    }

    async ticks(
        key: ContractKey,
        date: string,
        lastCount?: number,
    ): Promise<HistoryTicks> {
        return this.engine.ticks(key.code, date, lastCount);
    }

    async scanner(
        type: ScannerType,
        count: number,
        ascending: boolean,
    ): Promise<ScannerItem[]> {
        const snaps = this.engine
            .listStockCodes()
            .map((code) => ({
                code,
                inst: this.engine.getInstrument(code)!,
                snap: this.engine.snapshot(code)!,
            }));
        const rankOf = (s: Snapshot): number => {
            switch (type) {
                case 'ChangePercentRank':
                    return s.change_rate;
                case 'ChangePriceRank':
                    return s.change_price;
                case 'DayRangeRank':
                    return s.open > 0 ? ((s.high - s.low) / s.open) * 100 : 0;
                case 'VolumeRank':
                    return s.total_volume;
                case 'AmountRank':
                    return s.total_amount;
                case 'TickCountRank':
                    return s.total_volume;
            }
        };
        snaps.sort((a, b) =>
            ascending
                ? rankOf(a.snap) - rankOf(b.snap)
                : rankOf(b.snap) - rankOf(a.snap),
        );
        return snaps.slice(0, count).map(({ inst, snap }) => ({
            code: snap.code,
            name: inst.name,
            date: dateStr(new Date()),
            close: snap.close,
            open: snap.open,
            high: snap.high,
            low: snap.low,
            change_price: snap.change_price,
            change_type: snap.change_price > 0 ? 2 : snap.change_price < 0 ? 4 : 3,
            average_price: snap.average_price,
            price_range: snap.high - snap.low,
            rank_value: rankOf(snap),
            total_volume: snap.total_volume,
            total_amount: snap.total_amount,
            volume_ratio: snap.volume_ratio,
            yesterday_volume: snap.yesterday_volume,
            tick_type: snap.tick_type === 'Buy' ? 1 : 2,
            buy_price: snap.buy_price,
            sell_price: snap.sell_price,
        }));
    }

    async creditEnquire(keys: ContractKey[]): Promise<CreditEnquire[]> {
        return keys.map((key) => {
            const rand = mulberry32(hashStr(`credit:${key.code}:${dateStr(new Date())}`));
            return {
                stock_id: key.code,
                system: 'mock',
                update_time: `${dateStr(new Date())} 09:00:00`,
                margin_unit: Math.round(rand() * 20000),
                short_unit: Math.round(rand() * 8000),
                margin_loan_ratio: 60,
                short_margin_ratio: 90,
            };
        });
    }

    async shortStockSources(keys: ContractKey[]): Promise<ShortSource[]> {
        return keys.map((key) => {
            const rand = mulberry32(hashStr(`short:${key.code}:${dateStr(new Date())}`));
            return {
                code: key.code,
                short_stock_source: Math.round(rand() * 3000),
                datetime: `${dateStr(new Date())} 09:00:00`,
            };
        });
    }

    async regulatoryPunish(): Promise<{ code: string[] }> {
        return { code: ['6180'] };
    }

    async subscribe(key: ContractKey, quote: StreamQuoteType): Promise<void> {
        this.engine.subscribe(key.code, quote);
    }

    async unsubscribe(
        key: ContractKey,
        quote: StreamQuoteType,
    ): Promise<void> {
        this.engine.unsubscribe(key.code, quote);
    }

    onTick(cb: (channel: TickChannel, tick: SseTick) => void): void {
        this.engine.onTick(cb);
    }

    onBidAsk(cb: (channel: BidAskChannel, bidask: SseBidAsk) => void): void {
        this.engine.onBidAsk(cb);
    }

    lastPrice(code: string): number | undefined {
        if (!this.engine.getInstrument(code)) return undefined;
        return this.engine.lastPrice(code);
    }

    displayName(code: string): string | undefined {
        return this.engine.getInstrument(code)?.name;
    }

    aliasTarget(code: string): string | undefined {
        return this.engine.getInstrument(code)?.target_code ?? undefined;
    }

    dispose(): void {
        this.engine.dispose();
    }
}
