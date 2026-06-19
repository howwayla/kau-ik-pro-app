import { useEffect } from 'react';
import { ensureContract, useContract } from '../lib/contracts-cache';
import { useRegulatoryFlag } from '../lib/regulatory';
import type { SecurityType } from '../lib/types/contract';
import * as styles from './symbol-cell.css';

export type SymbolMarker = 'trial' | 'punish' | 'attention';

export function SymbolCell({
    code,
    name,
    markers = [],
    className,
}: {
    code: string;
    name?: string;
    markers?: SymbolMarker[];
    className?: string;
}) {
    return (
        <span className={className ? `${styles.root} ${className}` : styles.root}>
            <span className={styles.codeLine}>
                <span className={styles.code}>{code}</span>
                {markers.map((marker) => (
                    <span
                        key={marker}
                        className={styles.badge[marker]}
                        title={markerLabel(marker)}
                    >
                        {markerText(marker)}
                    </span>
                ))}
            </span>
            {name && <span className={styles.name}>{name}</span>}
        </span>
    );
}

export function ResolvedSymbolCell({
    code,
    type,
    fallbackName,
    className,
}: {
    code: string;
    type?: SecurityType;
    fallbackName?: string;
    className?: string;
}) {
    const contract = useContract(code);
    const regFlag = useRegulatoryFlag(code);

    useEffect(() => {
        if (!code || contract) return;
        ensureContract(code, type).catch(() => undefined);
    }, [code, contract, type]);

    return (
        <SymbolCell
            code={code}
            name={contract?.name ?? fallbackName}
            markers={regFlag ? [regFlag] : []}
            className={className}
        />
    );
}

function markerLabel(marker: SymbolMarker): string {
    if (marker === 'trial') return '試算撮合';
    if (marker === 'punish') return '處置股';
    return '注意股';
}

function markerText(marker: SymbolMarker): string {
    if (marker === 'trial') return '試';
    if (marker === 'punish') return '處';
    return '注';
}
