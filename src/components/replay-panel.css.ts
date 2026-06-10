// src/components/replay-panel.css.ts

import { style, styleVariants } from '@vanilla-extract/css';
import { vars } from '../theme.css';

export const wrap = style({
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
    height: '100%',
});

export const controls = style({
    display: 'flex',
    alignItems: 'center',
    gap: vars.space.xs,
    padding: `4px ${vars.space.sm}`,
    borderBottom: `1px solid ${vars.color.border}`,
    flexShrink: 0,
});

export const playBtn = style({
    fontFamily: vars.font.body,
    fontSize: '0.7rem',
    fontWeight: 600,
    padding: '2px 10px',
    cursor: 'pointer',
    background: vars.color.accentDim,
    border: `1px solid ${vars.color.accent}`,
    borderRadius: vars.radius.sm,
    color: vars.color.accent,
    ':disabled': { opacity: 0.4, cursor: 'not-allowed' },
});

const speedBase = style({
    fontFamily: vars.font.mono,
    fontSize: '0.66rem',
    padding: '2px 7px',
    cursor: 'pointer',
    background: 'transparent',
    border: '1px solid transparent',
    borderRadius: vars.radius.sm,
    color: vars.color.mutedForeground,
});

export const speed = styleVariants({
    off: [speedBase, { ':hover': { color: vars.color.foreground } }],
    on: [
        speedBase,
        { color: vars.color.foreground, background: vars.color.muted },
    ],
});

export const seek = style({
    flex: 1,
    minWidth: 0,
    accentColor: vars.color.accent,
});

export const status = style({
    fontFamily: vars.font.mono,
    fontSize: '0.66rem',
    color: vars.color.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
});

export const chartHost = style({
    flex: 1,
    minHeight: 0,
});
