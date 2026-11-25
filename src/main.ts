import "./fonts.css";
import "./style.css";
import { appearanceControls, applyAppearance } from "./appearance";
import {
  allCards, deleteBook, deleteCard, dueCards, exportAll, getBook, getProgress, getSettings,
  importCards, listBooks, saveBook, saveProgress, saveSettings, type Book, type Flashcard,
} from "./db";
import { importFile, importText } from "./importer";
import { describeError, lookup, type PartialLookup } from "./translate";
import { addCard, grade, GRADES, hasCard, preview } from "./srs";

const app = document.getElementById("app")!;
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const h = <T extends HTMLElement = HTMLElement>(html: string) => {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild as T;
};

navigator.storage?.persist?.(); // ask Safari not to evict the library
applyAppearance();

// ---------------------------------------------------------------- routing
let cleanup: (() => void) | null = null;
async function route() {
  cleanup?.();
  cleanup = null;
  closeSheet();
  const [, view, arg] = location.hash.split("/");
  if (view === "read" && arg) return renderReader(arg);
  await renderShell(view || "library");
}
window.addEventListener("hashchange", route);
route();

async function renderShell(view: string) {
  const due = (await dueCards()).length;
  app.innerHTML = `
    <main class="page" id="page"></main>
    <nav class="tabs">
      <a href="#/library" class="${view === "library" ? "on" : ""}">Library</a>
      <a href="#/review" class="${view === "review" ? "on" : ""}">Review${due ? `<b class="badge">${due}</b>` : ""}</a>
      <a href="#/deck" class="${view === "deck" ? "on" : ""}">Words</a>
      <a href="#/settings" class="${view === "settings" ? "on" : ""}">Settings</a>
    </nav>`;
  const page = document.getElementById("page")!;
  if (view === "review") return renderReview(page);
  if (view === "deck") return renderDeck(page);
  if (view === "settings") return renderSettings(page);
  return renderLibrary(page);
}

// ---------------------------------------------------------------- library
async function renderLibrary(page: HTMLElement) {
  const books = await listBooks();
  const progress = await Promise.all(books.map((b) => getProgress(b.id)));
  page.innerHTML = `
    <header class="head"><h1>Library</h1>
      <div class="row">
        <label class="btn primary">Import book<input type="file" id="file" accept=".epub,.txt,application/epub+zip,text/plain" hidden></label>
        <button class="btn" id="paste">Paste text</button>
      </div>
    </header>
    ${!getSettings().apiKey ? `<p class="note">Add your Anthropic API key in <a href="#/settings">Settings</a> to enable translations.</p>` : ""}
    <ul class="books">
      ${books.map((b, i) => {
        const p = progress[i];
        const pct = p ? Math.round(((p.chapter + 1) / b.chapterCount) * 100) : 0;
        return `<li><a href="#/read/${b.id}" class="book">
            <span class="t">${esc(b.title)}</span>
            <span class="sub">${esc(b.author || "")} · ${b.wordCount.toLocaleString()} words · ${pct}%</span>
            <span class="bar"><i style="width:${pct}%"></i></span>
          </a><button class="icon del" data-id="${b.id}" aria-label="Delete">✕</button></li>`;
      }).join("")}
    </ul>
    ${books.length ? "" : `<p class="empty">No books yet. Import a DRM-free .epub or .txt file.<br>Free German classics: Project Gutenberg, Projekt Gutenberg-DE.</p>`}`;

  page.querySelector<HTMLInputElement>("#file")!.onchange = async (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    try {
      const book = await importFile(f);
      await saveBook(book);
      location.hash = `#/read/${book.id}`;
    } catch (err) {
      alert(describeError(err));
    }
  };
  page.querySelector<HTMLButtonElement>("#paste")!.onclick = () => {
    const dlg = h<HTMLDialogElement>(`<dialog class="dlg"><form method="dialog">
      <input name="title" placeholder="Title" required>
      <textarea name="text" rows="12" placeholder="German text…" required></textarea>
      <div class="row"><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn primary" value="ok">Add</button></div>
    </form></dialog>`);
    document.body.append(dlg);
    dlg.showModal();
    dlg.onclose = async () => {
      const fd = new FormData(dlg.querySelector("form")!);
      dlg.remove();
      if (dlg.returnValue !== "ok") return;
      const book = importText(String(fd.get("text")), String(fd.get("title")));
      await saveBook(book);
      location.hash = `#/read/${book.id}`;
    };
  };
  page.querySelectorAll<HTMLButtonElement>(".del").forEach((b) => (b.onclick = async () => {
    if (!confirm("Delete this book? Your flashcards are kept.")) return;
    await deleteBook(b.dataset.id!);
    renderLibrary(page);
  }));
}

// ---------------------------------------------------------------- reader
const segSentence = new Intl.Segmenter("de", { granularity: "sentence" });
const segWord = new Intl.Segmenter("de", { granularity: "word" });

function paragraphHtml(text: string, pi: number, known: Set<string>) {
  let out = "";
  let si = 0;
  for (const { segment: sent } of segSentence.segment(text)) {
    let inner = "";
    for (const w of segWord.segment(sent)) {
      if (w.isWordLike) {
        const k = known.has(w.segment.toLowerCase()) ? " known" : "";
        inner += `<span class="w${k}">${esc(w.segment)}</span>`;
      } else inner += esc(w.segment);
    }
    out += `<span class="s" data-s="${si++}">${inner}</span>`;
  }
  return `<p data-p="${pi}">${out}</p>`;
}

async function renderReader(id: string) {
  const book = await getBook(id);
  if (!book) return void (location.hash = "#/library");
  const prog = await getProgress(id);
  let chapter = Math.min(prog?.chapter ?? 0, book.chapters.length - 1);
  const known = new Set((await allCards()).map((c) => c.selection.toLowerCase()));

  app.innerHTML = `
    <header class="readbar">
      <a href="#/library" class="icon" aria-label="Back">‹</a>
      <select id="chap">${book.chapters.map((c, i) => `<option value="${i}">${esc(c.title.slice(0, 60))}</option>`).join("")}</select>
      <button class="icon aa" id="aa" aria-label="Reading options" aria-expanded="false">Aa</button>
    </header>
    <div class="aa-panel" id="aap" hidden></div>
    <article class="text" id="text" lang="de"></article>
    <div class="pageno" id="pageno"></div>
    <button class="btn primary floating" id="selbtn" hidden>Translate selection</button>`;
  const textEl = document.getElementById("text")!;
  const chapSel = document.getElementById("chap") as HTMLSelectElement;
  const selBtn = document.getElementById("selbtn") as HTMLButtonElement;
  const pageNo = document.getElementById("pageno")!;
  const aaBtn = document.getElementById("aa") as HTMLButtonElement;
  const aaPanel = document.getElementById("aap")!;

  // ---- layout: "scroll" (normal page scroll) or "pages" (CSS columns, one screen per page)
  let paged = false;
  let page = 0;
  let pages = 1;
  const pageWidth = () => textEl.clientWidth;

  function layout() {
    paged = getSettings().layout === "pages";
    document.body.classList.toggle("paged", paged);
    textEl.style.removeProperty("column-width");
    textEl.style.removeProperty("column-gap");
    textEl.style.removeProperty("padding-inline");
    if (!paged) { pageNo.textContent = ""; return; }
    const W = pageWidth();
    const cols = W >= 1000 ? 2 : 1; // two columns per page on a landscape iPad
    const pad = Math.round(Math.max(24, W * 0.06));
    // column + gap = W / cols, so one page = exactly W pixels of horizontal scroll
    textEl.style.paddingInline = `${pad}px`;
    textEl.style.columnGap = `${2 * pad}px`;
    textEl.style.columnWidth = `${W / cols - 2 * pad}px`;
    pages = Math.max(1, Math.round(textEl.scrollWidth / W));
  }
  function goPage(n: number) {
    page = Math.max(0, Math.min(pages - 1, n));
    textEl.scrollLeft = page * pageWidth();
    pageNo.textContent = `${page + 1} / ${pages}`;
    saveSoon();
  }
  function pageOf(p: Element) {
    const r = p.getClientRects()[0];
    if (!r) return 0;
    const x = r.left - textEl.getBoundingClientRect().left + textEl.scrollLeft;
    return Math.floor(x / pageWidth());
  }
  function next() {
    if (page < pages - 1) goPage(page + 1);
    else if (chapter < book!.chapters.length - 1) showChapter(chapter + 1);
  }
  function prev() {
    if (page > 0) goPage(page - 1);
    else if (chapter > 0) showChapter(chapter - 1, -1);
  }

  /** paragraph = -1 means "the end of the chapter" (when paging backwards). */
  function showChapter(i: number, paragraph = 0) {
    chapter = i;
    chapSel.value = String(i);
    const ch = book!.chapters[i];
    textEl.innerHTML =
      ch.paragraphs.map((p, pi) => paragraphHtml(p, pi, known)).join("") +
      (i < book!.chapters.length - 1
        ? `<button class="btn next" id="next">Next chapter ›</button>`
        : `<p class="end">Ende.</p>`);
    document.getElementById("next")?.addEventListener("click", () => showChapter(i + 1));
    layout();
    restore(paragraph);
  }
  function restore(paragraph: number) {
    const target = paragraph < 0 ? null : textEl.querySelector(`p[data-p="${paragraph}"]`);
    if (paged) {
      textEl.scrollLeft = 0;
      goPage(paragraph < 0 ? pages - 1 : paragraph && target ? pageOf(target) : 0);
    } else if (paragraph < 0) window.scrollTo(0, document.body.scrollHeight);
    else if (paragraph && target) target.scrollIntoView();
    else window.scrollTo(0, 0);
    saveSoon();
  }
  chapSel.onchange = () => showChapter(Number(chapSel.value));

  function currentParagraph() {
    const ps = textEl.querySelectorAll<HTMLElement>("p[data-p]");
    if (paged) {
      const box = textEl.getBoundingClientRect();
      for (const p of ps)
        for (const r of p.getClientRects()) if (r.right > box.left + 1 && r.left < box.right) return Number(p.dataset.p);
      return 0;
    }
    for (const p of ps) if (p.getBoundingClientRect().bottom > 60) return Number(p.dataset.p);
    return 0;
  }
  const save = () => saveProgress({ bookId: id, chapter, paragraph: currentParagraph(), updatedAt: Date.now() });
  let t: number | undefined;
  const saveSoon = () => { clearTimeout(t); t = window.setTimeout(save, 400); };
  window.addEventListener("scroll", saveSoon, { passive: true });

  // re-flow on rotation / resize / font change, keeping the current paragraph in view
  const relayout = () => { const p = currentParagraph(); layout(); restore(p); };
  let rt: number | undefined;
  const onResize = () => { clearTimeout(rt); rt = window.setTimeout(relayout, 150); };
  window.addEventListener("resize", onResize);

  // ---- reading options panel
  aaPanel.append(appearanceControls((key) => { if (key !== "theme") relayout(); }));
  const togglePanel = (open = aaPanel.hidden) => { aaPanel.hidden = !open; aaBtn.setAttribute("aria-expanded", String(open)); };
  aaBtn.onclick = () => togglePanel();

  function contextFor(p: HTMLElement) {
    const pi = Number(p.dataset.p);
    const paras = book!.chapters[chapter].paragraphs;
    const before = paras.slice(Math.max(0, pi - 2), pi).join("\n\n").slice(-1200);
    const after = (paras[pi + 1] || "").slice(0, 500);
    return [before, paras[pi], after].filter(Boolean).join("\n\n");
  }

  function lookupWord(w: HTMLElement) {
    const s = w.closest<HTMLElement>(".s")!;
    const p = w.closest<HTMLElement>("p")!;
    textEl.querySelectorAll(".hl").forEach((x) => x.classList.remove("hl"));
    w.classList.add("hl");
    // mark the tapped occurrence, in case the word appears twice in the sentence
    const marked = Array.from(s.childNodes, (n) => (n === w ? `⟦${n.textContent}⟧` : n.textContent)).join("").trim();
    openLookup({ selection: w.textContent!, sentence: s.textContent!.trim(), marked, context: contextFor(p), book: book!, onAdded: (sel) => { known.add(sel.toLowerCase()); w.classList.add("known"); } });
  }

  // Tap: a word -> look it up, wherever it sits. In page mode, a tap on blank space turns the page.
  textEl.addEventListener("click", (e) => {
    if (!document.getSelection()?.isCollapsed) return;
    if (!aaPanel.hidden) return togglePanel(false);
    const w = (e.target as HTMLElement).closest<HTMLElement>(".w");
    if (w) return lookupWord(w);
    if (!paged) return;
    if (sheet) return closeSheet(); // first tap dismisses the translation
    if (e.clientX < window.innerWidth / 2) prev(); else next();
  });

  // Swipe left/right in page mode
  let sx = 0, sy = 0;
  textEl.addEventListener("touchstart", (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  textEl.addEventListener("touchend", (e) => {
    if (!paged || !document.getSelection()?.isCollapsed) return;
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    if (Math.abs(dx) > 50 && Math.abs(dx) > 1.5 * Math.abs(dy)) { if (dx < 0) next(); else prev(); }
  }, { passive: true });

  const onKey = (e: KeyboardEvent) => {
    if (!paged || (e.target as HTMLElement).closest("input,select,textarea")) return;
    if (["ArrowRight", "PageDown", " "].includes(e.key)) { e.preventDefault(); next(); }
    else if (["ArrowLeft", "PageUp"].includes(e.key)) { e.preventDefault(); prev(); }
  };
  document.addEventListener("keydown", onKey);

  // Select several words (long-press + drag on iPad) -> translate the selection
  const onSel = () => {
    const sel = document.getSelection();
    const txt = sel?.toString().trim() || "";
    selBtn.hidden = !(sel && !sel.isCollapsed && txt.length > 1 && textEl.contains(sel.anchorNode));
  };
  document.addEventListener("selectionchange", onSel);
  selBtn.onclick = () => {
    const sel = document.getSelection()!;
    const range = sel.getRangeAt(0);
    const el = (n: Node) => (n.nodeType === 1 ? (n as HTMLElement) : n.parentElement!);
    const s1 = el(range.startContainer).closest<HTMLElement>(".s");
    const s2 = el(range.endContainer).closest<HTMLElement>(".s");
    const p = el(range.startContainer).closest<HTMLElement>("p");
    if (!s1 || !p) return;
    // sentence = every sentence the selection touches
    const sentences: string[] = [];
    let cur: Element | null = s1;
    while (cur) {
      sentences.push(cur.textContent!.trim());
      if (cur === s2 || !s2) break;
      cur = cur.nextElementSibling ?? cur.parentElement?.nextElementSibling?.firstElementChild ?? null;
      if (sentences.length > 6) break;
    }
    const selection = sel.toString().trim().replace(/\s+/g, " ");
    sel.removeAllRanges();
    selBtn.hidden = true;
    openLookup({ selection, sentence: sentences.join(" "), context: contextFor(p), book: book!, onAdded: (s) => known.add(s.toLowerCase()) });
  };

  cleanup = () => {
    save();
    document.body.classList.remove("paged");
    window.removeEventListener("scroll", saveSoon);
    window.removeEventListener("resize", onResize);
    document.removeEventListener("keydown", onKey);
    document.removeEventListener("selectionchange", onSel);
  };
  showChapter(chapter, prog?.chapter === chapter ? prog.paragraph : 0);
  await document.fonts?.ready; // column layout depends on the font metrics
  relayout();
}

// ---------------------------------------------------------------- lookup sheet
let sheet: HTMLElement | null = null;
function closeSheet() {
  sheet?.remove();
  sheet = null;
  document.querySelectorAll(".hl").forEach((x) => x.classList.remove("hl"));
}

// Also renders a streamed, still incomplete answer: missing fields are left out.
function lookupHtml(l: PartialLookup) {
  const other = (l.other_meanings ?? []).filter((x) => typeof x === "string" && x);
  return `
    <div class="lemma">${esc(l.lemma ?? "")} <span class="pos">${esc(l.part_of_speech ?? "")}</span></div>
    <div class="tr">${esc(l.translation ?? "")}${other.length ? `<span class="other">also: ${other.map(esc).join(" · ")}</span>` : ""}</div>
    ${l.grammar ? `<div class="gram">${esc(l.grammar)}</div>` : ""}
    ${l.explanation ? `<p class="expl">${esc(l.explanation)}</p>` : ""}
    ${l.sentence_translation ? `<p class="sent-tr">${esc(l.sentence_translation)}</p>` : ""}`;
}

async function openLookup(o: { selection: string; sentence: string; marked?: string; context: string; book: Book; onAdded: (sel: string) => void }) {
  closeSheet();
  sheet = h(`<aside class="sheet">
      <div class="sheet-head"><span class="sel" lang="de">${esc(o.selection)}</span><button class="icon" id="close" aria-label="Close">✕</button></div>
      <div class="sheet-body"><div class="spinner"></div></div>
    </aside>`);
  document.body.append(sheet);
  const mine = sheet;
  sheet.querySelector<HTMLButtonElement>("#close")!.onclick = closeSheet;
  const body = sheet.querySelector<HTMLElement>(".sheet-body")!;
  try {
    const l = await lookup(
      { selection: o.selection, sentence: o.sentence, marked: o.marked, context: o.context, bookTitle: o.book.title },
      (p) => {
        if (sheet === mine && p.translation) body.innerHTML = lookupHtml(p) + `<div class="spinner small"></div>`;
      },
    );
    if (sheet !== mine) return; // closed or replaced meanwhile
    const inDeck = await hasCard(l.lemma);
    body.innerHTML = lookupHtml(l) +
      `<button class="btn primary" id="add" ${inDeck ? "disabled" : ""}>${inDeck ? "In your words ✓" : "+ Add to flashcards"}</button>`;
    const add = body.querySelector<HTMLButtonElement>("#add")!;
    add.onclick = async () => {
      await addCard(l, o.selection, o.sentence, o.book.title);
      add.disabled = true;
      add.textContent = "In your words ✓";
      o.onAdded(o.selection);
    };
  } catch (e) {
    if (sheet === mine) body.innerHTML = `<p class="err">${esc(describeError(e))}</p>`;
  }
}

// ---------------------------------------------------------------- review
function highlight(sentence: string, selection: string) {
  const i = sentence.indexOf(selection);
  if (i < 0) return esc(sentence);
  return esc(sentence.slice(0, i)) + `<mark>${esc(selection)}</mark>` + esc(sentence.slice(i + selection.length));
}

async function renderReview(page: HTMLElement) {
  const queue = (await dueCards()).sort((a, b) => +a.fsrs.due - +b.fsrs.due);
  let done = 0;
  let onKey: ((e: KeyboardEvent) => void) | null = null;
  cleanup = () => onKey && document.removeEventListener("keydown", onKey);

  const next = () => {
    if (onKey) document.removeEventListener("keydown", onKey);
    const card = queue.shift();
    if (!card) {
      page.innerHTML = `<header class="head"><h1>Review</h1></header>
        <p class="empty">${done ? `Done: ${done} card${done > 1 ? "s" : ""} reviewed.` : "Nothing due right now."}<br>Tap words while reading to add more.</p>`;
      return;
    }
    show(card);
  };

  function show(card: Flashcard) {
    const iv = preview(card);
    page.innerHTML = `
      <header class="head"><h1>Review</h1><span class="sub">${queue.length + 1} left</span></header>
      <section class="card">
        <div class="front" lang="de">
          <div class="lemma big">${esc(card.lemma)}</div>
          <p class="ctx">${highlight(card.sentence, card.selection)}</p>
        </div>
        <div class="back" hidden>${lookupHtml(card.lookup)}
          ${card.bookTitle ? `<p class="src">${esc(card.bookTitle)}</p>` : ""}</div>
        <button class="btn primary wide" id="show">Show answer</button>
        <div class="grades" hidden>${GRADES.map((g) => `<button class="btn g${g.grade}" data-g="${g.grade}">${g.label}<small>${iv[g.grade]}</small></button>`).join("")}</div>
      </section>`;
    const reveal = () => {
      page.querySelector<HTMLElement>(".back")!.hidden = false;
      page.querySelector<HTMLElement>(".grades")!.hidden = false;
      page.querySelector<HTMLElement>("#show")!.hidden = true;
    };
    const rate = async (g: number) => {
      await grade(card, g as (typeof GRADES)[number]["grade"]);
      done++;
      if (g === 1) queue.push(card); // see it again this session
      next();
    };
    page.querySelector<HTMLButtonElement>("#show")!.onclick = reveal;
    page.querySelectorAll<HTMLButtonElement>("[data-g]").forEach((b) => (b.onclick = () => rate(Number(b.dataset.g))));
    onKey = (e) => {
      const revealed = !page.querySelector<HTMLElement>(".grades")!.hidden;
      if (!revealed && (e.key === " " || e.key === "Enter")) { e.preventDefault(); reveal(); }
      else if (revealed && "1234".includes(e.key)) rate(Number(e.key));
    };
    document.addEventListener("keydown", onKey);
  }
  next();
}

// ---------------------------------------------------------------- deck
async function renderDeck(page: HTMLElement) {
  const cards = (await allCards()).sort((a, b) => b.createdAt - a.createdAt);
  const now = Date.now();
  const when = (d: Date) => {
    const days = Math.round((+d - now) / 86400000);
    if (+d <= now) return "due";
    return days < 1 ? "today" : `in ${days}d`;
  };
  page.innerHTML = `
    <header class="head"><h1>Words <span class="sub">${cards.length}</span></h1>
      <input type="search" id="q" placeholder="Search"></header>
    <ul class="deck">${cards.map((c) => `
      <li data-q="${esc((c.lemma + " " + c.lookup.translation).toLowerCase())}">
        <div><b lang="de">${esc(c.lemma)}</b> <span class="tr">${esc(c.lookup.translation)}</span>
        <p class="ctx" lang="de">${highlight(c.sentence, c.selection)}</p></div>
        <span class="due">${when(c.fsrs.due)}</span>
        <button class="icon del" data-id="${c.id}" aria-label="Delete">✕</button>
      </li>`).join("")}</ul>
    ${cards.length ? "" : `<p class="empty">No words yet. While reading, tap a word and press “Add to flashcards”.</p>`}`;
  page.querySelector<HTMLInputElement>("#q")!.oninput = (e) => {
    const q = (e.target as HTMLInputElement).value.toLowerCase();
    page.querySelectorAll<HTMLElement>(".deck li").forEach((li) => (li.hidden = !li.dataset.q!.includes(q)));
  };
  page.querySelectorAll<HTMLButtonElement>(".del").forEach((b) => (b.onclick = async () => {
    if (!confirm("Delete this card?")) return;
    await deleteCard(b.dataset.id!);
    b.closest("li")!.remove();
  }));
}

// ---------------------------------------------------------------- settings
async function renderSettings(page: HTMLElement) {
  const s = getSettings();
  const persisted = (await navigator.storage?.persisted?.()) ?? false;
  page.innerHTML = `
    <header class="head"><h1>Settings</h1></header>
    <form class="settings" id="f">
      <label>Anthropic API key
        <input name="apiKey" type="password" autocomplete="off" value="${esc(s.apiKey)}" placeholder="sk-ant-…">
        <small>Stored only on this device, sent only to api.anthropic.com. Create one at console.anthropic.com.</small>
      </label>
      <label>Model
        <select name="model">
          ${[
            ["claude-haiku-5-5", "Claude Haiku 5.5 (default, ~0.04¢ per lookup)"],
            ["claude-sonnet-5-5", "Claude Sonnet 5.5 (more exact grammar, ~0.5¢)"],
            ["claude-opus-5-5", "Claude Opus 5.5 (best, ~1¢)"],
          ].map(([v, l]) => `<option value="${v}" ${s.model === v ? "selected" : ""}>${l}</option>`).join("")}
        </select>
      </label>
      <button class="btn primary">Save</button>
      <span id="saved" class="sub"></span>
    </form>
    <section class="settings" id="reading"><h2>Reading</h2></section>
    <section class="settings">
      <h2>Backup</h2>
      <p class="sub">Your words live in this browser${persisted ? " (persistent storage granted)" : ""}. Export now and then.</p>
      <div class="row"><button class="btn" id="export">Export words</button>
      <label class="btn">Import words<input type="file" id="import" accept=".json,application/json" hidden></label></div>
    </section>
    <p class="sub version">Version ${__APP_COMMIT__} · built ${new Date(__APP_BUILT__).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</p>`;
  page.querySelector("#reading")!.append(appearanceControls());
  page.querySelector<HTMLFormElement>("#f")!.onsubmit = (e) => {
    e.preventDefault();
    const fd = new FormData(e.target as HTMLFormElement);
    saveSettings({ apiKey: String(fd.get("apiKey")).trim(), model: String(fd.get("model")) });
    page.querySelector("#saved")!.textContent = "Saved";
  };
  page.querySelector<HTMLButtonElement>("#export")!.onclick = async () => {
    const blob = new Blob([JSON.stringify(await exportAll(), null, 1)], { type: "application/json" });
    const a = h<HTMLAnchorElement>(`<a download="german-words-${new Date().toISOString().slice(0, 10)}.json"></a>`);
    a.href = URL.createObjectURL(blob);
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  page.querySelector<HTMLInputElement>("#import")!.onchange = async (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      await importCards(data.cards || []);
      alert(`Imported ${(data.cards || []).length} cards.`);
    } catch (err) {
      alert(describeError(err));
    }
  };
}
