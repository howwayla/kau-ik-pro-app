import type { TradeConfig } from './backend';
import type { BrokerName } from './broker-secret-payload';

type SecretStatus = { present: boolean } | null | undefined;

export function shouldRollbackSavedSecrets(status: SecretStatus): boolean {
    return status?.present !== true;
}

export async function getPreviousBrokerMetadata(
    fetchConfig: () => Promise<TradeConfig>,
    broker: BrokerName,
): Promise<TradeConfig['metadata'][BrokerName] | undefined> {
    try {
        return (await fetchConfig()).metadata[broker] ?? undefined;
    } catch {
        return undefined;
    }
}
