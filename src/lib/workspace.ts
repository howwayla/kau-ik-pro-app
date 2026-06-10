// src/lib/workspace.ts — dynamic panel blocks + grid layout + named profiles

import type { LayoutItem } from 'react-grid-layout';

export type BlockType =
    | 'watchlist'
    | 'movers'
    | 'dock'
    | 'chart'
    | 'depth'
    | 'ticket'
    | 'tape'
    | 'flash'
    | 'pnl'
    | 'chips'
    | 'volprofile'
    | 'optchain'
    | 'replay'
    | 'depthmap';

export interface Block {
    id: string;
    type: BlockType;
    // null → follows the globally selected symbol; string → pinned to a code
    pin: string | null;
}

export interface Workspace {
    blocks: Block[];
    layout: LayoutItem[];
}

export interface Profile {
    name: string;
    workspace: Workspace;
}

export const BLOCK_META: Record<
    BlockType,
    {
        label: string;
        pinnable: boolean;
        singleton: boolean;
        defaultSize: { w: number; h: number; minW: number; minH: number };
    }
> = {
    watchlist: {
        label: '自選清單',
        pinnable: false,
        singleton: true,
        defaultSize: { w: 4, h: 14, minW: 3, minH: 6 },
    },
    movers: {
        label: '排行榜',
        pinnable: false,
        singleton: true,
        defaultSize: { w: 4, h: 11, minW: 3, minH: 5 },
    },
    dock: {
        label: '持倉/委託/帳務',
        pinnable: false,
        singleton: true,
        defaultSize: { w: 15, h: 9, minW: 6, minH: 5 },
    },
    chart: {
        label: 'K 線圖',
        pinnable: true,
        singleton: false,
        defaultSize: { w: 10, h: 12, minW: 6, minH: 7 },
    },
    depth: {
        label: '五檔',
        pinnable: true,
        singleton: false,
        defaultSize: { w: 5, h: 8, minW: 4, minH: 7 },
    },
    ticket: {
        label: '下單面板',
        pinnable: true,
        singleton: false,
        defaultSize: { w: 5, h: 11, minW: 4, minH: 10 },
    },
    tape: {
        label: '成交明細',
        pinnable: true,
        singleton: false,
        defaultSize: { w: 4, h: 8, minW: 3, minH: 4 },
    },
    flash: {
        label: '閃電下單',
        pinnable: true,
        singleton: false,
        defaultSize: { w: 5, h: 14, minW: 4, minH: 8 },
    },
    pnl: {
        label: '損益分析',
        pinnable: false,
        singleton: true,
        defaultSize: { w: 8, h: 8, minW: 6, minH: 6 },
    },
    chips: {
        label: '籌碼資訊',
        pinnable: true,
        singleton: false,
        defaultSize: { w: 5, h: 8, minW: 4, minH: 5 },
    },
    volprofile: {
        label: '分價量表',
        pinnable: true,
        singleton: false,
        defaultSize: { w: 5, h: 12, minW: 4, minH: 6 },
    },
    optchain: {
        label: '選擇權 T 字',
        pinnable: false,
        singleton: true,
        defaultSize: { w: 10, h: 14, minW: 8, minH: 8 },
    },
    replay: {
        label: '行情回放',
        pinnable: true,
        singleton: false,
        defaultSize: { w: 10, h: 10, minW: 6, minH: 6 },
    },
    depthmap: {
        label: '委託簿熱圖',
        pinnable: true,
        singleton: false,
        defaultSize: { w: 8, h: 9, minW: 5, minH: 6 },
    },
};

export const DEFAULT_WORKSPACE: Workspace = {
    blocks: [
        { id: 'watchlist-0', type: 'watchlist', pin: null },
        { id: 'movers-0', type: 'movers', pin: null },
        { id: 'chart-0', type: 'chart', pin: null },
        { id: 'dock-0', type: 'dock', pin: null },
        { id: 'depth-0', type: 'depth', pin: null },
        { id: 'ticket-0', type: 'ticket', pin: null },
        { id: 'tape-0', type: 'tape', pin: null },
    ],
    layout: [
        { i: 'watchlist-0', x: 0, y: 0, w: 4, h: 14, minW: 3, minH: 6 },
        { i: 'movers-0', x: 0, y: 14, w: 4, h: 11, minW: 3, minH: 5 },
        { i: 'chart-0', x: 4, y: 0, w: 15, h: 16, minW: 6, minH: 7 },
        { i: 'dock-0', x: 4, y: 16, w: 15, h: 9, minW: 6, minH: 5 },
        { i: 'depth-0', x: 19, y: 0, w: 5, h: 8, minW: 4, minH: 7 },
        { i: 'ticket-0', x: 19, y: 8, w: 5, h: 11, minW: 4, minH: 10 },
        { i: 'tape-0', x: 19, y: 19, w: 5, h: 6, minW: 3, minH: 4 },
    ],
};

const WS_KEY = 'sj-pro-workspace-v2';
const PROFILES_KEY = 'sj-pro-profiles-v1';

function validWorkspace(w: unknown): w is Workspace {
    if (!w || typeof w !== 'object') return false;
    const ws = w as Workspace;
    if (!Array.isArray(ws.blocks) || !Array.isArray(ws.layout)) return false;
    if (ws.blocks.length === 0) return false;
    const ids = new Set(ws.blocks.map((b) => b.id));
    return ws.layout.every((l) => ids.has(l.i));
}

export function loadWorkspace(): Workspace {
    try {
        const raw = localStorage.getItem(WS_KEY);
        if (raw) {
            const w = JSON.parse(raw);
            if (validWorkspace(w)) return w;
        }
    } catch {
        // fall through
    }
    return structuredClone(DEFAULT_WORKSPACE);
}

export function saveWorkspace(w: Workspace) {
    localStorage.setItem(WS_KEY, JSON.stringify(w));
}

export function loadProfiles(): Profile[] {
    try {
        const raw = localStorage.getItem(PROFILES_KEY);
        if (raw) {
            const arr = JSON.parse(raw);
            if (Array.isArray(arr)) {
                return (arr as Profile[]).filter(
                    (p) =>
                        typeof p.name === 'string' &&
                        validWorkspace(p.workspace),
                );
            }
        }
    } catch {
        // fall through
    }
    return [];
}

export function saveProfiles(profiles: Profile[]) {
    localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
}

let blockCounter = Date.now() % 100000;
export function newBlockId(type: BlockType): string {
    blockCounter += 1;
    return `${type}-${blockCounter}`;
}
