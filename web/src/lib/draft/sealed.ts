import { canTake, playerPool, usableCopies } from './engine';
import { seeded } from './random';
import { isFull, type DraftContext, type DraftState } from './types';

export const SEALED_SIZE = 60;
export const BOOSTER_SIZE = 10;
export const BOOSTER_COUNT = SEALED_SIZE / BOOSTER_SIZE;

export function openedBoosters(state: DraftState): number {
  return state.sealedOpened?.[state.current] ?? BOOSTER_COUNT;
}

export function isBuilding(state: DraftState): boolean {
  return state.sealedBuilding?.[state.current] ?? true;
}

export function buildSealedDeck(state: DraftState): DraftState {
  if (state.phase !== 'pick' || state.settings.format !== 'sealed' || openedBoosters(state) < BOOSTER_COUNT) return state;
  return { ...state, sealedBuilding: state.players.map((_, i) => i === state.current || (state.sealedBuilding?.[i] ?? true)) };
}

export function openBooster(state: DraftState): DraftState {
  if (state.phase !== 'pick' || state.settings.format !== 'sealed' || openedBoosters(state) >= BOOSTER_COUNT) return state;
  return { ...state, sealedOpened: state.players.map((_, i) =>
    i === state.current ? openedBoosters(state) + 1 : state.sealedOpened?.[i] ?? BOOSTER_COUNT) };
}

export function openAllBoosters(state: DraftState): DraftState {
  let opened = state;
  for (let n = 0; n < BOOSTER_COUNT; n++) opened = openBooster(opened);
  return buildSealedDeck(opened);
}

/** Deal physical copies round-robin. Unselected cards stay reserved to their player. */
export function dealSealed(state: DraftState, context: DraftContext): DraftState {
  const stock = { ...state.stock };
  const pools: string[][] = state.players.map(() => []);
  const random = seeded(state.seed);
  const eligible = state.players.map((player) => playerPool(state, player, context)
    .filter((row) => canTake(player, row, context)));
  for (let round = 0; round < SEALED_SIZE; round++) {
    state.players.forEach((player, i) => {
      const pool = pools[i]!;
      const choices = eligible[i]!.flatMap((row) => {
        const held = pool.filter((code) => code === row.code).length;
        const available = Math.min(stock[row.code] ?? 0,
          usableCopies(player, row, Object.fromEntries(context.initialStock), context) - held);
        return Array.from({ length: Math.max(0, available) }, () => row.code);
      });
      const code = choices[Math.floor(random() * choices.length)];
      if (code !== undefined) {
        pool.push(code);
        stock[code] = (stock[code] ?? 0) - 1;
      }
    });
  }
  return { ...state, stock, sealedPools: pools, sealedOpened: state.players.map(() => 0), sealedBuilding: state.players.map(() => false), phase: 'pick', current: 0 };
}

export function selectSealed(state: DraftState, code: string, add: boolean, context: DraftContext): DraftState {
  const player = state.players[state.current];
  if (state.phase !== 'pick' || state.settings.format !== 'sealed' || player === undefined) return state;
  if (openedBoosters(state) < BOOSTER_COUNT || !isBuilding(state)) return state;
  const picks = [...player.picks];
  if (add) {
    const count = (state.sealedPools?.[state.current] ?? []).filter((c) => c === code).length;
    const row = context.pool.get(code);
    if (isFull(player) || count <= picks.filter((c) => c === code).length || row === undefined || !canTake(player, row, context)) return state;
    picks.push(code);
  } else {
    const at = picks.indexOf(code);
    if (at < 0) return state;
    picks.splice(at, 1);
  }
  return { ...state, players: state.players.map((p, i) => i === state.current ? { ...p, picks } : p) };
}
