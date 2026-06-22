import type { TradeConfig, TradeProviderName } from './backend';

export type BrokerName = Exclude<TradeProviderName, 'mock'>;
type BrokerAvailability = { env: boolean; saved: boolean } | undefined;
type BrokerMetadata = TradeConfig['metadata'][BrokerName];

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
    canUseSecureStorage,
}: {
    provider: TradeProviderName;
    current: TradeProviderName;
    busy: boolean;
    availability: BrokerAvailability;
    metadata: BrokerMetadata;
    canUseSecureStorage: boolean;
}): TradePickerAction {
    if (provider === current || busy) return { kind: 'idle' };
    if (provider === 'mock') return { kind: 'switch' };
    if (availability?.env) return { kind: 'switch' };
    if (availability?.saved && metadata && canUseSecureStorage) {
        return { kind: 'saved-switch', metadata };
    }
    if (availability?.saved && !canUseSecureStorage) return { kind: 'switch' };
    return { kind: 'setup' };
}

export function effectiveBrokerAvailability({
    availability,
    canUseSecureStorage,
    secretPresent,
}: {
    availability: BrokerAvailability;
    canUseSecureStorage: boolean;
    secretPresent?: boolean;
}): BrokerAvailability {
    if (!availability) return undefined;
    if (availability.env || !canUseSecureStorage) return availability;
    return {
        env: false,
        saved: availability.saved && secretPresent === true,
    };
}

export function savedBrokerNames(
    creds: TradeConfig['creds'] | undefined,
): BrokerName[] {
    return (['fubon', 'nova', 'esun'] as const).filter((broker) => {
        const availability = creds?.[broker];
        return Boolean(availability?.saved || availability?.env);
    });
}
