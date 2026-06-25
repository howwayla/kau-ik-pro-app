// src/components/depth-map.css.ts

import { style } from '@vanilla-extract/css';
import { vars } from '../theme.css';

export const wrap = style({
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
    height: '100%',
});

export const plot = style({
    position: 'relative',
    flex: 1,
    minHeight: 0,
});

export const canvas = style({
    width: '100%',
    height: '100%',
    display: 'block',
    cursor: 'crosshair',
});

export const readout = style({
    position: 'absolute',
    right: 56, // sit left of the price axis gutter
    display: 'flex',
    gap: vars.space.xs,
    alignItems: 'center',
    padding: '1px 6px',
    background: vars.color.inset,
    border: `1px solid ${vars.color.border}`,
    borderRadius: vars.radius.sm,
    fontFamily: vars.font.mono,
    fontSize: '0.62rem',
    whiteSpace: 'nowrap',
    pointerEvents: 'none',
    transform: 'translateY(-50%)',
});

export const readoutPrice = style({
    color: vars.color.foreground,
    fontWeight: 600,
});

export const readoutAsk = style({
    color: vars.color.down,
});

export const readoutBid = style({
    color: vars.color.up,
});

export const hint = style({
    padding: `2px ${vars.space.sm}`,
    fontSize: '0.6rem',
    color: vars.color.mutedForeground,
    borderTop: `1px solid ${vars.color.border}`,
    flexShrink: 0,
    textAlign: 'center',
});
