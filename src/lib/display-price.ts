export type DisplayPriceSource =
    | 'live'
    | 'close'
    | 'broker'
    | 'reference'
    | 'missing';

export interface DisplayPrice {
    value?: number;
    source: DisplayPriceSource;
    label: '即時' | '收盤' | '券商' | '參考' | '無資料';
    title: string;
}

export interface ResolveDisplayPriceInput {
    tickClose?: number;
    tickSimtrade?: boolean;
    snapshotClose?: number;
    brokerLastPrice?: number;
    reference?: number;
    previousClose?: number;
}

function positive(value: number | undefined): number | undefined {
    return Number.isFinite(value) && value !== undefined && value > 0
        ? value
        : undefined;
}

export function resolveDisplayPrice(input: ResolveDisplayPriceInput): DisplayPrice {
    const live = input.tickSimtrade ? undefined : positive(input.tickClose);
    if (live !== undefined) {
        return { value: live, source: 'live', label: '即時', title: '即時成交價' };
    }

    const close = positive(input.snapshotClose);
    if (close !== undefined) {
        return {
            value: close,
            source: 'close',
            label: '收盤',
            title: '最近收盤價',
        };
    }

    const broker = positive(input.brokerLastPrice);
    if (broker !== undefined) {
        return {
            value: broker,
            source: 'broker',
            label: '券商',
            title: '券商回報價格',
        };
    }

    const reference = positive(input.reference) ?? positive(input.previousClose);
    if (reference !== undefined) {
        return {
            value: reference,
            source: 'reference',
            label: '參考',
            title: '參考價',
        };
    }

    return {
        value: undefined,
        source: 'missing',
        label: '無資料',
        title: '沒有可用價格',
    };
}
