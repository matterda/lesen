import JSZip from "jszip";
import { uid, type Book, type Chapter } from "./db";

const clean = (s: string) =>
  s.replace(/­/g, "").replace(/\s+/g, " ").trim();

export async function importFile(file: File): Promise<Book> {
  const name = file.name.replace(/\.[^.]+$/, "");
  if (/\.epub$/i.test(file.name)) return importEpub(file);
  if (/\.(txt|md|text)$/i.test(file.name) || file.type.startsWith("text/")) {
    return importText(await decodeText(file), name);
  }
  throw new Error("Unsupported file. Use .epub or .txt");
}

async function decodeText(file: File) {
  const buf = await file.arrayBuffer();
  const utf8 = new TextDecoder("utf-8").decode(buf);
  // Old German .txt files are often Latin-1 / Windows-1252
  return utf8.includes("�") ? new TextDecoder("windows-1252").decode(buf) : utf8;
}

const HEADING = /^(kapitel|teil|buch|chapter|prolog|epilog)\b.{0,60}$|^[IVXLC]+\.?$|^\d{1,3}\.?$/i;

export function importText(text: string, title: string): Book {
  const paras = text
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map(clean)
    .filter(Boolean);
  const chapters: Chapter[] = [];
  let cur: Chapter = { title: "Anfang", paragraphs: [] };
  for (const p of paras) {
    if (HEADING.test(p) && cur.paragraphs.length > 3) {
      chapters.push(cur);
      cur = { title: p, paragraphs: [p] };
    } else {
      if (HEADING.test(p) && chapters.length === 0 && cur.title === "Anfang") cur.title = p; // heading right at the start
      cur.paragraphs.push(p);
    }
  }
  chapters.push(cur);
  // No headings found: split into chunks so a chapter stays a reasonable page
  const out: Chapter[] = [];
  for (const c of chapters) {
    if (c.paragraphs.length <= 200) out.push(c);
    else
      for (let i = 0; i < c.paragraphs.length; i += 150)
        out.push({ title: `${c.title} (${i / 150 + 1})`, paragraphs: c.paragraphs.slice(i, i + 150) });
  }
  return { id: uid(), title, addedAt: Date.now(), chapters: out.filter((c) => c.paragraphs.length) };
}

const BLOCKS = "p,h1,h2,h3,h4,h5,h6,li,blockquote,pre,dd,dt";

function parseXhtml(src: string) {
  let doc = new DOMParser().parseFromString(src, "application/xhtml+xml");
  if (doc.querySelector("parsererror")) doc = new DOMParser().parseFromString(src, "text/html");
  return doc;
}

async function importEpub(file: File): Promise<Book> {
  const zip = await JSZip.loadAsync(file);
  const read = (p: string) => zip.file(decodeURIComponent(p))?.async("string");
  const container = await read("META-INF/container.xml");
  if (!container) throw new Error("Not a valid EPUB (no container.xml)");
  const opfPath = parseXhtml(container).querySelector("rootfile")?.getAttribute("full-path");
  if (!opfPath) throw new Error("Not a valid EPUB (no rootfile)");
  const opf = parseXhtml((await read(opfPath))!);
  const base = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";

  const meta = (tag: string) =>
    clean(opf.getElementsByTagName(tag)[0]?.textContent || opf.getElementsByTagName("dc:" + tag)[0]?.textContent || "");
  const title = meta("title") || file.name.replace(/\.epub$/i, "");
  const author = meta("creator") || undefined;

  const manifest = new Map<string, string>();
  for (const item of Array.from(opf.getElementsByTagName("item")))
    manifest.set(item.getAttribute("id")!, item.getAttribute("href")!);

  const chapters: Chapter[] = [];
  for (const ref of Array.from(opf.getElementsByTagName("itemref"))) {
    const href = manifest.get(ref.getAttribute("idref")!);
    if (!href) continue;
    const html = await read(base + href.split("#")[0]);
    if (!html) continue;
    const doc = parseXhtml(html);
    const body = doc.body || doc.documentElement;
    const all = Array.from(body.querySelectorAll(BLOCKS));
    // keep innermost blocks only (e.g. <blockquote><p>…</p></blockquote> -> the <p>)
    let blocks = all.filter((el) => !el.querySelector(BLOCKS)).map((el) => clean(el.textContent || ""));
    if (!blocks.length) blocks = (body.textContent || "").split(/\n\s*\n/).map(clean);
    const paragraphs = blocks.filter(Boolean);
    if (!paragraphs.length) continue;
    const h = body.querySelector("h1,h2,h3");
    const t = clean(h?.textContent || "") || paragraphs[0].slice(0, 50);
    chapters.push({ title: t, paragraphs });
  }
  if (!chapters.length) throw new Error("No readable text found in this EPUB (DRM-protected?)");
  return { id: uid(), title, author, addedAt: Date.now(), chapters };
}
