// server/src/triggers/store.ts — JSON-file persistence for the trigger
// engine (same pattern as WatchlistStore). Every mutation persists
// synchronously: a crash between fire steps must never resurrect a
// trigger that already placed an order.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { PendingBracketRec, ServerTrigger } from './types.ts';

interface FileShape {
    triggers: ServerTrigger[];
    pendingBrackets: PendingBracketRec[];
}

export class TriggerStore {
    private data: FileShape = { triggers: [], pendingBrackets: [] };

    constructor(private filePath: string) {
        try {
            const raw = JSON.parse(readFileSync(filePath, 'utf8'));
            if (Array.isArray(raw?.triggers)) this.data.triggers = raw.triggers;
            if (Array.isArray(raw?.pendingBrackets)) {
                this.data.pendingBrackets = raw.pendingBrackets;
            }
        } catch {
            // first run or corrupted file — start clean
        }
    }

    private save(): void {
        mkdirSync(dirname(this.filePath), { recursive: true });
        writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
    }

    // ---- triggers ----

    triggers(): ServerTrigger[] {
        return this.data.triggers;
    }

    getTrigger(id: string): ServerTrigger | undefined {
        return this.data.triggers.find((t) => t.id === id);
    }

    upsertTrigger(trigger: ServerTrigger): void {
        const idx = this.data.triggers.findIndex((t) => t.id === trigger.id);
        if (idx >= 0) this.data.triggers[idx] = trigger;
        else this.data.triggers.push(trigger);
        this.save();
    }

    removeTrigger(id: string): ServerTrigger | undefined {
        const idx = this.data.triggers.findIndex((t) => t.id === id);
        if (idx < 0) return undefined;
        const [removed] = this.data.triggers.splice(idx, 1);
        this.save();
        return removed;
    }

    // ---- pending brackets ----

    brackets(): PendingBracketRec[] {
        return this.data.pendingBrackets;
    }

    upsertBracket(rec: PendingBracketRec): void {
        const idx = this.data.pendingBrackets.findIndex((b) => b.id === rec.id);
        if (idx >= 0) this.data.pendingBrackets[idx] = rec;
        else this.data.pendingBrackets.push(rec);
        this.save();
    }

    removeBracket(id: string): PendingBracketRec | undefined {
        const idx = this.data.pendingBrackets.findIndex((b) => b.id === id);
        if (idx < 0) return undefined;
        const [removed] = this.data.pendingBrackets.splice(idx, 1);
        this.save();
        return removed;
    }
}
