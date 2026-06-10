// src/components/pnl-panel.css.ts

import { style } from '@vanilla-extract/css';
import { vars } from '../theme.css';

export const summary = style({
    display: 'flex',
    alignItems: 'center',
    gap: vars.space.lg,
    padding: `${vars.space.sm} ${vars.space.md}`,
    borderBottom: `1px solid ${vars.color.border}`,
});

export const bigStat = style({
    display: 'flex',
    flexDirection: 'column',
    flexShrink: 0,
});

export const bigLabel = style({
    fontSize: '0.64rem',
    color: vars.color.mutedForeground,
});

export const bigValue = style({
    fontFamily: vars.font.mono,
    fontSize: '1.4rem',
    fontWeight: 700,
    fontVariantNumeric: 'tabular-nums',
});

export const curve = style({
    flex: 1,
    height: '44px',
    minWidth: 0,
});

export const zeroLine = style({
    stroke: vars.color.border,
    strokeWidth: 1,
    strokeDasharray: '2 2',
});

export const curveUp = style({ stroke: vars.color.up });
export const curveDown = style({ stroke: vars.color.down });
