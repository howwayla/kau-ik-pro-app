type BrokerLogName = 'fubon' | 'nova' | 'esun';

export function brokerLoginSuccessMessage(
    broker: BrokerLogName,
    availableAccountTypes: string[] = [],
): string {
    const types = availableAccountTypes
        .map((type) => type.trim())
        .filter(Boolean);
    const suffix = types.length ? `（${types.join('、')}帳戶可用）` : '';
    return `${broker}: 登入成功${suffix}`;
}
