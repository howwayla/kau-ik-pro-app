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

export const symbolCell = style({
    gridColumn: '1',
    gridRow: '1 / span 2',
});

export const price = style({
    fontFamily: vars.font.mono,
    fontSize: '0.82rem',
    fontWeight: 600,
    textAlign: 'right',
    fontVariantNumeric: 'tabular-nums',
});

/** 觸及漲/跌停：價格填滿底色反白（仿富果 app） */
export const priceLimit = styleVariants({
    up: {
        background: vars.color.up,
        color: '#fff',
        borderRadius: vars.radius.sm,
        padding: '0 4px',
    },
    down: {
        background: vars.color.down,
        color: '#fff',
        borderRadius: vars.radius.sm,
        padding: '0 4px',
    },
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

export const typeSelect = style({
    fontFamily: vars.font.body,
    fontSize: '0.72rem',
    color: vars.color.foreground,
    background: vars.color.inset,
    border: `1px solid ${vars.color.border}`,
    borderRadius: vars.radius.sm,
    outline: 'none',
});
