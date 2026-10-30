import {
  createEmptyCard,
  fsrs,
  type Card,
  type CardInput,
  type Grade,
} from "ts-fsrs";

export const ENGINE = "fsrs-6/ts-fsrs-5.4.2";
export const RATINGS = ["Again", "Hard", "Good", "Easy"] as const;
export type Assessment = (typeof RATINGS)[number];
const scheduler = fsrs({
  request_retention: 0.9,
  enable_fuzz: false,
  learning_steps: ["1m", "10m"],
  relearning_steps: ["10m"],
});

export function schedule(
  previous: string | null,
  assessment: Assessment,
  now: Date,
): Card {
  const index = RATINGS.indexOf(assessment);
  if (index < 0) throw new Error("Unknown assessment.");
  const card: CardInput = previous
    ? JSON.parse(previous)
    : createEmptyCard(now);
  return scheduler.next(card, now, (index + 1) as Grade).card;
}

export function preview(
  previous: string | null,
  now: Date,
): Record<Assessment, string> {
  return Object.fromEntries(
    RATINGS.map((rating) => [
      rating,
      schedule(previous, rating, now).due.toISOString(),
    ]),
  ) as Record<Assessment, string>;
}

/** Probability of successful recall, not of a particular answer-button rating. */
export function recallProbability(previous: string | null, at: Date): number {
  if (!previous) return 0;
  const card = JSON.parse(previous) as CardInput;
  if (!card.last_review) return 0;
  const value = scheduler.get_retrievability(card, at, false);
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}
