// src/components/event-toasts.tsx — order/deal event notifications (SSE)

import { useEffect, useRef, useState } from 'react';
import { playAlert, playDeal, playError, playOrder } from '../lib/sounds';
import { onOrderEvent } from '../lib/stream';
import { onNotice } from '../lib/trade';
import type { OrderEventData } from '../lib/types/order';
import * as styles from './event-toasts.css';

interface ToastItem {
    id: number;
    title: string;
    body: string;
}

function describe(ev: OrderEventData): { title: string; body: string } {
    const op = ev.operation?.op_type ?? 'EVENT';
    const code = ev.contract?.code ?? ev.code ?? '';
    const order = ev.order;
    const failed = ev.operation?.op_code && ev.operation.op_code !== '00';
    const title = failed ? `✕ ${op} REJECTED` : `▸ ORDER ${op}`;
    const parts = [
        code,
        order?.action,
        order?.price !== undefined ? `@${order.price}` : '',
        order?.quantity !== undefined ? `x${order.quantity}` : '',
        failed ? ev.operation.op_msg : '',
    ].filter(Boolean);
    return { title, body: parts.join(' ') || JSON.stringify(ev).slice(0, 80) };
}

export function EventToasts({ onEvent }: { onEvent?: () => void }) {
    const [toasts, setToasts] = useState<ToastItem[]>([]);
    const nextId = useRef(1);
    const onEventRef = useRef(onEvent);
    onEventRef.current = onEvent;

    useEffect(() => {
        const push = (title: string, body: string) => {
            const id = nextId.current++;
            setToasts((prev) => [...prev.slice(-4), { id, title, body }]);
            setTimeout(
                () => setToasts((prev) => prev.filter((t) => t.id !== id)),
                6000,
            );
        };
        const offOrder = onOrderEvent((ev) => {
            const d = describe(ev);
            push(d.title, d.body);
            const op = ev.operation?.op_type ?? '';
            if (op === 'Deal' || ev.price !== undefined) playDeal();
            else playOrder();
            onEventRef.current?.();
        });
        const offNotice = onNotice((n) => {
            push(n.title, n.body);
            if (n.kind === 'err') playError();
            else if (n.title.includes('警示')) playAlert();
            else if (n.kind === 'ok') playOrder();
            if (n.kind === 'ok') onEventRef.current?.();
        });
        return () => {
            offOrder();
            offNotice();
        };
    }, []);

    return (
        <div className={styles.stack}>
            {toasts.map((t) => (
                <div key={t.id} className={styles.toast}>
                    <div className={styles.toastTitle}>{t.title}</div>
                    <div>{t.body}</div>
                </div>
            ))}
        </div>
    );
}
