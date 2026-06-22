import type { TradeConfig, TradeProviderName } from './backend';

type BrokerAvailability = { env: boolean; saved: boolean } | undefined;
type BrokerMetadata = TradeConfig['metadata'][Exclude<TradeProviderName, 'mock'>];

export type TradePickerAction =
    | { kind: 'idle' }
    | { kind: 'switch' }
    | { kind: 'saved-switch'; metadata: NonNullable<BrokerMetadata> }
    | { kind: 'setup' };

export function resolveTradePickerAction({
    provider,
    current,
    busy,
    availability,
    metadata,
}: {
    provider: TradeProviderName;
    current: TradeProviderName;
    busy: boolean;
    availability: BrokerAvailability;
    metadata: BrokerMetadata;
}): TradePickerAction {
    if (provider === current || busy) return { kind: 'idle' };
    if (provider === 'mock') return { kind: 'switch' };
    if (availability?.env) return { kind: 'switch' };
    if (availability?.saved && metadata) {
        return { kind: 'saved-switch', metadata };
    }
    return { kind: 'setup' };
}
