import { style, styleVariants } from '@vanilla-extract/css';
import { vars } from '../theme.css';

export const root = style({
    display: 'grid',
    gap: '1px',
    minWidth: 0,
});

export const codeLine = style({
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    minWidth: 0,
});

export const code = style({
    fontFamily: vars.font.mono,
    fontSize: '0.8rem',
    fontWeight: 600,
    color: vars.color.foreground,
});

export const name = style({
    fontSize: '0.68rem',
    color: vars.color.mutedForeground,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
});

const badgeBase = style({
    fontFamily: vars.font.display,
    fontSize: '0.56rem',
    fontWeight: 600,
    borderRadius: vars.radius.sm,
    padding: '0 3px',
    lineHeight: 1.25,
});

export const badge = styleVariants({
    trial: [
        badgeBase,
        { color: vars.color.amber, border: `1px solid ${vars.color.amber}` },
    ],
    punish: [badgeBase, { color: '#ff5d5d', border: '1px solid #ff5d5d' }],
    attention: [
        badgeBase,
        { color: vars.color.amber, border: `1px solid ${vars.color.amber}` },
    ],
});
