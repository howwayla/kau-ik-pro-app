// src/components/panel-chrome.css.ts

import { style, styleVariants } from '@vanilla-extract/css';
import { vars } from '../theme.css';

export const titleText = style({
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
});

export const spacer = style({ flex: 1 });

const pinBase = style({
    fontFamily: vars.font.body,
    fontSize: '0.6rem',
    fontWeight: 600,
    padding: '1px 7px',
    cursor: 'pointer',
    borderRadius: '999px',
    border: '1px solid',
    transition: 'all 0.12s',
    flexShrink: 0,
    textTransform: 'none',
    letterSpacing: 0,
});

export const pinBtn = styleVariants({
    linked: [
        pinBase,
        {
            color: vars.color.accent,
            borderColor: 'transparent',
            background: vars.color.accentDim,
            ':hover': { borderColor: vars.color.accent },
        },
    ],
    pinned: [
        pinBase,
        {
            color: vars.color.amber,
            borderColor: vars.color.amber,
            background: 'transparent',
        },
    ],
});

export const pinInput = style({
    width: '4.2rem',
    fontFamily: vars.font.mono,
    fontSize: '0.66rem',
    fontWeight: 600,
    color: vars.color.amber,
    background: vars.color.inset,
    border: `1px solid ${vars.color.border}`,
    borderRadius: vars.radius.sm,
    padding: '1px 6px',
    outline: 'none',
    textTransform: 'uppercase',
    ':focus': { borderColor: vars.color.amber },
});

export const closeBtn = style({
    fontFamily: vars.font.mono,
    fontSize: '0.7rem',
    lineHeight: 1,
    width: '18px',
    height: '18px',
    cursor: 'pointer',
    background: 'transparent',
    border: 'none',
    borderRadius: vars.radius.sm,
    color: vars.color.mutedForeground,
    flexShrink: 0,
    ':hover': {
        color: vars.color.danger,
        background: vars.color.muted,
    },
});
