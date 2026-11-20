import Anthropic from "@anthropic-ai/sdk";
import { partialParse } from "@anthropic-ai/sdk/_vendor/partial-json-parser/parser";
import { lookupParams, type LookupRequest } from "./prompt";
import { cacheLookup, getCachedLookup, getSettings, type Lookup } from "./db";

function client() {
  const { apiKey } = getSettings();
  if (!apiKey) throw new Error("Add your Anthropic API key in Settings first.");
  // Runs in the user's own browser with their own key, stored only on this device.
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
}

async function hash(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf).slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
}

export type { LookupRequest };

export type PartialLookup = Partial<Lookup>;

// Streams the answer: onPartial gets the fields written so far (the gloss first), the promise the full lookup.
export async function lookup(req: LookupRequest, onPartial?: (p: PartialLookup) => void): Promise<Lookup> {
  const { model } = getSettings();
  const key = await hash([model, req.selection, req.sentence].join("\u0000"));
  const cached = await getCachedLookup(key);
  if (cached) return cached.lookup;

  const stream = client().beta.messages.stream(lookupParams(model, req));
  if (onPartial)
    stream.on("text", (_delta, snapshot) => {
      try {
        const p = partialParse(snapshot);
        if (p && typeof p === "object") onPartial(p as PartialLookup);
      } catch {
        // not parseable yet; the next delta will be
      }
    });
  const res = await stream.finalMessage();
  if (res.stop_reason === "refusal") throw new Error("The model declined to translate this passage.");
  if (!res.parsed_output) throw new Error("Could not read the model's answer. Try again.");
  await cacheLookup(key, res.parsed_output);
  return res.parsed_output;
}

export function describeError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return "API key rejected. Check it in Settings.";
  if (e instanceof Anthropic.RateLimitError) return "Rate limited. Wait a moment and try again.";
  if (e instanceof Anthropic.APIConnectionError) return "No connection to the API. Are you offline?";
  if (e instanceof Anthropic.APIError) return `API error ${e.status ?? ""}: ${e.message}`;
  return e instanceof Error ? e.message : String(e);
}
