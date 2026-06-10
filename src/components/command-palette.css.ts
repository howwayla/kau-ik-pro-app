// src/components/command-palette.css.ts

import { style } from '@vanilla-extract/css';
import { vars } from '../theme.css';

export const overlay = style({
    position: 'fixed',
    inset: 0,
    zIndex: 2000,
    background: 'rgba(0, 0, 0, 0.45)',
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingTop: '18vh',
});

export const box = style({
    width: '26rem',
    background: vars.color.panelRaised,
    border: `1px solid ${vars.color.borderBright}`,
    borderRadius: vars.radius.lg,
    boxShadow: '0 24px 64px rgba(0, 0, 0, 0.5)',
    overflow: 'hidden',
});

export const input = style({
    width: '100%',
    fontFamily: vars.font.mono,
    fontSize: '1rem',
    fontWeight: 600,
    color: vars.color.foreground,
    background: 'transparent',
    border: 'none',
    borderBottom: `1px solid ${vars.color.border}`,
    padding: `${vars.space.md} ${vars.space.lg}`,
    outline: 'none',
    textTransform: 'uppercase',
    '::placeholder': {
        color: vars.color.mutedForeground,
        textTransform: 'none',
        fontWeight: 400,
    },
});

export const hint = style({
    padding: `${vars.space.sm} ${vars.space.lg}`,
    fontSize: '0.68rem',
    color: vars.color.mutedForeground,
    display: 'flex',
    justifyContent: 'space-between',
});

export const err = style({
    color: vars.color.danger,
});
