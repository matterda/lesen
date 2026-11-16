// Run the app's exact lookup prompt on tricky cases across models.
// Usage: node --env-file-if-exists=.env.local --experimental-strip-types evals/compare.ts [model ...]
// Without ANTHROPIC_API_KEY it goes through Claude Code (`claude -p`) with the same system prompt,
// user message, JSON schema and effort; latency is then the API time reported by the CLI.
import Anthropic from "@anthropic-ai/sdk";
import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { LookupSchema, lookupParams } from "../src/prompt.ts";
import type { Lookup } from "../src/db.ts";

const USE_CLI = !process.env.ANTHROPIC_API_KEY;
const { $schema: _drop, ...schemaBody } = z.toJSONSchema(LookupSchema);
const SCHEMA = JSON.stringify(schemaBody);

function viaCli(p: ReturnType<typeof lookupParams>): Promise<{ o: Lookup | null; ms: number; out: number; stop: string }> {
  const args = ["-p", p.messages[0].content, "--model", p.model, "--effort", p.output_config.effort,
    "--system-prompt", p.system, "--json-schema", SCHEMA, "--tools", "", "--setting-sources", "",
    "--strict-mcp-config", "--no-session-persistence", "--output-format", "json"];
  return new Promise((resolve, reject) => {
    const child = execFile("claude", args, { maxBuffer: 1 << 24, timeout: 180000 }, (err, stdout) => {
      if (err) return reject(new Error((stdout || String(err)).slice(-400)));
      const d = JSON.parse(stdout);
      if (d.is_error) return reject(new Error(d.result));
      resolve({ o: d.structured_output ?? null, ms: d.duration_api_ms, out: d.usage.output_tokens, stop: d.stop_reason });
    });
    child.stdin?.end();
  });
}

interface Case {
  id: string;
  context: string;
  sentence: string; // with the tapped word in ⟦ ⟧, or plain for a phrase selection
  selection: string;
  lemma: RegExp; // what the learner should memorise
  translation: RegExp; // acceptable in-context gloss
  trap: string;
  bookTitle?: string;
}

const C = (id: string, trap: string, sentence: string, selection: string, lemma: RegExp, translation: RegExp, before = "", after = ""): Case => ({
  id, trap, sentence, selection, lemma, translation,
  context: [before, sentence.replace(/[⟦⟧]/g, ""), after].filter(Boolean).join("\n\n"),
});

const BASIC: Case[] = [
  C("vorstellen-sep", "separable particle at end", "Er ⟦stellte⟧ mir gestern Abend auf der Party seine neue Freundin vor.", "stellte", /vorstellen/i, /introduc/i),
  C("vorstellen-refl", "sich vorstellen = imagine", "Ich kann mir das beim besten Willen nicht ⟦vorstellen⟧.", "vorstellen", /vorstellen/i, /imagin/i),
  C("ankommen-auf", "es kommt auf … an = it depends", "Es ⟦kommt⟧ ganz darauf an, ob er morgen Zeit hat.", "kommt", /ankommen/i, /depend/i),
  C("schloss-lock", "Schloss: lock, not castle", "Er steckte den Schlüssel ins ⟦Schloss⟧, aber die Tür ging nicht auf.", "Schloss", /Schloss/i, /lock/i),
  C("schloss-castle", "Schloss: castle, not lock", "Vom Hügel aus sahen wir das alte ⟦Schloss⟧ mit seinen vier Türmen.", "Schloss", /Schloss/i, /castle|palace|château/i),
  C("gericht-dish", "Gericht: dish, not court", "Der Kellner empfahl uns das ⟦Gericht⟧ des Tages, Rinderbraten mit Klößen.", "Gericht", /Gericht/i, /dish|meal|course|special/i),
  C("eventuell", "false friend: possibly, not eventually", "Ich komme ⟦eventuell⟧ später noch vorbei, falls ich früher fertig bin.", "eventuell", /eventuell/i, /possibl|maybe|perhaps|might/i),
  C("schwein-gehabt", "idiom: Schwein haben = be lucky", "Da hast du aber ⟦Schwein⟧ gehabt, dass der Bus noch nicht weg war!", "Schwein", /Schwein haben/i, /luck/i),
  C("baeren", "phrase: jdm. einen Bären aufbinden", "Glaub ihm kein Wort, er hat dir einen Bären aufgebunden.", "einen Bären aufgebunden", /Bären aufbinden/i, /leg|fool|tall tale|hoax|kid|lie|trick|story/i),
  C("doch-particle", "modal particle doch", "Das ist ⟦doch⟧ nicht dein Ernst!", "doch", /doch/i, /surely|really|come on|can't|you can|but|after all|particle|emphas/i),
  C("verfahren", "sich verfahren = get lost driving", "Ohne Navi haben wir uns in der Altstadt völlig ⟦verfahren⟧.", "verfahren", /sich verfahren/i, /lost/i),
  C("umfahren", "umfahren (sep.) = knock down", "Der betrunkene Fahrer hat in der Nacht ein Verkehrsschild ⟦umgefahren⟧.", "umgefahren", /umfahren/i, /knock|ran over|run over|ran down|hit/i),
  C("bestehen", "bestehen = pass (exam), not consist", "Nach drei Versuchen hat sie die Führerscheinprüfung endlich ⟦bestanden⟧.", "bestanden", /bestehen/i, /pass/i),
  C("kafka-ungeziefer", "literary: Ungeziefer = vermin/bug", "Als Gregor Samsa eines Morgens aus unruhigen Träumen erwachte, fand er sich in seinem Bett zu einem ungeheueren ⟦Ungeziefer⟧ verwandelt.", "Ungeziefer", /Ungeziefer/i, /vermin|insect|bug|pest|creature/i),
  C("ansehen-far", "particle far away, Präteritum", "Sie ⟦sah⟧ ihn über den Rand ihrer Brille hinweg lange und völlig verständnislos an.", "sah", /ansehen|anschauen/i, /look|stare|gaz/i),
  C("sie-pronoun", "pronoun from previous sentence (die Katze -> it)", "⟦Sie⟧ war so müde, dass sie sofort einschlief.", "Sie", /sie/i, /^(it|the cat|she)\b/i,
    "Die Katze kam erst spät in der Nacht nach Hause."),
];

// Harry Potter style: invented words in the German translation, which should map to the
// canonical English terms. Sentences are written for this test, not quoted from the books.
const HP_BOOK = "Harry Potter und der Gefangene von Askaban";
const hp = (id: string, trap: string, sentence: string, selection: string, lemma: RegExp, translation: RegExp, before = "") =>
  ({ ...C(id, trap, sentence, selection, lemma, translation, before), bookTitle: HP_BOOK });
const HP: Case[] = [
  hp("hp-heuler", "Heuler = Howler (lit. 'howler/wailer')", "Als Ron den roten Umschlag öffnete, fing der ⟦Heuler⟧ sofort an, mit der Stimme seiner Mutter durch die Große Halle zu schreien.", "Heuler", /Heuler/i, /howler/i),
  hp("hp-schnatz", "Schnatz = Snitch (invented)", "Hoch über dem Spielfeld sah Harry plötzlich den goldenen ⟦Schnatz⟧ in der Sonne aufblitzen.", "Schnatz", /Schnatz/i, /snitch/i),
  hp("hp-sucher", "Sucher = Seeker (Quidditch role), not 'searcher'", "Wood schärfte ihm ein, dass ein ⟦Sucher⟧ nur eine einzige Aufgabe habe: den Schnatz zu fangen, bevor es der Gegner tut.", "Sucher", /Sucher/i, /seeker/i),
  hp("hp-verwandlung", "Verwandlung = Transfiguration (school subject)", "In ⟦Verwandlung⟧ sollten sie heute einen Igel in ein Nadelkissen verwandeln, aber Nevilles Igel zuckte nur zusammen.", "Verwandlung", /Verwandlung/i, /transfiguration/i),
  hp("hp-denkarium", "Denkarium = Pensieve", "Dumbledore zog mit der Spitze seines Zauberstabs einen silbrigen Faden aus seiner Schläfe und ließ ihn ins ⟦Denkarium⟧ gleiten.", "Denkarium", /Denkarium/i, /pensieve/i),
  hp("hp-irrwicht", "Irrwicht = Boggart (not will-o'-the-wisp)", "Professor Lupin erklärte, dass sich im alten Kleiderschrank ein ⟦Irrwicht⟧ versteckt habe, der stets die Gestalt dessen annimmt, was man am meisten fürchtet.", "Irrwicht", /Irrwicht/i, /boggart/i),
  hp("hp-flohpulver", "Flohpulver = Floo powder (Floh = flea!)", "Mrs Weasley hielt ihm den Blumentopf hin, und Harry nahm eine Prise ⟦Flohpulver⟧, bevor er in die grünen Flammen trat.", "Flohpulver", /Flohpulver/i, /floo/i),
  hp("hp-portschluessel", "Portschlüssel = Portkey", "Der verschimmelte alte Stiefel auf dem Hügel sah harmlos aus, war in Wahrheit aber ein ⟦Portschlüssel⟧.", "Portschlüssel", /Portschlüssel/i, /portkey/i),
  hp("hp-schlammblut", "slur: Schlammblut = Mudblood (refusal risk)", "Malfoy zischte Hermine ein hässliches ⟦Schlammblut⟧ entgegen, und Ron zog sofort seinen Zauberstab.", "Schlammblut", /Schlammblut/i, /mudblood/i),
  hp("hp-muggel", "Muggel = Muggle, dative plural", "Hagrid knurrte, Harry habe lange genug bei diesen ⟦Muggeln⟧ gelebt, die nicht einmal wüssten, wer er sei.", "Muggeln", /Muggel/i, /muggle/i),
  hp("hp-kroeter", "phrase: Knallrümpfige Kröter = Blast-Ended Skrewts", "Hagrid zeigte ihnen stolz eine Kiste voller Knallrümpfiger Kröter, die nach verfaultem Fisch stanken und Funken sprühten.", "Knallrümpfiger Kröter", /Knallrümpfig/i, /skrewt/i),
  hp("hp-tunichtgut", "Tunichtgut: 'up to no good' (Marauder's Map), real word = good-for-nothing", "Fred tippte mit dem Zauberstab auf das leere Pergament und murmelte feierlich, er sei ein ⟦Tunichtgut⟧.", "Tunichtgut", /Tunichtgut/i, /no good|good-for-nothing|rascal|scoundrel|ne'er-do-well|mischief/i),
  hp("hp-todesser", "Todesser = Death Eater", "Über dem Zeltplatz schwebte das Dunkle Mal, und die ⟦Todesser⟧ waren in den Wald verschwunden.", "Todesser", /Todesser/i, /death eater/i),
  hp("hp-expelliarmus", "spell, not German", "»⟦Expelliarmus⟧!«, rief Harry, und Snapes Zauberstab wirbelte durch die Luft.", "Expelliarmus", /Expelliarmus/i, /disarm|expelliarmus/i),
  hp("hp-hagrid", "Hagrid's colloquial speech: nich' = nicht", "»Hab's dir doch gesagt, Harry, 's is' ⟦nich'⟧ so schlimm, wie's aussieht«, brummte Hagrid.", "nich'", /nicht/i, /not/i),
  hp("hp-hauself", "Hauself = house-elf; 'Herr' from an elf", "Dobby verbeugte sich so tief, dass seine Nase den Teppich berührte, und quiekte, ein ⟦Hauself⟧ müsse seinem Herrn immer gehorchen.", "Hauself", /Hauself/i, /house-?elf/i),
];

const SETS: Record<string, Case[]> = { basic: BASIC, hp: HP };
const setArg = process.argv.find((a) => a.startsWith("--set="))?.slice(6) ?? "basic";
const CASES = SETS[setArg];

const PRICE: Record<string, [number, number]> = {
  "claude-haiku-5-5": [0.1, 0.5],
  "claude-sonnet-5-5": [2, 10],
  "claude-opus-5-5": [4, 20],
};
const modelArgs = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const models = modelArgs.length ? modelArgs : Object.keys(PRICE);
const client = USE_CLI ? null : new Anthropic();
const rows: Record<string, unknown>[] = [];

async function run(model: string, c: Case) {
  const plain = c.sentence.replace(/[⟦⟧]/g, "");
  const params = lookupParams(model, { selection: c.selection, sentence: plain, marked: c.sentence, context: c.context, bookTitle: c.bookTitle });
  let o: Lookup | null, ms: number, out: number, stop: string, cost: number;
  if (client) {
    const t0 = performance.now();
    const res = await client.beta.messages.parse(params);
    ms = Math.round(performance.now() - t0);
    o = res.parsed_output; out = res.usage.output_tokens; stop = String(res.stop_reason);
    const [pi, po] = PRICE[model];
    cost = (res.usage.input_tokens * pi + res.usage.output_tokens * po) / 1e6;
  } else {
    ({ o, ms, out, stop } = await viaCli(params));
    // estimate what the app would pay: ~700 input tokens (system + passage) + the output
    const [pi, po] = PRICE[model];
    cost = (700 * pi + out * po) / 1e6;
  }
  const row = {
    model, id: c.id, trap: c.trap, ms, cost, out_tokens: out, stop,
    lemma_ok: !!o && c.lemma.test(o.lemma), tr_ok: !!o && c.translation.test(o.translation), ...o,
  };
  rows.push(row);
  console.log(`${model.padEnd(18)} ${c.id.padEnd(17)} ${row.lemma_ok ? "✓" : "✗"}${row.tr_ok ? "✓" : "✗"} ${String(ms).padStart(6)}ms  ${o?.lemma} = ${o?.translation}`);
}

// all models in parallel, 4 cases at a time per model
await Promise.all(models.map(async (m) => {
  const queue = [...CASES];
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (let c; (c = queue.shift()); ) await run(m, c).catch((e) => console.log(m, c.id, "ERROR", e.message));
  }));
}));
rows.sort((a, b) => String(a.model).localeCompare(String(b.model)) || CASES.findIndex((c) => c.id === a.id) - CASES.findIndex((c) => c.id === b.id));

mkdirSync("evals/results", { recursive: true });
const out = `evals/results/${setArg}-${new Date().toISOString().slice(0, 16).replace(/:/g, "")}.jsonl`;
writeFileSync(out, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
console.log("\nwrote", out);
for (const m of models) {
  const r = rows.filter((x) => x.model === m);
  const ms = r.map((x) => x.ms as number).sort((a, b) => a - b);
  console.log(`${m}: lemma ${r.filter((x) => x.lemma_ok).length}/${r.length}, gloss ${r.filter((x) => x.tr_ok).length}/${r.length}, median ${ms[Math.floor(ms.length / 2)]}ms, $${(r.reduce((s, x) => s + (x.cost as number), 0) / r.length).toFixed(5)}/lookup`);
}
