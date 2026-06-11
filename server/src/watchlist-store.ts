// server/src/watchlist-store.ts — JSON-file persistence for watchlists.

import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ServerWatchlist } from './types/dto.ts';

export class WatchlistStore {
    private lists: ServerWatchlist[] = [];

    constructor(private filePath: string) {
        try {
            this.lists = JSON.parse(readFileSync(filePath, 'utf8'));
        } catch {
            this.lists = [];
        }
    }

    private save(): void {
        mkdirSync(dirname(this.filePath), { recursive: true });
        writeFileSync(this.filePath, JSON.stringify(this.lists, null, 2));
    }

    all(): ServerWatchlist[] {
        return this.lists;
    }

    create(
        name: string,
        contracts: ServerWatchlist['contracts'],
    ): ServerWatchlist {
        const list: ServerWatchlist = { id: randomUUID(), name, contracts };
        this.lists.push(list);
        this.save();
        return list;
    }

    update(
        id: string,
        contracts: ServerWatchlist['contracts'],
    ): ServerWatchlist | null {
        const list = this.lists.find((l) => l.id === id);
        if (!list) return null;
        list.contracts = contracts;
        this.save();
        return list;
    }

    /** idempotent bulk-import primitive: same name → replace contents */
    upsertByName(
        name: string,
        contracts: ServerWatchlist['contracts'],
    ): { list: ServerWatchlist; created: boolean } {
        const existing = this.lists.find((l) => l.name === name);
        if (existing) {
            existing.contracts = contracts;
            this.save();
            return { list: existing, created: false };
        }
        return { list: this.create(name, contracts), created: true };
    }
}
