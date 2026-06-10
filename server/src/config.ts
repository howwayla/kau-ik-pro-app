// server/src/config.ts

export type MarketProviderName = 'mock' | 'fugle';
export type TradeProviderName = 'mock' | 'fubon' | 'nova';

export interface Config {
    port: number;
    host: string;
    marketProvider: MarketProviderName;
    tradeProvider: TradeProviderName;
    fugleApiKey: string;
    broker: {
        idNo: string;
        password: string;
        certPath: string;
        certPass: string;
    };
}

function pick<T extends string>(
    value: string | undefined,
    allowed: readonly T[],
    fallback: T,
): T {
    if (value && (allowed as readonly string[]).includes(value)) {
        return value as T;
    }
    if (value) {
        throw new Error(
            `invalid provider "${value}" — expected one of: ${allowed.join(', ')}`,
        );
    }
    return fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
    return {
        port: Number(env.PORT) || 8080,
        host: '127.0.0.1',
        marketProvider: pick(env.MARKET_PROVIDER, ['mock', 'fugle'], 'mock'),
        tradeProvider: pick(
            env.TRADE_PROVIDER,
            ['mock', 'fubon', 'nova'],
            'mock',
        ),
        fugleApiKey: env.FUGLE_API_KEY ?? '',
        broker: {
            idNo: env.BROKER_ID_NO ?? '',
            password: env.BROKER_PASSWORD ?? '',
            certPath: env.BROKER_CERT_PATH ?? '',
            certPass: env.BROKER_CERT_PASS ?? '',
        },
    };
}
