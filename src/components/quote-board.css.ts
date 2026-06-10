// src/components/quote-board.css.ts

import { style, styleVariants } from '@vanilla-extract/css';
import { vars } from '../theme.css';

export const board = style({
    display: 'flex',
    alignItems: 'center',
    gap: vars.space.lg,
    padding: `${vars.space.sm} ${vars.space.md}`,
    flexShrink: 0,
    borderBottom: `1px solid ${vars.color.border}`,
    overflow: 'hidden',
});

export const symbolBlock = style({
    display: 'flex',
    flexDirection: 'column',
    minWidth: '7rem',
});

export const symbolCode = style({
    fontFamily: vars.font.display,
    fontSize: '1.15rem',
    fontWeight: 700,
    letterSpacing: '0.01em',
    color: vars.color.foreground,
});

export const symbolName = style({
    fontSize: '0.72rem',
    color: vars.color.mutedForeground,
    whiteSpace: 'nowrap',
});

const bigPriceBase = style({
    fontFamily: vars.font.mono,
    fontSize: '1.9rem',
    fontWeight: 600,
    lineHeight: 1,
    fontVariantNumeric: 'tabular-nums',
});

export const bigPrice = styleVariants({
    up: [bigPriceBase, { color: vars.color.up }],
    down: [bigPriceBase, { color: vars.color.down }],
    flat: [bigPriceBase, { color: vars.color.flat }],
});

export const changeBlock = style({
    display: 'flex',
    flexDirection: 'column',
    fontFamily: vars.font.mono,
    fontSize: '0.82rem',
    fontVariantNumeric: 'tabular-nums',
});

export const statGrid = style({
    display: 'grid',
    gridTemplateColumns: 'repeat(4, auto)',
    columnGap: vars.space.lg,
    rowGap: '2px',
    marginLeft: 'auto',
    fontFamily: vars.font.mono,
    fontSize: '0.72rem',
    fontVariantNumeric: 'tabular-nums',
});

export const statLabel = style({
    fontFamily: vars.font.display,
    color: vars.color.mutedForeground,
    fontSize: '0.62rem',
    fontWeight: 500,
});

export const statValue = style({
    textAlign: 'right',
});
