// server/src/providers/fugle/regulatory.ts — 處置/注意股名單 from the
// exchanges' open data (TWSE + TPEx OpenAPI). Public endpoints, no key.
//
// 處置 lists carry a DispositionPeriod — only codes whose period covers
// today are flagged. 注意 lists are rolling daily announcements.

const TIMEOUT_MS = 10_000;
const CACHE_MS = 60 * 60_000;

interface Lists {
    code: string[]; // 處置 (field name kept for the existing frontend)
    attention: string[];
}

let cache: { lists: Lists; at: number } | null = null;

async function getJson(url: string): Promise<any[]> {
    const res = await fetch(url, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { accept: 'application/json' },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
}

/** ROC date ('115/06/02', '1150602') → 'YYYYMMDD' */
function rocToYmd(s: string): string {
    const digits = s.replace(/\D/g, '');
    if (digits.length < 6) return '';
    const year = Number(digits.slice(0, digits.length - 4)) + 1911;
    return `${year}${digits.slice(-4)}`;
}

/** '115/06/02～115/06/15' or '1150611~1150625' covers today? */
function periodCoversToday(period: string, todayYmd: string): boolean {
    const parts = period.split(/[~～]/);
    if (parts.length !== 2) return false;
    const from = rocToYmd(parts[0]!.trim());
    const to = rocToYmd(parts[1]!.trim());
    return Boolean(from && to && from <= todayYmd && todayYmd <= to);
}

export async function fetchRegulatoryLists(): Promise<Lists> {
    if (cache && Date.now() - cache.at < CACHE_MS) return cache.lists;
    const now = new Date();
    const todayYmd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;

    const [twsePunish, twseAttention, tpexPunish, tpexAttention] =
        await Promise.allSettled([
            getJson('https://openapi.twse.com.tw/v1/announcement/punish'),
            getJson('https://openapi.twse.com.tw/v1/announcement/notetrans'),
            getJson('https://www.tpex.org.tw/openapi/v1/tpex_disposal_information'),
            getJson(
                'https://www.tpex.org.tw/openapi/v1/tpex_trading_warning_information',
            ),
        ]);

    const punish = new Set<string>();
    const attention = new Set<string>();

    if (twsePunish.status === 'fulfilled') {
        for (const row of twsePunish.value) {
            if (periodCoversToday(String(row.DispositionPeriod ?? ''), todayYmd)) {
                punish.add(String(row.Code ?? ''));
            }
        }
    }
    if (tpexPunish.status === 'fulfilled') {
        for (const row of tpexPunish.value) {
            if (periodCoversToday(String(row.DispositionPeriod ?? ''), todayYmd)) {
                punish.add(String(row.SecuritiesCompanyCode ?? ''));
            }
        }
    }
    if (twseAttention.status === 'fulfilled') {
        for (const row of twseAttention.value) {
            attention.add(String(row.Code ?? ''));
        }
    }
    if (tpexAttention.status === 'fulfilled') {
        // rows span several days — keep only the latest announcement date
        const rows = tpexAttention.value;
        const maxDate = rows.reduce(
            (m: string, r: any) => (String(r.Date ?? '') > m ? String(r.Date) : m),
            '',
        );
        for (const row of rows) {
            if (String(row.Date ?? '') === maxDate) {
                attention.add(String(row.SecuritiesCompanyCode ?? ''));
            }
        }
    }
    punish.delete('');
    attention.delete('');

    const lists: Lists = {
        code: [...punish],
        attention: [...attention],
    };
    // keep a stale cache on total failure so a flaky network doesn't blank
    // the flags mid-session
    if (lists.code.length > 0 || lists.attention.length > 0 || !cache) {
        cache = { lists, at: Date.now() };
    }
    return cache.lists;
}
