/**
 * Portfolio summary (UX-03, WF-01).
 *
 * - Counts unique players and individual cards separately: "3 spelers · 6 kaarten".
 * - Cost basis follows the specific cards still held (specific identification).
 * - Reference total sums published reference values; cards of players without
 *   a published reference are excluded and reported, never counted as €0.
 * - The highest bid is a price per card, never an executable value for the
 *   whole position.
 * - No return based on a fictitious sale. Realised result only on actual sales:
 *   proceeds − commission − cost of the specific card sold.
 */
import { cents, sub, sum, type Cents } from "./money.ts";

export type HeldCard = {
  readonly cardId: string;
  readonly playerId: string;
  readonly costCents: Cents;
  readonly reservedForSale: boolean;
};

export type PlayerPosition = {
  readonly playerId: string;
  readonly quantity: number;
  readonly availableForSale: number;
  readonly reserved: number;
  readonly averageCost: Cents;
  readonly totalCost: Cents;
  readonly totalReference: Cents | null;
  readonly highestBidPerCard: Cents | null;
};

export type PortfolioSummary = {
  readonly playerCount: number;
  readonly cardCount: number;
  readonly label: string;
  readonly totalCost: Cents;
  readonly totalReference: Cents;
  readonly cardsWithoutReference: number;
  readonly positions: readonly PlayerPosition[];
};

export function countLabel(players: number, cards: number): string {
  const p = players === 1 ? "speler" : "spelers";
  const c = cards === 1 ? "kaart" : "kaarten";
  return `${players} ${p} · ${cards} ${c}`;
}

export function summarizePortfolio(
  cards: readonly HeldCard[],
  referenceByPlayer: ReadonlyMap<string, Cents>,
  highestBidByPlayer: ReadonlyMap<string, Cents> = new Map(),
): PortfolioSummary {
  const byPlayer = new Map<string, HeldCard[]>();
  for (const c of cards) {
    const list = byPlayer.get(c.playerId) ?? [];
    list.push(c);
    byPlayer.set(c.playerId, list);
  }

  const positions: PlayerPosition[] = [...byPlayer.entries()].map(([playerId, list]) => {
    const totalCost = sum(list.map((c) => c.costCents));
    const reserved = list.filter((c) => c.reservedForSale).length;
    const ref = referenceByPlayer.get(playerId);
    return {
      playerId,
      quantity: list.length,
      availableForSale: list.length - reserved,
      reserved,
      // Display average, rounded half up to the cent; totals stay exact.
      averageCost: cents(Math.floor((totalCost * 2 + list.length) / (2 * list.length))),
      totalCost,
      totalReference: ref === undefined ? null : cents(ref * list.length),
      highestBidPerCard: highestBidByPlayer.get(playerId) ?? null,
    };
  });

  const withRef = positions.filter((p) => p.totalReference !== null);
  return {
    playerCount: positions.length,
    cardCount: cards.length,
    label: countLabel(positions.length, cards.length),
    totalCost: sum(positions.map((p) => p.totalCost)),
    totalReference: sum(withRef.map((p) => p.totalReference as Cents)),
    cardsWithoutReference: positions.filter((p) => p.totalReference === null).reduce((n, p) => n + p.quantity, 0),
    positions,
  };
}

/** Realised result on one actually settled sale of a specific card. */
export function realisedResult(proceeds: Cents, commission: Cents, cardCost: Cents): Cents {
  return sub(sub(proceeds, commission), cardCost);
}

