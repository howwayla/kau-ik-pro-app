// src/components/command-palette.tsx — Cmd+K symbol jump

import { useEffect, useRef, useState } from 'react';
import * as styles from './command-palette.css';

export function CommandPalette({
    open,
    onClose,
    onJump,
}: {
    open: boolean;
    onClose: () => void;
    onJump: (code: string) => Promise<unknown>;
}) {
    const [value, setValue] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (open) {
            setValue('');
            setError(false);
            setTimeout(() => inputRef.current?.focus(), 0);
        }
    }, [open]);

    if (!open) return null;

    const submit = async () => {
        const code = value.trim().toUpperCase();
        if (!code || busy) return;
        setBusy(true);
        setError(false);
        try {
            await onJump(code);
            onClose();
        } catch {
            setError(true);
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className={styles.overlay} onClick={onClose}>
            <div className={styles.box} onClick={(e) => e.stopPropagation()}>
                <input
                    ref={inputRef}
                    className={styles.input}
                    placeholder='輸入代碼跳轉商品（2330、TXFR1…）'
                    value={value}
                    onChange={(e) => {
                        setValue(e.target.value);
                        setError(false);
                    }}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') submit();
                        if (e.key === 'Escape') onClose();
                    }}
                />
                <div className={styles.hint}>
                    <span className={error ? styles.err : ''}>
                        {busy
                            ? '查詢中…'
                            : error
                              ? '找不到此商品代碼'
                              : 'Enter 跳轉 · Esc 關閉'}
                    </span>
                    <span>⌘K</span>
                </div>
            </div>
        </div>
    );
}
