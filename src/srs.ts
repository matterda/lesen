import { createEmptyCard, fsrs, Rating, type Grade } from "ts-fsrs";
import { cardsByLemma, putCard, uid, type Flashcard, type Lookup } from "./db";

const scheduler = fsrs({ enable_fuzz: true, maximum_interval: 365 * 3 });

export async function addCard(l: Lookup, selection: string, sentence: string, bookTitle?: string) {
  const card: Flashcard = {
    id: uid(),
    lemma: l.lemma,
    selection,
    sentence,
    lookup: l,
    bookTitle,
    createdAt: Date.now(),
    fsrs: createEmptyCard(new Date()),
  };
  await putCard(card);
  return card;
}

export const hasCard = async (lemma: string) => (await cardsByLemma(lemma)).length > 0;

export const GRADES: { grade: Grade; label: string; key: string }[] = [
  { grade: Rating.Again, label: "Again", key: "1" },
  { grade: Rating.Hard, label: "Hard", key: "2" },
  { grade: Rating.Good, label: "Good", key: "3" },
  { grade: Rating.Easy, label: "Easy", key: "4" },
];

export function preview(card: Flashcard, now = new Date()) {
  const p = scheduler.repeat(card.fsrs, now);
  return Object.fromEntries(GRADES.map(({ grade }) => [grade, formatInterval(p[grade].card.due, now)]));
}

export async function grade(card: Flashcard, g: Grade) {
  card.fsrs = scheduler.next(card.fsrs, new Date(), g).card;
  await putCard(card);
}

function formatInterval(due: Date, now: Date) {
  const m = (due.getTime() - now.getTime()) / 60000;
  if (m < 60) return `${Math.max(1, Math.round(m))}m`;
  if (m < 60 * 24) return `${Math.round(m / 60)}h`;
  const d = m / 60 / 24;
  if (d < 30) return `${Math.round(d)}d`;
  if (d < 365) return `${Math.round(d / 30)}mo`;
  return `${(d / 365).toFixed(1)}y`;
}
