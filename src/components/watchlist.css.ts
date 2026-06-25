// src/components/watchlist.css.ts

import { style, styleVariants } from '@vanilla-extract/css';
import { vars } from '../theme.css';

export const list = style({
    display: 'flex',
    flexDirection: 'column',
});

const rowBase = style({
    position: 'relative',
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    gridTemplateRows: 'auto auto',
    columnGap: vars.space.sm,
    padding: `6px ${vars.space.md}`,
    cursor: 'pointer',
    borderBottom: `1px solid ${vars.color.border}`,
    borderLeft: '2px solid transparent',
    transition: 'background 0.12s, border-color 0.12s',
    ':hover': {
        background: vars.color.muted,
    },
});

export const row = styleVariants({
    normal: [rowBase],
    selected: [
        rowBase,
        {
            background: vars.color.accentDim,
            borderLeftColor: vars.color.accent,
        },
    ],
});

export const code = style({
    fontFamily: vars.font.mono,
    fontSize: '0.8rem',
    fontWeight: 600,
    color: vars.color.foreground,
});

export const name = style({
    fontSize: '0.68rem',
    color: vars.color.mutedForeground,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
});

export const price = style({
    fontFamily: vars.font.mono,
    fontSize: '0.82rem',
    fontWeight: 600,
    textAlign: 'right',
    fontVariantNumeric: 'tabular-nums',
});

/** 觸及漲/跌停：淡色底 + 同向色字（低調標註不搶版面） */
export const priceLimit = styleVariants({
    up: {
        background: `color-mix(in srgb, ${vars.color.up} 16%, transparent)`,
        color: vars.color.up,
        borderRadius: vars.radius.sm,
        padding: '0 4px',
    },
    down: {
        background: `color-mix(in srgb, ${vars.color.down} 16%, transparent)`,
        color: vars.color.down,
        borderRadius: vars.radius.sm,
        padding: '0 4px',
    },
});

/** 走勢線開啟時 row 改三欄：代碼 | sparkline | 價格 */
export const rowSpark = style({
    gridTemplateColumns: '1fr auto auto',
});

export const sparkCell = style({
    gridColumn: 2,
    gridRow: '1 / span 2',
    alignSelf: 'center',
    display: 'flex',
    alignItems: 'center',
    width: 64,
});

export const change = style({
    fontFamily: vars.font.mono,
    fontSize: '0.68rem',
    textAlign: 'right',
    fontVariantNumeric: 'tabular-nums',
});

export const flash = styleVariants({
    up: { animation: 'flash-up 0.5s ease-out' },
    down: { animation: 'flash-down 0.5s ease-out' },
    none: {},
});

// shown on row hover, floats over the change% cell
export const removeBtn = style({
    position: 'absolute',
    right: 2,
    top: 2,
    display: 'none',
    background: vars.color.inset,
    border: `1px solid ${vars.color.border}`,
    borderRadius: vars.radius.sm,
    color: vars.color.mutedForeground,
    fontSize: '0.62rem',
    lineHeight: 1,
    padding: '2px 4px',
    cursor: 'pointer',
    selectors: {
        [`${rowBase}:hover &`]: {
            display: 'block',
        },
        '&:hover': {
            color: vars.color.foreground,
            borderColor: vars.color.accent,
        },
    },
});

export const addRow = style({
    display: 'flex',
    gap: vars.space.xs,
    padding: vars.space.sm,
    borderTop: `1px solid ${vars.color.border}`,
    flexShrink: 0,
});

export const addInput = style({
    flex: 1,
    minWidth: 0,
    fontFamily: vars.font.mono,
    fontSize: '0.76rem',
    color: vars.color.foreground,
    background: vars.color.inset,
    border: `1px solid ${vars.color.border}`,
    borderRadius: vars.radius.sm,
    padding: '4px 8px',
    outline: 'none',
    ':focus': {
        borderColor: vars.color.accent,
    },
    '::placeholder': {
        color: vars.color.mutedForeground,
    },
});

// 加追蹤的代碼/名稱搜尋下拉（浮在輸入列上方）
export const searchMenu = style({
    position: 'absolute',
    bottom: '100%',
    left: vars.space.sm,
    right: vars.space.sm,
    marginBottom: '2px',
    background: vars.color.inset,
    border: `1px solid ${vars.color.border}`,
    borderRadius: vars.radius.sm,
    overflow: 'hidden',
    zIndex: 50,
    boxShadow: '0 -4px 16px rgba(0,0,0,0.35)',
    maxHeight: '240px',
    overflowY: 'auto',
});

export const searchItem = style({
    display: 'flex',
    alignItems: 'baseline',
    gap: vars.space.sm,
    width: '100%',
    textAlign: 'left',
    background: 'transparent',
    border: 'none',
    borderBottom: `1px solid ${vars.color.border}`,
    padding: '5px 10px',
    cursor: 'pointer',
    ':hover': {
        background: vars.color.muted,
    },
});

export const searchCode = style({
    fontFamily: vars.font.mono,
    fontSize: '0.76rem',
    fontWeight: 600,
    color: vars.color.foreground,
    minWidth: '3.4rem',
});

export const searchName = style({
    fontSize: '0.7rem',
    color: vars.color.mutedForeground,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
});

export const typeSelect = style({
    fontFamily: vars.font.body,
    fontSize: '0.72rem',
    color: vars.color.foreground,
    background: vars.color.inset,
    border: `1px solid ${vars.color.border}`,
    borderRadius: vars.radius.sm,
    outline: 'none',
});

// 試撮 / 處置 / 注意 markers next to the code
export const rowBadge = styleVariants({
    trial: {
        fontFamily: vars.font.display,
        fontSize: '0.56rem',
        fontWeight: 600,
        color: vars.color.amber,
        border: `1px solid ${vars.color.amber}`,
        borderRadius: vars.radius.sm,
        padding: '0 3px',
        marginLeft: '4px',
        verticalAlign: 'middle',
    },
    punish: {
        fontFamily: vars.font.display,
        fontSize: '0.56rem',
        fontWeight: 600,
        color: '#ff5d5d',
        border: '1px solid #ff5d5d',
        borderRadius: vars.radius.sm,
        padding: '0 3px',
        marginLeft: '4px',
        verticalAlign: 'middle',
    },
    attention: {
        fontFamily: vars.font.display,
        fontSize: '0.56rem',
        fontWeight: 600,
        color: vars.color.amber,
        border: `1px solid ${vars.color.amber}`,
        borderRadius: vars.radius.sm,
        padding: '0 3px',
        marginLeft: '4px',
        verticalAlign: 'middle',
    },
});
