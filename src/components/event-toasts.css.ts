// src/components/event-toasts.css.ts

import { keyframes, style } from '@vanilla-extract/css';
import { vars } from '../theme.css';

const slideIn = keyframes({
    from: { transform: 'translateX(110%)', opacity: 0 },
    to: { transform: 'translateX(0)', opacity: 1 },
});

export const stack = style({
    position: 'fixed',
    top: '52px',
    right: vars.space.md,
    display: 'flex',
    flexDirection: 'column',
    gap: vars.space.sm,
    zIndex: 1000,
    width: '20rem',
    pointerEvents: 'none',
});

export const toast = style({
    fontFamily: vars.font.mono,
    fontSize: '0.72rem',
    padding: `${vars.space.sm} ${vars.space.md}`,
    background: vars.color.panelRaised,
    border: `1px solid ${vars.color.borderBright}`,
    borderLeft: `3px solid ${vars.color.accent}`,
    borderRadius: vars.radius.sm,
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.45)',
    animation: `${slideIn} 0.22s ease-out`,
});

export const toastTitle = style({
    fontFamily: vars.font.display,
    fontSize: '0.66rem',
    fontWeight: 600,
    letterSpacing: '0.04em',
    color: vars.color.accent,
    marginBottom: '2px',
});
