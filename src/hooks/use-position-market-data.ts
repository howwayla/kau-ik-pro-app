import { useEffect, useMemo, useState } from 'react';
import { fetchSnapshots } from '../lib/backend';
import { ensureContract } from '../lib/contracts-cache';
import type { ContractInfo } from '../lib/types/contract';
import type { Snapshot } from '../lib/types/market';
import type { Position } from '../lib/types/portfolio';

interface PositionMarketData {
    contracts: Record<string, ContractInfo | undefined>;
    snapshots: Record<string, Snapshot | undefined>;
}

function positionCodesKey(positions: readonly Position[]): string {
    return [
        ...new Set(positions.map((position) => position.code).filter(Boolean)),
    ]
        .sort()
        .join(',');
}

export function usePositionMarketData(
    positions: readonly Position[],
): PositionMarketData {
    const codesKey = useMemo(() => positionCodesKey(positions), [positions]);
    const codes = useMemo(() => codesKey.split(',').filter(Boolean), [codesKey]);
    const [contracts, setContracts] = useState<
        Record<string, ContractInfo | undefined>
    >({});
    const [snapshots, setSnapshots] = useState<
        Record<string, Snapshot | undefined>
    >({});

    useEffect(() => {
        let alive = true;

        if (codes.length === 0) {
            setContracts({});
            setSnapshots({});
            return () => {
                alive = false;
            };
        }

        Promise.allSettled(codes.map((code) => ensureContract(code))).then(
            (results) => {
                if (!alive) return;

                const nextContracts: Record<
                    string,
                    ContractInfo | undefined
                > = {};
                for (const result of results) {
                    if (result.status === 'fulfilled') {
                        nextContracts[result.value.code] = result.value;
                    }
                }
                setContracts(nextContracts);

                const resolvedContracts = Object.values(nextContracts).filter(
                    (contract): contract is ContractInfo => Boolean(contract),
                );
                if (resolvedContracts.length === 0) {
                    setSnapshots({});
                    return;
                }

                fetchSnapshots(resolvedContracts)
                    .then((rows) => {
                        if (!alive) return;
                        setSnapshots(
                            Object.fromEntries(
                                rows.map((row) => [row.code, row]),
                            ),
                        );
                    })
                    .catch(() => {
                        if (alive) setSnapshots({});
                    });
            },
        );

        return () => {
            alive = false;
        };
    }, [codes, codesKey]);

    return { contracts, snapshots };
}
