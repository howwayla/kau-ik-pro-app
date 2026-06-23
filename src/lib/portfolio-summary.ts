import type { DisplayPrice } from './display-price';

export interface StockPositionSummaryInput {
    code: string;
    direction: 'Buy' | 'Sell';
    quantity: number;
    averagePrice: number;
    pnl: number;
    reference?: number;
    displayPrice: DisplayPrice;
}

export interface StockPositionSummary {
    totalPnl: number;
    totalCost: number;
    totalMarketValue: number;
    todayUnrealized: number;
    todayBasisValue: number;
    missingPriceCount: number;
}

export function summarizeStockPositions(
    positions: readonly StockPositionSummaryInput[],
): StockPositionSummary {
    return positions.reduce<StockPositionSummary>(
        (summary, position) => {
            const directionSign = position.direction === 'Sell' ? -1 : 1;
            summary.totalPnl += position.pnl;
            summary.totalCost +=
                position.averagePrice * position.quantity * 1000 * directionSign;

            const current = position.displayPrice.value;
            if (current === undefined) {
                summary.missingPriceCount += 1;
                return summary;
            }

            summary.totalMarketValue +=
                current * position.quantity * 1000 * directionSign;
            if (position.reference !== undefined && position.reference > 0) {
                summary.todayBasisValue +=
                    position.reference * position.quantity * 1000 * directionSign;
                summary.todayUnrealized +=
                    (current - position.reference) *
                    position.quantity *
                    1000 *
                    directionSign;
            }
            return summary;
        },
        {
            totalPnl: 0,
            totalCost: 0,
            totalMarketValue: 0,
            todayUnrealized: 0,
            todayBasisValue: 0,
            missingPriceCount: 0,
        },
    );
}

export function formatMissingPriceCountHint(count: number): string {
    return count > 0 ? `有 ${count} 筆部位因缺少價格未納入` : '';
}
