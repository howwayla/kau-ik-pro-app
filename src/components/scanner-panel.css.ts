// src/components/scanner-panel.css.ts

import { style, styleVariants } from '@vanilla-extract/css';
import { vars } from '../theme.css';

export const switcher = style({
    display: 'flex',
    gap: '2px',
    padding: `4px ${vars.space.sm}`,
    borderBottom: `1px solid ${vars.color.border}`,
    flexShrink: 0,
});

const swBase = style({
    flex: 1,
    fontFamily: vars.font.body,
    fontSize: '0.66rem',
    fontWeight: 500,
    padding: '3px 0',
    cursor: 'pointer',
    background: 'transparent',
    border: '1px solid transparent',
    borderRadius: vars.radius.sm,
    color: vars.color.mutedForeground,
});

export const sw = styleVariants({
    off: [swBase, { ':hover': { color: vars.color.foreground } }],
    on: [
        swBase,
        {
            color: vars.color.foreground,
            background: vars.color.muted,
            fontWeight: 600,
        },
    ],
});

export const row = style({
    display: 'grid',
    gridTemplateColumns: '1.4rem 3.4rem 1fr auto',
    alignItems: 'center',
    columnGap: vars.space.xs,
    padding: `3px ${vars.space.sm}`,
    fontFamily: vars.font.mono,
    fontSize: '0.7rem',
    fontVariantNumeric: 'tabular-nums',
    cursor: 'pointer',
    borderBottom: `1px solid rgba(34, 43, 55, 0.45)`,
    ':hover': { background: vars.color.muted },
});

export const rank = style({
    color: vars.color.mutedForeground,
    fontSize: '0.64rem',
    fontWeight: 600,
});

export const scName = style({
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: vars.color.mutedForeground,
    fontFamily: vars.font.body,
    fontSize: '0.66rem',
});

export const scValue = style({
    textAlign: 'right',
    fontWeight: 600,
});
