import type { Permissions, PermPreset, Role, Token } from '../types';

export const PRESETS: Record<'trusting' | 'standard' | 'strict', Permissions> = {
  // Everyone at the table is a friend: players can do nearly everything.
  trusting: {
    playersMoveAnyToken: true,
    playersCreateTokens: true,
    playersDeleteAnyToken: true,
    playersPing: true,
    playersDraw: true,
    playersMeasure: true,
  },
  // Players move and edit only their own token, but may still make tokens, draw and measure.
  standard: {
    playersMoveAnyToken: false,
    playersCreateTokens: true,
    playersDeleteAnyToken: false,
    playersPing: true,
    playersDraw: true,
    playersMeasure: true,
  },
  // Players can only move their own token (assigned by you), ping and measure.
  strict: {
    playersMoveAnyToken: false,
    playersCreateTokens: false,
    playersDeleteAnyToken: false,
    playersPing: true,
    playersDraw: false,
    playersMeasure: true,
  },
};

export const PERM_LABELS: Record<keyof Permissions, { label: string; hint: string }> = {
  playersMoveAnyToken: { label: 'Move and edit any token', hint: 'Off: players can only touch the token they own.' },
  playersCreateTokens: { label: 'Create tokens', hint: 'Players can add their own tokens to the board.' },
  playersDeleteAnyToken: { label: 'Delete any token', hint: 'Off: players can only delete tokens they own.' },
  playersPing: { label: 'Ping the map', hint: 'Show everyone a spot on the map (middle click by default).' },
  playersDraw: { label: 'Draw and place spell templates', hint: 'Players can add, move and erase their own drawings.' },
  playersMeasure: { label: 'Use the ruler', hint: 'Measure distances on the map.' },
};

export function detectPreset(perm: Permissions): PermPreset {
  for (const name of ['trusting', 'standard', 'strict'] as const) {
    const p = PRESETS[name];
    if ((Object.keys(p) as (keyof Permissions)[]).every((k) => p[k] === perm[k])) return name;
  }
  return 'custom';
}

export type Action = 'move' | 'edit' | 'delete' | 'create' | 'claim' | 'ping' | 'draw' | 'measure';

export interface PermCtx {
  role: Role;
  uid: string;
  perm: Permissions;
  /** false when a player is somehow looking at a non-active scene */
  sceneActive: boolean;
}

/**
 * Single source of truth for "may this user do X". The UI uses it to enable/disable things;
 * database.rules.json mirrors the token move / create / delete / claim rules.
 */
export function can(ctx: PermCtx, action: Action, token?: Token): boolean {
  if (ctx.role === 'dm') return true;
  if (!ctx.sceneActive) return false;
  const own = !!token && token.ownerUid === ctx.uid;
  switch (action) {
    case 'ping': return ctx.perm.playersPing;
    case 'draw': return ctx.perm.playersDraw;
    case 'measure': return ctx.perm.playersMeasure;
    case 'create': return ctx.perm.playersCreateTokens;
    case 'claim': return !!token && token.ownerUid === null && !token.locked && !token.hidden;
    case 'move':
    case 'edit':
      return !!token && !token.locked && !token.hidden && (own || ctx.perm.playersMoveAnyToken);
    case 'delete':
      return !!token && !token.locked && !token.hidden && (own || ctx.perm.playersDeleteAnyToken);
  }
}
