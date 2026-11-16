import { getSettings, saveSettings, type FontId, type Layout, type Settings, type Theme } from "./db";

export const FONTS: Record<FontId, { label: string; css: string }> = {
  serif: { label: "Serif", css: '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif' },
  literata: { label: "Literata", css: '"Literata", Georgia, serif' },
  sans: { label: "Sans", css: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif' },
  atkinson: { label: "Atkinson", css: '"Atkinson Hyperlegible", system-ui, sans-serif' },
};
const THEMES: [Theme, string][] = [["auto", "Auto"], ["light", "Light"], ["sepia", "Sepia"], ["dark", "Dark"]];
const LAYOUTS: [Layout, string][] = [["scroll", "Scroll"], ["pages", "Pages"]];

/** Apply theme + reading font to the whole document. */
export function applyAppearance(s: Settings = getSettings()) {
  const root = document.documentElement;
  if (s.theme === "auto") delete root.dataset.theme;
  else root.dataset.theme = s.theme;
  root.style.setProperty("--read-font", FONTS[s.font].css);
  root.style.setProperty("--read-size", `${s.fontSize}px`);
  // status bar / browser chrome colour follows the page background
  const bg = getComputedStyle(document.body).backgroundColor;
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => (m.content = bg));
}

/** Theme, font, size and layout controls. onChange runs after the setting is saved and applied. */
export function appearanceControls(onChange: (key: keyof Settings) => void = () => {}) {
  const s = getSettings();
  const el = document.createElement("div");
  el.className = "appearance";
  const seg = (name: string, items: [string, string][], cur: string, style?: (v: string) => string) =>
    `<div class="seg" data-name="${name}">${items
      .map(([v, l]) => `<button type="button" data-v="${v}" class="${v === cur ? "on" : ""}" ${style ? `style="${style(v)}"` : ""}>${l}</button>`)
      .join("")}</div>`;
  el.innerHTML = `
    <div class="opt"><span>Theme</span>${seg("theme", THEMES, s.theme, (v) => `--swatch:var(--swatch-${v})`)}</div>
    <div class="opt"><span>Font</span>${seg("font", Object.entries(FONTS).map(([k, f]) => [k, f.label]), s.font, (v) => `font-family:${FONTS[v as FontId].css.replace(/"/g, "&quot;")}`)}</div>
    <div class="opt"><span>Size</span><div class="seg size"><button type="button" data-d="-1" aria-label="Smaller">A−</button><output>${s.fontSize}</output><button type="button" data-d="1" aria-label="Bigger">A+</button></div></div>
    <div class="opt"><span>Layout</span>${seg("layout", LAYOUTS, s.layout)}</div>
    <p class="sub hint">Pages: tap the left or right side, or swipe, to turn the page. Tap a word to translate it.</p>`;
  el.querySelectorAll<HTMLElement>(".seg[data-name]").forEach((g) =>
    g.querySelectorAll<HTMLButtonElement>("button").forEach((b) => (b.onclick = () => {
      const key = g.dataset.name as keyof Settings;
      saveSettings({ [key]: b.dataset.v } as Partial<Settings>);
      g.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
      applyAppearance();
      onChange(key);
    })),
  );
  el.querySelectorAll<HTMLButtonElement>(".size button").forEach((b) => (b.onclick = () => {
    const fontSize = Math.min(36, Math.max(14, getSettings().fontSize + Number(b.dataset.d)));
    saveSettings({ fontSize });
    el.querySelector("output")!.textContent = String(fontSize);
    applyAppearance();
    onChange("fontSize");
  }));
  return el;
}
