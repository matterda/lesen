import { openDB, type DBSchema } from "idb";
import type { Card as FsrsCard } from "ts-fsrs";

export interface Chapter {
  title: string;
  paragraphs: string[];
}

export interface Book {
  id: string;
  title: string;
  author?: string;
  addedAt: number;
  chapters: Chapter[];
}

export interface BookMeta {
  id: string;
  title: string;
  author?: string;
  addedAt: number;
  chapterCount: number;
  wordCount: number;
}

export interface Progress {
  bookId: string;
  chapter: number;
  paragraph: number;
  updatedAt: number;
}

export interface Lookup {
  lemma: string;
  part_of_speech: string;
  grammar: string;
  translation: string;
  explanation: string;
  other_meanings: string[];
  sentence_translation: string;
}

export interface Flashcard {
  id: string;
  lemma: string;
  selection: string;
  sentence: string;
  lookup: Lookup;
  bookTitle?: string;
  createdAt: number;
  fsrs: FsrsCard;
}

interface Schema extends DBSchema {
  books: { key: string; value: Book };
  bookMeta: { key: string; value: BookMeta };
  progress: { key: string; value: Progress };
  lookups: { key: string; value: { key: string; lookup: Lookup; at: number } };
  cards: { key: string; value: Flashcard; indexes: { due: number; lemma: string } };
}

const dbp = openDB<Schema>("lesen", 1, {
  upgrade(db) {
    db.createObjectStore("books", { keyPath: "id" });
    db.createObjectStore("bookMeta", { keyPath: "id" });
    db.createObjectStore("progress", { keyPath: "bookId" });
    db.createObjectStore("lookups", { keyPath: "key" });
    const cards = db.createObjectStore("cards", { keyPath: "id" });
    cards.createIndex("due", "fsrs.due");
    cards.createIndex("lemma", "lemma");
  },
});

export const uid = () => crypto.randomUUID();

// --- books
export async function saveBook(book: Book) {
  const db = await dbp;
  const wordCount = book.chapters.reduce(
    (n, c) => n + c.paragraphs.reduce((m, p) => m + p.split(/\s+/).length, 0),
    0,
  );
  const tx = db.transaction(["books", "bookMeta"], "readwrite");
  await tx.objectStore("books").put(book);
  await tx.objectStore("bookMeta").put({
    id: book.id,
    title: book.title,
    author: book.author,
    addedAt: book.addedAt,
    chapterCount: book.chapters.length,
    wordCount,
  });
  await tx.done;
}
export const listBooks = async () =>
  (await (await dbp).getAll("bookMeta")).sort((a, b) => b.addedAt - a.addedAt);
export const getBook = async (id: string) => (await dbp).get("books", id);
export async function deleteBook(id: string) {
  const db = await dbp;
  const tx = db.transaction(["books", "bookMeta", "progress"], "readwrite");
  await Promise.all([
    tx.objectStore("books").delete(id),
    tx.objectStore("bookMeta").delete(id),
    tx.objectStore("progress").delete(id),
  ]);
  await tx.done;
}

// --- progress
export const getProgress = async (bookId: string) => (await dbp).get("progress", bookId);
export const saveProgress = async (p: Progress) => (await dbp).put("progress", p);

// --- lookup cache
export const getCachedLookup = async (key: string) => (await dbp).get("lookups", key);
export const cacheLookup = async (key: string, lookup: Lookup) =>
  (await dbp).put("lookups", { key, lookup, at: Date.now() });

// --- cards
// FSRS dates are Date objects; IndexedDB stores them natively (structured clone).
export const putCard = async (c: Flashcard) => (await dbp).put("cards", c);
export const deleteCard = async (id: string) => (await dbp).delete("cards", id);
export const allCards = async () => (await dbp).getAll("cards");
export const cardsByLemma = async (lemma: string) =>
  (await dbp).getAllFromIndex("cards", "lemma", lemma);
export async function dueCards(now = new Date()) {
  const db = await dbp;
  return db.getAllFromIndex("cards", "due", IDBKeyRange.upperBound(now));
}

// --- backup
export async function exportAll() {
  const db = await dbp;
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    cards: await db.getAll("cards"),
    progress: await db.getAll("progress"),
  };
}
export async function importCards(cards: Flashcard[]) {
  const db = await dbp;
  const tx = db.transaction("cards", "readwrite");
  for (const c of cards) {
    // JSON round-trip turns dates into strings
    c.fsrs.due = new Date(c.fsrs.due);
    if (c.fsrs.last_review) c.fsrs.last_review = new Date(c.fsrs.last_review);
    await tx.store.put(c);
  }
  await tx.done;
}

// --- settings (small, per device)
export interface Settings {
  apiKey: string;
  model: string;
  fontSize: number;
}
const DEFAULTS: Settings = { apiKey: "", model: "claude-haiku-5-5", fontSize: 21 };
export function getSettings(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem("settings") || "{}") };
  } catch {
    return { ...DEFAULTS };
  }
}
export function saveSettings(s: Partial<Settings>) {
  localStorage.setItem("settings", JSON.stringify({ ...getSettings(), ...s }));
}
