// server/src/providers/nova/trading.ts — Taishin Nova (taishin-sdk) skeleton.
//
// Status: Phase 3 — blocked on opening a Taishin account and downloading
// the taishin-sdk .tgz (not on npm). The SDK surface mirrors fubon-neo
// (both are built on the Fugle trading SDK framework):
//   sdk.login(idNo, password, certPath, certPass) → accounts
//   sdk.stock.placeOrder(account, order, isPreOrder)
//   sdk.setOnOrder(cb) / sdk.setOnFilled(cb) / sdk.connectWebsocket()
// Docs: https://ml-fugle-api.tssco.com.tw/FugleSDK/docs/trading/
//
// Nova supports STOCKS ONLY — capabilities().futures === false, the
// frontend hides futures/options order UI based on /info.

import type {
    Account,
    AccountBalance,
    AccountTypeName,
    FuturesOrderReq,
    Margin,
    OrderEventData,
    PnlRow,
    Position,
    StockOrderReq,
    Trade,
} from '../../types/dto.ts';
import type { Config } from '../../config.ts';
import type { ContractKey } from '../market-data.ts';
import {
    FuturesNotSupportedError,
    zeroMargin,
    type TradingProvider,
} from '../trading.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnySdk = any;

export class NovaTradingProvider implements TradingProvider {
    private sdk: AnySdk = null;
    private account: AnySdk = null;
    private eventCbs: ((ev: OrderEventData) => void)[] = [];

    constructor(private config: Config) {}

    capabilities() {
        return { futures: false };
    }

    async init(): Promise<void> {
        const { idNo, password, certPath, certPass } = this.config.broker;
        if (!idNo || !password || !certPath) {
            throw new Error(
                'TRADE_PROVIDER=nova 需要 BROKER_ID_NO / BROKER_PASSWORD / BROKER_CERT_PATH / BROKER_CERT_PASS',
            );
        }
        let mod: AnySdk;
        try {
            mod = await import('taishin-sdk' as string);
        } catch {
            throw new Error(
                '找不到 taishin-sdk — 請從台新官網下載 .tgz 放入 server/vendor/ 並執行 ' +
                    'pnpm --filter nova-pro-server add file:vendor/taishinsdk-<version>.tgz',
            );
        }
        this.sdk = new mod.TaishinSDK();
        const accounts = this.sdk.login(idNo, password, certPath, certPass);
        this.account = (accounts?.data ?? accounts)?.[0];
        if (!this.account) {
            throw new Error('Nova 登入失敗');
        }
        // TODO(phase3): map Ack/Mat payloads to OrderEventData (see fubon
        // provider for the target shape — event-toasts and bracket.ts
        // depend on operation.op_type and the flat Deal fields)
        this.sdk.setOnOrder?.((_content: AnySdk) => {});
        this.sdk.setOnFilled?.((_content: AnySdk) => {});
        this.sdk.connectWebsocket?.();
        throw new Error(
            'Nova provider 尚未完成 — 拿到 SDK 後請完成 TODO(phase3) 對應',
        );
    }

    onOrderEvent(cb: (ev: OrderEventData) => void): void {
        this.eventCbs.push(cb);
    }

    async accounts(): Promise<Account[]> {
        throw new Error('not implemented (phase3)');
    }

    async placeStockOrder(
        _key: ContractKey,
        _order: StockOrderReq,
    ): Promise<Trade> {
        // TODO(phase3): sdk.stock.placeOrder(this.account, {...}, false)
        throw new Error('not implemented (phase3)');
    }

    async placeFuturesOrder(
        _key: ContractKey,
        _order: FuturesOrderReq,
    ): Promise<Trade> {
        throw new FuturesNotSupportedError();
    }

    async cancel(_tradeId: string): Promise<Trade> {
        throw new Error('not implemented (phase3)');
    }

    async updatePrice(_tradeId: string, _price: number): Promise<Trade> {
        throw new Error('not implemented (phase3)');
    }

    async updateQty(_tradeId: string, _quantity: number): Promise<Trade> {
        throw new Error('not implemented (phase3)');
    }

    async trades(_accountType: AccountTypeName): Promise<Trade[]> {
        return [];
    }

    async positions(_accountType: AccountTypeName): Promise<Position[]> {
        return [];
    }

    async accountBalance(): Promise<AccountBalance> {
        return { acc_balance: 0, date: '', errmsg: 'not implemented' };
    }

    async margin(): Promise<Margin> {
        return zeroMargin();
    }

    async profitLoss(
        _beginDate: string,
        _endDate: string,
        _accountType: AccountTypeName,
    ): Promise<PnlRow[]> {
        return [];
    }
}
