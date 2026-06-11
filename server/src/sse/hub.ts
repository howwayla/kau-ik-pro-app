// server/src/sse/hub.ts — single SSE fan-out for all connected clients.
// The frontend opens one EventSource at /api/v1/stream/data and expects
// named events (tick_stk, bidask_fop, order_event, heartbeat, …).

import type { ServerResponse } from 'node:http';

const HEARTBEAT_MS = 10_000;

export class SseHub {
    private clients = new Set<ServerResponse>();
    private heartbeatTimer: NodeJS.Timeout | null = null;
    // last tick/bidask frame per symbol — replayed to newly attached
    // clients. Quote snapshots arrive exactly once (at WS-subscribe time),
    // so without replay a client that connects a moment too late — or any
    // page reload after the close — would show empty quotes/depth.
    private lastQuotes = new Map<string, string>();

    attach(res: ServerResponse): void {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
            'Access-Control-Allow-Origin': '*',
        });
        res.write(': connected\n\n');
        for (const frame of this.lastQuotes.values()) {
            res.write(frame);
        }
        this.clients.add(res);
        res.on('close', () => {
            this.clients.delete(res);
        });
        if (!this.heartbeatTimer) {
            this.heartbeatTimer = setInterval(
                () => this.broadcast('heartbeat', { ts: Date.now() }),
                HEARTBEAT_MS,
            );
            this.heartbeatTimer.unref();
        }
    }

    broadcast(event: string, data: unknown): void {
        const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        if (event.startsWith('tick_') || event.startsWith('bidask_')) {
            const code = (data as { code?: string })?.code;
            // store even with zero clients attached — that's exactly the
            // race the replay exists to cover
            if (code) this.lastQuotes.set(`${event}:${code}`, frame);
        }
        for (const res of this.clients) {
            res.write(frame);
        }
    }

    /** drop cached quotes when the market source changes */
    clearQuoteCache(): void {
        this.lastQuotes.clear();
    }

    clientCount(): number {
        return this.clients.size;
    }
}
