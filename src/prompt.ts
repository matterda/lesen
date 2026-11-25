// Prompt and request shape for a lookup. Kept free of browser APIs so evals can run it in Node.
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

// Field order is the order the model writes them in: the gloss comes first so a streamed answer shows it at once.
export const LookupSchema = z.object({
  translation: z.string(),
  lemma: z.string(),
  part_of_speech: z.string(),
  grammar: z.string(),
  explanation: z.string(),
  other_meanings: z.array(z.string()),
  sentence_translation: z.string(),
});

export const SYSTEM = `You help an English-speaking learner read a German book. The learner selects a word or phrase inside a sentence (when it was a single tap, the exact occurrence is wrapped in ⟦ ⟧); you explain what it means *in this exact context*, not in general.

Rules:
- "translation": the English meaning that fits this sentence, as short as a dictionary gloss (1-6 words). If the selection is part of something larger, translate the larger unit: a separable verb whose particle sits elsewhere in the sentence ("kommt ... an"), a reflexive verb, a fixed expression or idiom, a verb + preposition pairing. Give verbs in the English infinitive with "to", whatever the German form ("hatte" -> "to have", "kommt ... an" -> "to arrive"); a qualifier stays in brackets ("to have (to experience)").
- "lemma": the form a learner should memorise. Nouns with article and plural ("der Bahnhof, -höfe"), verbs as infinitive including the separable prefix or "sich" ("ankommen", "sich erinnern an + Akk."), adjectives/adverbs in base form, idioms in their citation form. For a multi-word selection, the citation form of the phrase.
- "part_of_speech": e.g. "noun", "verb (separable)", "adjective", "idiom".
- "grammar": the form as it appears here, briefly (e.g. "Präteritum, 3rd sg.", "dative plural", "Konjunktiv II"). Empty string if not useful.
- "explanation": one or two short sentences, only when the context changes the usual meaning, there is a trap (false friend, separable particle far away, idiom, archaic or regional use), or nuance matters. Otherwise an empty string.
- "other_meanings": up to 3 other common meanings of the lemma, short. Verbs as "to ..." infinitives too ("to have (to possess)"). Empty if none worth noting.
- "sentence_translation": a natural, faithful English translation of the whole sentence, using the surrounding passage to resolve pronouns and references.`;

export interface LookupRequest {
  selection: string;
  sentence: string;
  marked?: string; // sentence with the tapped occurrence wrapped in ⟦ ⟧
  context: string; // surrounding passage
  bookTitle?: string;
}

export function lookupParams(model: string, req: LookupRequest) {
  const prompt = [
    req.bookTitle ? `Book: ${req.bookTitle}` : "",
    `<passage>\n${req.context}\n</passage>`,
    `<sentence>${req.marked || req.sentence}</sentence>`,
    `<selection>${req.selection}</selection>`,
  ]
    .filter(Boolean)
    .join("\n\n");
  // Haiku has no server-side refusal fallback; Opus/Sonnet re-run on a fallback model if declined.
  const fallback = model.startsWith("claude-haiku")
    ? {}
    : { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const };
  return {
    model,
    max_tokens: 4000,
    system: SYSTEM,
    output_config: { effort: "low" as const, format: betaZodOutputFormat(LookupSchema) },
    messages: [{ role: "user" as const, content: prompt }],
    ...fallback,
  };
}
