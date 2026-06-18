import { globalStyle, style, styleVariants } from '@vanilla-extract/css';
import { vars } from '../theme.css';

export const overlay = style({
    position: 'fixed',
    inset: 0,
    zIndex: 2100,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: vars.space.md,
    background: 'rgba(0, 0, 0, 0.48)',
});

export const dialog = style({
    width: 'min(36rem, 100%)',
    maxHeight: 'min(42rem, calc(100vh - 2rem))',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    background: vars.color.panelRaised,
    border: `1px solid ${vars.color.borderBright}`,
    borderRadius: vars.radius.lg,
    boxShadow: '0 24px 72px rgba(0, 0, 0, 0.5)',
});

export const header = style({
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: vars.space.md,
    padding: `${vars.space.md} ${vars.space.lg}`,
    borderBottom: `1px solid ${vars.color.border}`,
});

export const title = style({
    fontFamily: vars.font.display,
    fontSize: '0.95rem',
    fontWeight: 700,
    color: vars.color.foreground,
});

export const closeButton = style({
    width: '1.65rem',
    height: '1.65rem',
    flexShrink: 0,
    cursor: 'pointer',
    fontFamily: vars.font.mono,
    fontSize: '0.72rem',
    color: vars.color.mutedForeground,
    background: 'transparent',
    border: `1px solid ${vars.color.border}`,
    borderRadius: vars.radius.sm,
    ':hover': {
        color: vars.color.foreground,
        borderColor: vars.color.borderBright,
        background: vars.color.muted,
    },
});

export const steps = style({
    display: 'flex',
    flexWrap: 'wrap',
    gap: vars.space.xs,
    marginTop: vars.space.sm,
});

const stepBase = style({
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: '1.65rem',
    fontFamily: vars.font.display,
    fontSize: '0.66rem',
    fontWeight: 600,
    lineHeight: 1.25,
    padding: '3px 8px',
    borderRadius: vars.radius.sm,
    border: '1px solid',
});

export const step = styleVariants({
    on: [
        stepBase,
        {
            color: vars.color.accent,
            background: vars.color.accentDim,
            borderColor: vars.color.accent,
        },
    ],
    off: [
        stepBase,
        {
            color: vars.color.mutedForeground,
            background: vars.color.inset,
            borderColor: vars.color.border,
        },
    ],
});

export const body = style({
    flex: 1,
    minHeight: 0,
    overflow: 'auto',
    padding: vars.space.lg,
});

export const brokerGrid = style({
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: vars.space.sm,
    '@media': {
        '(max-width: 520px)': {
            gridTemplateColumns: '1fr',
        },
    },
});

export const brokerButton = style({
    display: 'flex',
    minWidth: 0,
    minHeight: '5.25rem',
    flexDirection: 'column',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: vars.space.sm,
    cursor: 'pointer',
    textAlign: 'left',
    color: vars.color.foreground,
    background: vars.color.inset,
    border: `1px solid ${vars.color.border}`,
    borderRadius: vars.radius.md,
    padding: vars.space.md,
    selectors: {
        '&[aria-pressed="true"]': {
            borderColor: vars.color.accent,
            background: vars.color.accentDim,
        },
        '&:hover': {
            borderColor: vars.color.borderBright,
        },
        '&[aria-pressed="true"]:hover': {
            borderColor: vars.color.accent,
        },
    },
});

globalStyle(`${brokerButton} strong`, {
    fontFamily: vars.font.display,
    fontSize: '0.9rem',
});

globalStyle(`${brokerButton} span`, {
    fontSize: '0.68rem',
    color: vars.color.mutedForeground,
    lineHeight: 1.35,
    whiteSpace: 'normal',
});

export const fieldGrid = style({
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: vars.space.md,
    '@media': {
        '(max-width: 620px)': {
            gridTemplateColumns: '1fr',
        },
    },
});

export const field = style({
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    gap: vars.space.xs,
});

export const label = style({
    fontFamily: vars.font.display,
    fontSize: '0.66rem',
    fontWeight: 600,
    color: vars.color.mutedForeground,
});

export const input = style({
    width: '100%',
    minWidth: 0,
    height: '34px',
    fontFamily: vars.font.body,
    fontSize: '0.78rem',
    color: vars.color.foreground,
    background: vars.color.inset,
    border: `1px solid ${vars.color.border}`,
    borderRadius: vars.radius.sm,
    padding: '7px 9px',
    outline: 'none',
    ':focus': {
        borderColor: vars.color.accent,
    },
    '::placeholder': {
        color: vars.color.mutedForeground,
    },
});

export const fileRow = style({
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) 5.6rem',
    gap: vars.space.xs,
});

export const secondaryButton = style({
    flexShrink: 0,
    minHeight: '32px',
    cursor: 'pointer',
    fontFamily: vars.font.display,
    fontSize: '0.72rem',
    fontWeight: 600,
    color: vars.color.mutedForeground,
    background: vars.color.inset,
    border: `1px solid ${vars.color.border}`,
    borderRadius: vars.radius.sm,
    padding: '7px 10px',
    whiteSpace: 'nowrap',
    ':hover': {
        color: vars.color.foreground,
        borderColor: vars.color.borderBright,
    },
    ':disabled': {
        cursor: 'not-allowed',
        opacity: 0.55,
    },
});

export const errorText = style({
    display: 'block',
    minHeight: '1rem',
    margin: 0,
    fontSize: '0.68rem',
    lineHeight: 1.35,
    color: vars.color.danger,
    wordBreak: 'break-word',
});

export const hint = style({
    display: 'block',
    margin: `${vars.space.md} 0 0`,
    fontSize: '0.7rem',
    lineHeight: 1.5,
    color: vars.color.mutedForeground,
});

export const summary = style({
    display: 'grid',
    gap: vars.space.sm,
    margin: 0,
    padding: vars.space.md,
    background: vars.color.inset,
    border: `1px solid ${vars.color.border}`,
    borderRadius: vars.radius.md,
});

globalStyle(`${summary} div`, {
    display: 'grid',
    gridTemplateColumns: '7rem minmax(0, 1fr)',
    gap: vars.space.md,
    alignItems: 'baseline',
});

globalStyle(`${summary} span`, {
    fontSize: '0.68rem',
    color: vars.color.mutedForeground,
});

globalStyle(`${summary} strong`, {
    minWidth: 0,
    overflowWrap: 'anywhere',
    fontSize: '0.78rem',
    color: vars.color.foreground,
});

export const footer = style({
    display: 'flex',
    justifyContent: 'flex-end',
    gap: vars.space.sm,
    padding: `${vars.space.md} ${vars.space.lg}`,
    borderTop: `1px solid ${vars.color.border}`,
});

export const primaryButton = style({
    minWidth: '7rem',
    minHeight: '32px',
    cursor: 'pointer',
    fontFamily: vars.font.display,
    fontSize: '0.74rem',
    fontWeight: 700,
    color: '#fff',
    background: vars.color.accent,
    border: `1px solid ${vars.color.accent}`,
    borderRadius: vars.radius.sm,
    padding: '8px 14px',
    whiteSpace: 'nowrap',
    ':hover': {
        filter: 'brightness(1.08)',
    },
    ':disabled': {
        cursor: 'not-allowed',
        opacity: 0.55,
    },
});
