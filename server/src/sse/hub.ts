// server/src/sse/hub.ts — single SSE fan-out for all connected clients.
// The frontend opens one EventSource at /api/v1/stream/data and expects
// named events (tick_stk, bidask_fop, order_event, heartbeat, …).

import type { ServerResponse } from 'node:http';

const HEARTBEAT_MS = 10_000;

export class SseHub {
    private clients = new Set<ServerResponse>();
    private heartbeatTimer: NodeJS.Timeout | null = null;

    attach(res: ServerResponse): void {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
            'Access-Control-Allow-Origin': '*',
        });
        res.write(': connected\n\n');
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
        if (this.clients.size === 0) return;
        const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        for (const res of this.clients) {
            res.write(frame);
        }
    }

    clientCount(): number {
        return this.clients.size;
    }
}
