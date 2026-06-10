// src/components/panel-chrome.tsx — shared panel title bar: drag handle,
// link/pin symbol toggle, remove button.

import { useEffect, useState } from 'react';
import * as panel from './panel.css';
import * as styles from './panel-chrome.css';

export function PanelChrome({
    title,
    pinnable = false,
    pin,
    currentCode,
    onPinChange,
    onRemove,
    onPopout,
    children,
}: {
    title: string;
    pinnable?: boolean;
    pin?: string | null;
    currentCode?: string | null;
    onPinChange?: (pin: string | null) => void;
    onRemove?: () => void;
    onPopout?: () => void;
    children?: React.ReactNode;
}) {
    const [editCode, setEditCode] = useState(pin ?? '');
    useEffect(() => setEditCode(pin ?? ''), [pin]);

    return (
        <div className={`${panel.panelTitle} drag-handle`}>
            <span className={panel.panelTitleDeco} />
            <span className={styles.titleText}>{title}</span>
            {children}
            <span className={styles.spacer} />
            {pinnable &&
                onPinChange &&
                (pin === null || pin === undefined ? (
                    <button
                        className={styles.pinBtn.linked}
                        title='跟隨自選清單選擇；點擊鎖定目前商品'
                        onClick={() =>
                            currentCode && onPinChange(currentCode)
                        }
                    >
                        🔗 連動
                    </button>
                ) : (
                    <>
                        <input
                            className={styles.pinInput}
                            value={editCode}
                            title='鎖定的商品代碼，Enter 套用'
                            onChange={(e) => setEditCode(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    const code = editCode
                                        .trim()
                                        .toUpperCase();
                                    if (code) onPinChange(code);
                                }
                            }}
                        />
                        <button
                            className={styles.pinBtn.pinned}
                            title='已鎖定；點擊恢復連動'
                            onClick={() => onPinChange(null)}
                        >
                            📌 鎖定
                        </button>
                    </>
                ))}
            {onPopout && (
                <button
                    className={styles.closeBtn}
                    title='彈出為獨立視窗（多螢幕）'
                    onClick={onPopout}
                >
                    ⧉
                </button>
            )}
            {onRemove && (
                <button
                    className={styles.closeBtn}
                    title='移除此面板'
                    onClick={onRemove}
                >
                    ✕
                </button>
            )}
        </div>
    );
}
