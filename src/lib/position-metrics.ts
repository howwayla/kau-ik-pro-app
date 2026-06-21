import type { Position, StockPosition } from './types/portfolio';

const STOCK_SHARE_MULTIPLIER = 1000;

export interface PositionMetrics {
    marketValue?: number;
    unrealizedReturnRate?: number;
    appliesToStock: boolean;
}

export function isStockPosition(position: Position): position is StockPosition {
    return 'yd_quantity' in position;
}

export function calculatePositionMetrics(
    position: Position,
    options: { displayPriceValue?: number },
): PositionMetrics {
    if (!isStockPosition(position)) {
        return {
            appliesToStock: false,
            marketValue: undefined,
            unrealizedReturnRate: undefined,
        };
    }

    const shares = position.quantity * STOCK_SHARE_MULTIPLIER;
    const cost = position.price * shares;
    const displayPrice = options.displayPriceValue;

    return {
        appliesToStock: true,
        marketValue:
            displayPrice !== undefined && Number.isFinite(displayPrice)
                ? displayPrice * shares
                : undefined,
        unrealizedReturnRate:
            cost > 0 && Number.isFinite(position.pnl)
                ? (position.pnl / cost) * 100
                : undefined,
    };
}
