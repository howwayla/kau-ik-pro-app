// src/components/hud-header.tsx — top status bar with workspace menus

import { useEffect, useState } from 'react';
import { useStreamStatus } from '../hooks/use-stream';
import {
    getDailyPnl,
    setRiskSettings,
    useRiskSettings,
} from '../lib/risk';
import {
    fetchHealth,
    fetchInfo,
    fetchMarketConfig,
    fetchTradeConfig,
    setMarketSource,
    setTradeSource,
    type MarketConfig,
    type TradeConfig,
    type TradeProviderName,
} from '../lib/backend';
import { setCapabilities } from '../lib/capabilities';
import { useTriggerStatus } from '../lib/triggers';
import { SENSITIVE, setPrivacy, usePrivacy } from '../lib/privacy';
import { setSoundEnabled, soundEnabled } from '../lib/sounds';
import {
    setThemeSettings,
    useThemeSettings,
    type Convention,
    type FontScale,
    type ThemeMode,
} from '../lib/theme-store';
import { fmtMoney } from '../lib/utils/format';
import type { BlockType } from '../lib/workspace';
import { MarketBar } from './market-bar';
import * as panel from './panel.css';
import * as styles from './hud-header.css';

const STATUS_LABEL = {
    live: 'LIVE',
    connecting: 'SYNC',
    down: 'LOST',
} as const;

const MODE_OPTIONS: { key: ThemeMode; label: string }[] = [
    { key: 'dark', label: '深色' },
    { key: 'midnight', label: '純黑' },
    { key: 'light', label: '淺色' },
];

const CONVENTION_OPTIONS: { key: Convention; label: string }[] = [
    { key: 'tw', label: '紅漲綠跌' },
    { key: 'intl', label: '綠漲紅跌' },
];

const FONT_SCALE_OPTIONS: { key: FontScale; label: string }[] = [
    { key: 90, label: '小' },
    { key: 100, label: '標準' },
    { key: 110, label: '大' },
    { key: 125, label: '特大' },
];

function Menu({
    label,
    children,
}: {
    label: string;
    children: (close: () => void) => React.ReactNode;
}) {
    const [open, setOpen] = useState(false);
    return (
        <div className={styles.settingsWrap}>
            <button
                className={styles.resetBtn}
                onClick={() => setOpen((o) => !o)}
            >
                {label}
            </button>
            {open && (
                <>
                    <div
                        className={styles.popoverBackdrop}
                        onClick={() => setOpen(false)}
                    />
                    <div className={styles.popover}>
                        {children(() => setOpen(false))}
                    </div>
                </>
            )}
        </div>
    );
}

function ThemeSettings() {
    const settings = useThemeSettings();
    const [sound, setSound] = useState(soundEnabled());
    return (
        <Menu label='主題'>
            {() => (
                <>
                    <span className={styles.settingLabel}>主題 Theme</span>
                    <div className={styles.settingGroup}>
                        {MODE_OPTIONS.map((m) => (
                            <button
                                key={m.key}
                                className={
                                    styles.opt[
                                        settings.mode === m.key ? 'on' : 'off'
                                    ]
                                }
                                onClick={() =>
                                    setThemeSettings({ mode: m.key })
                                }
                            >
                                {m.label}
                            </button>
                        ))}
                    </div>
                    <span className={styles.settingLabel}>
                        漲跌顏色 Price Colors
                    </span>
                    <div className={styles.settingGroup}>
                        {CONVENTION_OPTIONS.map((c) => (
                            <button
                                key={c.key}
                                className={
                                    styles.opt[
                                        settings.convention === c.key
                                            ? 'on'
                                            : 'off'
                                    ]
                                }
                                onClick={() =>
                                    setThemeSettings({ convention: c.key })
                                }
                            >
                                {c.label}
                            </button>
                        ))}
                    </div>
                    <div className={styles.convPreview}>
                        <span className={panel.dirText.up}>▲ +1.25 上漲</span>
                        <span className={panel.dirText.down}>
                            ▼ -1.25 下跌
                        </span>
                    </div>
                    <span className={styles.settingLabel}>字級 Font Size</span>
                    <div className={styles.settingGroup}>
                        {FONT_SCALE_OPTIONS.map((f) => (
                            <button
                                key={f.key}
                                className={
                                    styles.opt[
                                        settings.fontScale === f.key
                                            ? 'on'
                                            : 'off'
                                    ]
                                }
                                onClick={() =>
                                    setThemeSettings({ fontScale: f.key })
                                }
                            >
                                {f.label}
                            </button>
                        ))}
                    </div>
                    <span className={styles.settingLabel}>音效 Sound</span>
                    <button
                        className={styles.opt[sound ? 'on' : 'off']}
                        onClick={() => {
                            setSoundEnabled(!sound);
                            setSound(!sound);
                        }}
                    >
                        {sound ? '🔉 成交/警示音效開啟' : '🔇 音效關閉'}
                    </button>
                </>
            )}
        </Menu>
    );
}

function MarketSourceMenu() {
    const [config, setConfig] = useState<MarketConfig | null>(null);
    const [key, setKey] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        fetchMarketConfig()
            .then(setConfig)
            .catch(() => setConfig(null));
    }, []);

    const connectFugle = async () => {
        if (busy) return;
        setBusy(true);
        setError('');
        try {
            const res = await setMarketSource(
                key.trim() ? { api_key: key.trim() } : { provider: 'fugle' },
            );
            if (res.warning) {
                // show the degraded-mode warning before reloading
                setError(`⚠ ${res.warning}（5 秒後重新整理）`);
                setTimeout(() => window.location.reload(), 5000);
                return;
            }
            // charts/contract caches hold old-provider data — full reload
            window.location.reload();
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            setBusy(false);
        }
    };

    const backToMock = async () => {
        if (busy) return;
        setBusy(true);
        setError('');
        try {
            await setMarketSource({ provider: 'mock' });
            window.location.reload();
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            setBusy(false);
        }
    };

    const provider = config?.provider ?? 'mock';
    const isFugle = provider === 'fugle';
    const marketLabel =
        {
            mock: '模擬',
            fugle: '富果',
            fubon: '富邦',
            nova: '台新',
            esun: '玉山',
        }[provider] ?? provider;
    return (
        <Menu label={`行情·${marketLabel}`}>
            {() => (
                <>
                    <span className={styles.settingLabel}>
                        行情來源 Market Data
                    </span>
                    <span className={styles.emptyHint}>
                        目前：
                        {isFugle
                            ? '富果行情 API（真實報價）'
                            : provider === 'mock'
                              ? '內建模擬行情（隨機走動）'
                              : `${marketLabel}券商行情（隨券商連線，免富果 Key）`}
                    </span>
                    <span className={styles.settingLabel}>
                        Fugle API Key
                    </span>
                    <div className={styles.saveRow}>
                        <input
                            className={styles.saveInput}
                            type='password'
                            value={key}
                            placeholder={
                                config?.has_key
                                    ? '已儲存（輸入可更換）'
                                    : '貼上你的 API Key'
                            }
                            onChange={(e) => setKey(e.target.value)}
                        />
                    </div>
                    <button
                        className={styles.opt[isFugle ? 'on' : 'off']}
                        disabled={busy || (!key.trim() && !config?.has_key)}
                        onClick={connectFugle}
                    >
                        {busy
                            ? '驗證中…'
                            : isFugle
                              ? '↻ 重新連接富果行情'
                              : '✓ 連接富果行情'}
                    </button>
                    {isFugle && (
                        <button
                            className={styles.opt.off}
                            disabled={busy}
                            onClick={backToMock}
                        >
                            切回模擬行情
                        </button>
                    )}
                    {error && (
                        <span className={`${styles.emptyHint} ${panel.dirText.up}`}>
                            ✕ {error}
                        </span>
                    )}
                    <span className={styles.emptyHint}>
                        Key 申請：developer.fugle.tw（僅存於本機
                        server/data/config.json）。注意：免費方案有 WebSocket
                        訂閱數與 REST 速率上限，自選清單過多時部分報價可能不動。
                    </span>
                </>
            )}
        </Menu>
    );
}

function PrivacyToggle() {
    const on = usePrivacy();
    return (
        <button
            className={styles.resetBtn}
            title={
                on
                    ? '隱私模式開啟中 — 金額/部位/損益已遮罩（點擊顯示）'
                    : '開啟隱私模式 — 遮罩機敏數字，截圖/分享畫面用'
            }
            onClick={() => setPrivacy(!on)}
        >
            {on ? '🙈 隱私' : '👁 隱私'}
        </button>
    );
}

const BROKER_LABEL: Record<TradeProviderName, string> = {
    mock: '模擬',
    fubon: '富邦',
    nova: '台新',
    esun: '玉山',
};

function BrokerMenu() {
    const [config, setConfig] = useState<TradeConfig | null>(null);
    // broker awaiting credentials input (no env/saved creds on the server)
    const [pending, setPending] = useState<'fubon' | 'nova' | 'esun' | null>(
        null,
    );
    const [form, setForm] = useState({
        idNo: '',
        password: '',
        apiKey: '',
        apiSecret: '',
        certPath: '',
        certPass: '',
    });
    const [busy, setBusy] = useState<TradeProviderName | null>(null);
    const [error, setError] = useState('');

    useEffect(() => {
        fetchTradeConfig()
            .then((cfg) => {
                setConfig(cfg);
                // scope client-side stop/take triggers to this broker
            })
            .catch(() => setConfig(null));
    }, []);

    const doSwitch = async (
        provider: TradeProviderName,
        creds?: typeof form,
    ) => {
        if (busy) return;
        setBusy(provider);
        setError('');
        try {
            const res = await setTradeSource({
                provider,
                ...(creds
                    ? {
                          id_no: creds.idNo,
                          password: creds.password,
                          api_key: creds.apiKey,
                          api_secret: creds.apiSecret,
                          cert_path: creds.certPath,
                          cert_pass: creds.certPass,
                      }
                    : {}),
            });
            if (res.warning) {
                setError(`⚠ ${res.warning}（5 秒後重新整理）`);
                setTimeout(() => window.location.reload(), 5000);
                return;
            }
            // contract caches / charts hold old-provider data — full reload
            window.location.reload();
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            setBusy(null);
        }
    };

    const pick = (provider: TradeProviderName) => {
        if (provider === current || busy) return;
        if (provider === 'mock') {
            void doSwitch('mock');
            return;
        }
        const avail = config?.creds?.[provider];
        if (avail?.saved || avail?.env) {
            void doSwitch(provider);
        } else {
            setPending(provider);
            setError('');
        }
    };

    const current = config?.provider ?? 'mock';
    const field = (key: keyof typeof form, value: string) =>
        setForm((f) => ({ ...f, [key]: value }));
    const formReady =
        form.idNo.trim() &&
        form.certPath.trim() &&
        (form.password || form.apiKey.trim()) &&
        (pending !== 'esun' ||
            (form.password && form.apiKey.trim() && form.apiSecret.trim()));

    return (
        <Menu label={`券商·${BROKER_LABEL[current]}`}>
            {() => (
                <>
                    <span className={styles.settingLabel}>
                        券商 Trading Broker
                    </span>
                    <span className={styles.emptyHint}>
                        目前：
                        {current === 'mock'
                            ? '模擬撮合（紙上交易）'
                            : `${BROKER_LABEL[current]}證券 — ⚠ 真實下單`}
                    </span>
                    <div className={styles.settingGroup}>
                        {(['mock', 'fubon', 'nova', 'esun'] as const).map(
                            (p) => (
                                <button
                                    key={p}
                                    className={
                                        styles.opt[
                                            current === p ? 'on' : 'off'
                                        ]
                                    }
                                    disabled={Boolean(busy)}
                                    onClick={() => pick(p)}
                                >
                                    {busy === p ? '登入中…' : BROKER_LABEL[p]}
                                </button>
                            ),
                        )}
                    </div>
                    {/* 每家券商：即使已有存檔憑證，也可改用其他帳號登入 */}
                    {(['fubon', 'nova', 'esun'] as const).map((p) => {
                        const avail = config?.creds?.[p];
                        if (!avail?.saved && !avail?.env) return null;
                        if (pending === p) return null;
                        return (
                            <button
                                key={`relogin-${p}`}
                                className={styles.menuItem}
                                onClick={() => {
                                    setPending(p);
                                    setForm({
                                        idNo: '',
                                        password: '',
                                        apiKey: '',
                                        apiSecret: '',
                                        certPath: '',
                                        certPass: '',
                                    });
                                    setError('');
                                }}
                            >
                                🔑 用其他{BROKER_LABEL[p]}帳號登入
                            </button>
                        );
                    })}
                    {pending && (
                        <>
                            <span className={styles.settingLabel}>
                                {BROKER_LABEL[pending]}憑證（僅存於本機
                                server/data/config.json）
                            </span>
                            <input
                                className={styles.saveInput}
                                placeholder={
                                    pending === 'esun'
                                        ? '證券帳號（884 開頭）'
                                        : '身分證字號'
                                }
                                value={form.idNo}
                                onChange={(e) => field('idNo', e.target.value)}
                            />
                            <input
                                className={styles.saveInput}
                                type='password'
                                placeholder={
                                    pending === 'fubon'
                                        ? '密碼（或填下方 API Key）'
                                        : '密碼'
                                }
                                value={form.password}
                                onChange={(e) =>
                                    field('password', e.target.value)
                                }
                            />
                            {pending === 'fubon' && (
                                <input
                                    className={styles.saveInput}
                                    type='password'
                                    placeholder='API Key（可代替密碼）'
                                    value={form.apiKey}
                                    onChange={(e) =>
                                        field('apiKey', e.target.value)
                                    }
                                />
                            )}
                            {pending === 'esun' && (
                                <>
                                    <input
                                        className={styles.saveInput}
                                        type='password'
                                        placeholder='API Key'
                                        value={form.apiKey}
                                        onChange={(e) =>
                                            field('apiKey', e.target.value)
                                        }
                                    />
                                    <input
                                        className={styles.saveInput}
                                        type='password'
                                        placeholder='API Secret'
                                        value={form.apiSecret}
                                        onChange={(e) =>
                                            field('apiSecret', e.target.value)
                                        }
                                    />
                                </>
                            )}
                            <input
                                className={styles.saveInput}
                                placeholder='憑證路徑（.pfx / .p12 絕對路徑）'
                                value={form.certPath}
                                onChange={(e) =>
                                    field('certPath', e.target.value)
                                }
                            />
                            <input
                                className={styles.saveInput}
                                type='password'
                                placeholder='憑證密碼'
                                value={form.certPass}
                                onChange={(e) =>
                                    field('certPass', e.target.value)
                                }
                            />
                            <button
                                className={styles.opt.off}
                                disabled={Boolean(busy) || !formReady}
                                onClick={() => void doSwitch(pending, form)}
                            >
                                {busy ? '登入中…（約 10 秒）' : '✓ 登入並切換'}
                            </button>
                        </>
                    )}
                    {error && (
                        <span
                            className={`${styles.emptyHint} ${panel.dirText.up}`}
                        >
                            ✕ {error}
                        </span>
                    )}
                    <span className={styles.emptyHint}>
                        切換到券商後：交易走券商 API、行情直接用券商行情
                        （免富果 Key）。每一筆委託都是真實交易。
                    </span>
                </>
            )}
        </Menu>
    );
}

/** server trigger-engine health: protective orders live in the local
 *  server — closing the tab is fine, a dead server is not. */
function ProtectionPill() {
    const { status, offline } = useTriggerStatus();
    if (offline) {
        return (
            <div
                className={styles.chip}
                title='本機伺服器離線 — 停損/停利觸價保護已停止'
            >
                <span className={styles.led.down} />
                <span>保護離線</span>
            </div>
        );
    }
    if (!status) return null;
    const degraded = status.feed_mode === 'poll';
    const count = status.active + status.pending_brackets;
    return (
        <div
            className={styles.chip}
            title={
                degraded
                    ? (status.feed_warning ?? 'WS 降級 — 觸價精度下降')
                    : `伺服器觸價保護運作中：${status.active} 筆觸價單、${status.pending_brackets} 筆待掛括號${status.suspended ? `、${status.suspended} 筆已暫停` : ''}`
            }
        >
            <span
                className={styles.led[degraded ? 'connecting' : 'live']}
            />
            <span>
                保護 {count}
                {status.suspended > 0 ? ` ⏸${status.suspended}` : ''}
            </span>
        </div>
    );
}

function RiskMenu() {
    const risk = useRiskSettings();
    const dailyPnl = getDailyPnl();
    return (
        <Menu label={risk.locked ? '🔒 風控鎖定' : '風控'}>
            {() => (
                <>
                    <button
                        className={
                            risk.locked
                                ? styles.killBtnOn
                                : styles.killBtnOff
                        }
                        onClick={() =>
                            setRiskSettings({ locked: !risk.locked })
                        }
                    >
                        {risk.locked
                            ? '🔓 解除鎖定（恢復下單）'
                            : '🔒 鎖定下單 Kill Switch'}
                    </button>
                    <span className={styles.settingLabel}>
                        風控規則 Rules
                    </span>
                    <button
                        className={
                            styles.opt[risk.enabled ? 'on' : 'off']
                        }
                        onClick={() =>
                            setRiskSettings({ enabled: !risk.enabled })
                        }
                    >
                        {risk.enabled ? '✓ 規則啟用中' : '啟用風控規則'}
                    </button>
                    <div className={styles.saveRow}>
                        <span className={styles.riskLabel}>單筆上限</span>
                        <input
                            className={styles.saveInput}
                            inputMode='numeric'
                            value={risk.maxQty || ''}
                            placeholder='不限'
                            onChange={(e) => {
                                const v = Number(e.target.value);
                                if (Number.isInteger(v) && v >= 0) {
                                    setRiskSettings({ maxQty: v });
                                }
                            }}
                        />
                    </div>
                    <div className={styles.saveRow}>
                        <span className={styles.riskLabel}>日虧上限</span>
                        <input
                            className={styles.saveInput}
                            inputMode='numeric'
                            value={risk.maxDailyLoss || ''}
                            placeholder='不限 (TWD)'
                            onChange={(e) => {
                                const v = Number(e.target.value);
                                if (Number.isInteger(v) && v >= 0) {
                                    setRiskSettings({ maxDailyLoss: v });
                                }
                            }}
                        />
                    </div>
                    <span className={styles.emptyHint}>
                        目前當日損益估算：{Math.round(dailyPnl).toLocaleString()}
                        （持倉未實現＋期貨平倉）
                        <br />
                        停損/停利觸價單不受風控封鎖。
                    </span>
                </>
            )}
        </Menu>
    );
}

function AddBlockMenu({
    addableTypes,
    onAddBlock,
}: {
    addableTypes: { type: BlockType; label: string; disabled: boolean }[];
    onAddBlock: (type: BlockType) => void;
}) {
    return (
        <Menu label='＋ 新增面板'>
            {(close) => (
                <>
                    <span className={styles.settingLabel}>
                        新增面板 Add Panel
                    </span>
                    {addableTypes.map((t) => (
                        <button
                            key={t.type}
                            className={styles.menuItem}
                            disabled={t.disabled}
                            onClick={() => {
                                onAddBlock(t.type);
                                close();
                            }}
                        >
                            {t.label}
                            {t.disabled && '（已存在）'}
                        </button>
                    ))}
                </>
            )}
        </Menu>
    );
}

function ProfilesMenu({
    profiles,
    onSaveProfile,
    onLoadProfile,
    onDeleteProfile,
    onResetWorkspace,
}: {
    profiles: string[];
    onSaveProfile: (name: string) => void;
    onLoadProfile: (name: string) => void;
    onDeleteProfile: (name: string) => void;
    onResetWorkspace: () => void;
}) {
    const [name, setName] = useState('');
    return (
        <Menu label='版面'>
            {(close) => (
                <>
                    <span className={styles.settingLabel}>
                        儲存目前版面 Save Layout
                    </span>
                    <div className={styles.saveRow}>
                        <input
                            className={styles.saveInput}
                            placeholder='版面名稱'
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && name.trim()) {
                                    onSaveProfile(name.trim());
                                    setName('');
                                }
                            }}
                        />
                        <button
                            className={styles.resetBtn}
                            disabled={!name.trim()}
                            onClick={() => {
                                if (name.trim()) {
                                    onSaveProfile(name.trim());
                                    setName('');
                                }
                            }}
                        >
                            儲存
                        </button>
                    </div>
                    <span className={styles.settingLabel}>
                        版面列表 Saved Layouts
                    </span>
                    {profiles.length === 0 && (
                        <span className={styles.emptyHint}>
                            尚無儲存的版面
                        </span>
                    )}
                    {profiles.map((p) => (
                        <div key={p} className={styles.profileRow}>
                            <button
                                className={styles.menuItem}
                                style={{ flex: 1 }}
                                onClick={() => {
                                    onLoadProfile(p);
                                    close();
                                }}
                            >
                                {p}
                            </button>
                            <button
                                className={styles.profileDelete}
                                title='刪除此版面'
                                onClick={() => onDeleteProfile(p)}
                            >
                                ✕
                            </button>
                        </div>
                    ))}
                    <button
                        className={styles.menuItem}
                        onClick={() => {
                            onResetWorkspace();
                            close();
                        }}
                    >
                        ↺ 重設為預設版面
                    </button>
                </>
            )}
        </Menu>
    );
}

export function HudHeader({
    accBalance,
    addableTypes,
    onAddBlock,
    profiles,
    onSaveProfile,
    onLoadProfile,
    onDeleteProfile,
    onResetWorkspace,
}: {
    accBalance?: number;
    addableTypes: { type: BlockType; label: string; disabled: boolean }[];
    onAddBlock: (type: BlockType) => void;
    profiles: string[];
    onSaveProfile: (name: string) => void;
    onLoadProfile: (name: string) => void;
    onDeleteProfile: (name: string) => void;
    onResetWorkspace: () => void;
}) {
    const streamStatus = useStreamStatus();
    const [simulation, setSimulation] = useState<boolean | null>(null);
    const [version, setVersion] = useState('');
    const [contractCount, setContractCount] = useState<number | null>(null);
    const [now, setNow] = useState(() => new Date());

    useEffect(() => {
        fetchInfo()
            .then((info) => {
                setSimulation(info.simulation);
                setVersion(info.version);
                setCapabilities(info.capabilities);
            })
            .catch(() => setSimulation(null));
        fetchHealth()
            .then((h) => setContractCount(h.contract_count))
            .catch(() => undefined);
        const t = setInterval(() => setNow(new Date()), 1000);
        return () => clearInterval(t);
    }, []);

    return (
        <header className={styles.header}>
            <div className={styles.logoBlock}>
                <span className={styles.logoMain}>Kau-ik Pro</span>
                <span className={styles.logoSub}>
                    交易終端 {version && `v${version}`}
                </span>
            </div>

            {simulation !== null &&
                (simulation ? (
                    <span className={styles.simBadge}>模擬環境</span>
                ) : (
                    <span className={styles.prodBadge}>正式環境</span>
                ))}

            <MarketBar />

            <div className={styles.spacer} />

            {accBalance !== undefined && (
                <div className={styles.chip}>
                    <span className={styles.chipLabel}>銀行水位</span>
                    <span className={SENSITIVE}>{fmtMoney(accBalance)}</span>
                </div>
            )}

            {contractCount !== null && (
                <div className={styles.chip}>
                    <span className={styles.chipLabel}>Contracts</span>
                    <span>{contractCount.toLocaleString()}</span>
                </div>
            )}

            <div className={styles.chip}>
                <span className={styles.led[streamStatus]} />
                <span>{STATUS_LABEL[streamStatus]}</span>
            </div>

            <ProtectionPill />

            <PrivacyToggle />
            <BrokerMenu />
            <MarketSourceMenu />
            <RiskMenu />
            <AddBlockMenu
                addableTypes={addableTypes}
                onAddBlock={onAddBlock}
            />
            <ProfilesMenu
                profiles={profiles}
                onSaveProfile={onSaveProfile}
                onLoadProfile={onLoadProfile}
                onDeleteProfile={onDeleteProfile}
                onResetWorkspace={onResetWorkspace}
            />
            <ThemeSettings />

            <span className={styles.clock}>
                {now.toLocaleTimeString('en-GB', { hour12: false })}
            </span>
        </header>
    );
}
