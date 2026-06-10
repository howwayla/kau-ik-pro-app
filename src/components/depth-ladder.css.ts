// src/components/depth-ladder.css.ts

import { style } from '@vanilla-extract/css';
import { vars } from '../theme.css';

export const grid = style({
    display: 'flex',
    flexDirection: 'column',
    padding: vars.space.sm,
    gap: '2px',
    fontFamily: vars.font.mono,
    fontSize: '0.74rem',
    fontVariantNumeric: 'tabular-nums',
});

export const ladderRow = style({
    display: 'grid',
    gridTemplateColumns: '3.2rem 1fr 1fr 3.2rem',
    alignItems: 'center',
    columnGap: vars.space.xs,
    height: '22px',
    cursor: 'pointer',
    borderRadius: vars.radius.sm,
    transition: 'background 0.1s',
    ':hover': { background: vars.color.muted },
});

export const volText = style({
    color: vars.color.mutedForeground,
    fontSize: '0.68rem',
});

export const volTextRight = style([volText, { textAlign: 'right' }]);

export const barTrack = style({
    position: 'relative',
    height: '16px',
    display: 'flex',
    alignItems: 'center',
    overflow: 'hidden',
    borderRadius: '2px',
});

export const bidBar = style({
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    background: vars.color.upDim,
    borderRight: `2px solid ${vars.color.up}`,
    transition: 'width 0.2s ease-out',
});

export const askBar = style({
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    background: vars.color.downDim,
    borderLeft: `2px solid ${vars.color.down}`,
    transition: 'width 0.2s ease-out',
});

export const priceBid = style({
    position: 'relative',
    zIndex: 1,
    width: '100%',
    textAlign: 'right',
    paddingRight: '6px',
    color: vars.color.up,
    fontWeight: 600,
});

export const priceAsk = style({
    position: 'relative',
    zIndex: 1,
    width: '100%',
    textAlign: 'left',
    paddingLeft: '6px',
    color: vars.color.down,
    fontWeight: 600,
});

export const headerRow = style({
    display: 'grid',
    gridTemplateColumns: '3.2rem 1fr 1fr 3.2rem',
    columnGap: vars.space.xs,
    fontFamily: vars.font.display,
    fontSize: '0.6rem',
    fontWeight: 500,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: vars.color.mutedForeground,
    padding: '2px 0',
});

export const totals = style({
    display: 'flex',
    justifyContent: 'space-between',
    padding: `4px 2px 0`,
    fontSize: '0.66rem',
    color: vars.color.mutedForeground,
    borderTop: `1px solid ${vars.color.border}`,
    marginTop: '2px',
});
