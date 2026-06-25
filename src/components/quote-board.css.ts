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

export const addWatchBtn = style({
    marginTop: '3px',
    alignSelf: 'flex-start',
    fontFamily: vars.font.body,
    fontSize: '0.64rem',
    color: vars.color.accent,
    background: 'transparent',
    border: `1px solid ${vars.color.accent}`,
    borderRadius: vars.radius.sm,
    padding: '1px 6px',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    ':hover': {
        background: vars.color.accentDim,
    },
});

export const watchedTag = style({
    marginTop: '3px',
    alignSelf: 'flex-start',
    fontSize: '0.62rem',
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

// 試撮 indicator next to the big price
export const trialBadge = style({
    display: 'inline-block',
    marginLeft: '6px',
    verticalAlign: 'middle',
    fontFamily: vars.font.display,
    fontSize: '0.6rem',
    fontWeight: 600,
    color: vars.color.amber,
    border: `1px solid ${vars.color.amber}`,
    borderRadius: vars.radius.sm,
    padding: '1px 4px',
    lineHeight: 1.2,
});
