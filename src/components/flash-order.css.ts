// src/components/flash-order.css.ts

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

export const qtyInput = style({
    width: '3.4rem',
    fontFamily: vars.font.mono,
    fontSize: '0.78rem',
    fontWeight: 600,
    textAlign: 'right',
    color: vars.color.foreground,
    background: vars.color.inset,
    border: `1px solid ${vars.color.border}`,
    borderRadius: vars.radius.sm,
    padding: '2px 6px',
    outline: 'none',
    ':focus': { borderColor: vars.color.accent },
});

export const qtyLabel = style({
    fontSize: '0.64rem',
    color: vars.color.mutedForeground,
});

const armBase = style({
    flex: 1,
    fontFamily: vars.font.display,
    fontSize: '0.66rem',
    fontWeight: 700,
    padding: '3px 0',
    cursor: 'pointer',
    borderRadius: vars.radius.sm,
    border: '1px solid',
    transition: 'all 0.12s',
});

export const armBtn = styleVariants({
    off: [
        armBase,
        {
            color: vars.color.mutedForeground,
            borderColor: vars.color.border,
            background: vars.color.inset,
        },
    ],
    on: [
        armBase,
        {
            color: '#1a1304',
            borderColor: vars.color.amber,
            background: vars.color.amber,
            animation: 'pulse-glow 1.4s infinite',
        },
    ],
});

export const recenterBtn = style({
    fontFamily: vars.font.body,
    fontSize: '0.64rem',
    color: vars.color.mutedForeground,
    background: 'transparent',
    border: `1px solid ${vars.color.border}`,
    borderRadius: vars.radius.sm,
    padding: '2px 8px',
    cursor: 'pointer',
    ':hover': { color: vars.color.foreground },
});

export const ladder = style({
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    fontFamily: vars.font.mono,
    fontSize: '0.72rem',
    fontVariantNumeric: 'tabular-nums',
});

export const headRow = style({
    display: 'grid',
    gridTemplateColumns: '1fr 5rem 1fr',
    fontFamily: vars.font.display,
    fontSize: '0.6rem',
    fontWeight: 600,
    color: vars.color.mutedForeground,
    textAlign: 'center',
    padding: '3px 0',
    borderBottom: `1px solid ${vars.color.border}`,
    position: 'sticky',
    top: 0,
    background: vars.color.panel,
    zIndex: 1,
});

const rowBase = style({
    display: 'grid',
    gridTemplateColumns: '1fr 5rem 1fr',
    height: '22px',
    alignItems: 'stretch',
    borderBottom: `1px solid rgba(127, 127, 127, 0.07)`,
});

export const row = styleVariants({
    normal: [rowBase],
    last: [
        rowBase,
        {
            background: vars.color.accentDim,
        },
    ],
});

const cellBase = style({
    display: 'flex',
    alignItems: 'center',
    position: 'relative',
    overflow: 'hidden',
});

export const buyCell = style([
    cellBase,
    {
        justifyContent: 'flex-end',
        paddingRight: '8px',
        cursor: 'pointer',
        color: vars.color.up,
        selectors: {
            '&:hover': { background: vars.color.upDim },
        },
    },
]);

export const sellCell = style([
    cellBase,
    {
        justifyContent: 'flex-start',
        paddingLeft: '8px',
        cursor: 'pointer',
        color: vars.color.down,
        selectors: {
            '&:hover': { background: vars.color.downDim },
        },
    },
]);

export const disabledCell = style({
    cursor: 'not-allowed',
    opacity: 0.55,
});

export const priceCell = style([
    cellBase,
    {
        justifyContent: 'center',
        fontWeight: 600,
        borderLeft: `1px solid ${vars.color.border}`,
        borderRight: `1px solid ${vars.color.border}`,
    },
]);

export const volBar = style({
    position: 'absolute',
    top: '3px',
    bottom: '3px',
    zIndex: 0,
    borderRadius: '2px',
});

export const cellText = style({
    position: 'relative',
    zIndex: 1,
});

export const lastTag = style({
    fontSize: '0.58rem',
    padding: '0 4px',
    borderRadius: '2px',
    marginLeft: '4px',
});

export const hint = style({
    padding: `2px ${vars.space.sm}`,
    fontSize: '0.6rem',
    color: vars.color.mutedForeground,
    borderTop: `1px solid ${vars.color.border}`,
    flexShrink: 0,
    textAlign: 'center',
});
