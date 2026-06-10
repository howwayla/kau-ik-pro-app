// src/components/vol-profile.css.ts

import { style } from '@vanilla-extract/css';
import { vars } from '../theme.css';

export const wrap = style({
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
    height: '100%',
});

export const ratioRow = style({
    display: 'flex',
    alignItems: 'center',
    gap: vars.space.sm,
    padding: `6px ${vars.space.md}`,
    fontFamily: vars.font.mono,
    fontSize: '0.68rem',
    fontVariantNumeric: 'tabular-nums',
    borderBottom: `1px solid ${vars.color.border}`,
    flexShrink: 0,
});

export const ratioTrack = style({
    flex: 1,
    height: '6px',
    background: vars.color.downDim,
    borderRadius: '3px',
    overflow: 'hidden',
});

export const ratioBuy = style({
    height: '100%',
    background: vars.color.up,
    opacity: 0.75,
    transition: 'width 0.3s',
});

export const list = style({
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    padding: `4px ${vars.space.sm}`,
});

export const row = style({
    display: 'grid',
    gridTemplateColumns: '4.4rem 1fr 3.6rem',
    alignItems: 'center',
    columnGap: vars.space.xs,
    height: '18px',
    fontFamily: vars.font.mono,
    fontSize: '0.66rem',
    fontVariantNumeric: 'tabular-nums',
});

export const price = style({
    textAlign: 'right',
    color: vars.color.foreground,
});

export const barTrack = style({
    display: 'flex',
    height: '10px',
    borderRadius: '2px',
    overflow: 'hidden',
});

export const barBuy = style({
    background: vars.color.up,
    opacity: 0.55,
});

export const barSell = style({
    background: vars.color.down,
    opacity: 0.55,
});

export const vol = style({
    textAlign: 'right',
    color: vars.color.mutedForeground,
});
