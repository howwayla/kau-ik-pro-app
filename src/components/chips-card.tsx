// src/components/chips-card.tsx — 個股籌碼卡: margin/short quota, lending
// sources, regulatory punish flag (stocks only)

import { useCallback } from 'react';
import { usePoll } from '../hooks/use-poll';
import { apiPost } from '../lib/api';
import { useRegulatoryFlag } from '../lib/regulatory';
import type { ContractInfo } from '../lib/types/contract';
import { fmtInt } from '../lib/utils/format';
import * as dock from './bottom-dock.css';
import * as panel from './panel.css';

interface CreditEnquire {
    stock_id: string;
    system: string;
    update_time: string;
    margin_unit: number;
    short_unit: number;
    margin_loan_ratio: number;
    short_margin_ratio: number;
}

interface ShortSource {
    code: string;
    short_stock_source: number;
    datetime: string;
}

interface ChipsData {
    credit?: CreditEnquire;
    shortSource?: ShortSource;
}

async function fetchChips(contract: ContractInfo): Promise<ChipsData> {
    const key = {
        security_type: contract.security_type,
        exchange: contract.exchange,
        code: contract.code,
    };
    const [credit, short] = await Promise.allSettled([
        apiPost<CreditEnquire[]>('/api/v1/data/credit_enquire', {
            contracts: [key],
        }),
        apiPost<ShortSource[]>('/api/v1/data/short_stock_sources', {
            contracts: [key],
        }),
    ]);
    return {
        credit:
            credit.status === 'fulfilled' ? credit.value[0] : undefined,
        shortSource:
            short.status === 'fulfilled' ? short.value[0] : undefined,
    };
}

export function ChipsCard({ contract }: { contract: ContractInfo }) {
    const { data } = usePoll<ChipsData>(
        useCallback(() => fetchChips(contract), [contract]),
        60000,
    );
    const regFlag = useRegulatoryFlag(contract.code);

    if (contract.security_type !== 'STK') {
        return (
            <div className={dock.emptyState}>籌碼資訊僅支援股票商品</div>
        );
    }
    if (!data) {
        return <div className={dock.emptyState}>載入籌碼資訊…</div>;
    }

    const items: { label: string; value: string; warn?: boolean }[] = [
        {
            label: '處置/注意',
            value:
                regFlag === 'punish'
                    ? '⚠ 處置股（分盤撮合）'
                    : regFlag === 'attention'
                      ? '△ 注意股'
                      : '正常',
            warn: regFlag !== null,
        },
        {
            label: '當沖資格',
            value:
                contract.day_trade === 'Yes'
                    ? '可當沖'
                    : contract.day_trade === 'OnlyBuy'
                      ? '僅可先買'
                      : '不可當沖',
            warn: contract.day_trade !== 'Yes',
        },
    ];
    if (data.credit) {
        items.push(
            {
                label: '融資成數 / 餘額單位',
                value: `${data.credit.margin_loan_ratio}% / ${fmtInt(data.credit.margin_unit)}`,
            },
            {
                label: '融券成數 / 餘額單位',
                value: `${data.credit.short_margin_ratio}% / ${fmtInt(data.credit.short_unit)}`,
            },
        );
    }
    items.push(
        {
            label: '融資餘額(契約)',
            value: fmtInt(contract.margin_trading_balance),
        },
        {
            label: '融券餘額(契約)',
            value: fmtInt(contract.short_selling_balance),
        },
    );
    if (data.shortSource) {
        items.push({
            label: '可借券源',
            value: fmtInt(data.shortSource.short_stock_source),
        });
    }

    return (
        <div className={panel.panelBody}>
            <div className={dock.accountGrid}>
                {items.map((it) => (
                    <div key={it.label} className={dock.statCard}>
                        <span className={dock.statCardLabel}>{it.label}</span>
                        <span
                            className={`${dock.statCardValue} ${
                                it.warn ? panel.dirText.up : ''
                            }`}
                            style={{ fontSize: '0.85rem' }}
                        >
                            {it.value}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}
