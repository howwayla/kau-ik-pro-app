import type { DisplayPrice } from './display-price';

export interface StockPositionSummaryInput {
    code: string;
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
    missingPriceCount: number;
}

export function summarizeStockPositions(
    positions: readonly StockPositionSummaryInput[],
): StockPositionSummary {
    return positions.reduce<StockPositionSummary>(
        (summary, position) => {
            summary.totalPnl += position.pnl;
            summary.totalCost += position.averagePrice * position.quantity * 1000;

            const current = position.displayPrice.value;
            if (current === undefined) {
                summary.missingPriceCount += 1;
                return summary;
            }

            summary.totalMarketValue += current * position.quantity * 1000;
            if (position.reference !== undefined && position.reference > 0) {
                summary.todayUnrealized +=
                    (current - position.reference) * position.quantity * 1000;
            }
            return summary;
        },
        {
            totalPnl: 0,
            totalCost: 0,
            totalMarketValue: 0,
            todayUnrealized: 0,
            missingPriceCount: 0,
        },
    );
}
