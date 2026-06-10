// src/components/tick-tape.css.ts

import { style } from '@vanilla-extract/css';
import { vars } from '../theme.css';

export const tape = style({
    fontFamily: vars.font.mono,
    fontSize: '0.7rem',
    fontVariantNumeric: 'tabular-nums',
    display: 'flex',
    flexDirection: 'column',
});

export const tapeRow = style({
    display: 'grid',
    gridTemplateColumns: '7.6rem 1fr 3.4rem',
    columnGap: vars.space.sm,
    padding: `2px ${vars.space.sm}`,
    borderBottom: `1px solid rgba(34, 43, 55, 0.45)`,
});

export const time = style({
    color: vars.color.mutedForeground,
});

export const vol = style({
    textAlign: 'right',
    color: vars.color.mutedForeground,
});
