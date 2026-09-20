export const MAX_COLLECTION_ITEMS = 10_000;
export const MAX_FILE_BYTES = 90 * 1024 * 1024;
export type Metadata = Record<string, unknown>;
export const basename = (name: string) => name.normalize("NFC").replace(/\.[^.]+$/, "").toLowerCase();

// Bound active work; never create one promise or image decoder per collection item.
export async function pool<T, R>(items: readonly T[], concurrency: number, work: (item: T, index: number) => Promise<R>) {
  const results = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  const settled = await Promise.allSettled(Array.from({length: Math.min(concurrency, items.length)}, async () => {
    while (!failed) {
      const i = next++;
      if (i >= items.length) return;
      try { results[i] = await work(items[i], i); }
      catch (error) { failed = true; throw error; }
    }
  }));
  const error = settled.find(r=>r.status === "rejected");
  if (error?.status === "rejected") throw error.reason;
  return results;
}
export function validateArtwork(files: readonly {name: string; size: number}[]) {
  if (!files.length || files.length > MAX_COLLECTION_ITEMS) throw new Error("Choose 1–10,000 artwork files.");
  const names = new Set<string>();
  for (const file of files) {
    const key = basename(file.name);
    if (!key || names.has(key)) throw new Error(`Duplicate artwork basename: ${file.name}. Each image needs a unique name.`);
    if (file.size < 1 || file.size > MAX_FILE_BYTES) throw new Error(`${file.name}: files must be 1 byte to 90 MiB.`);
    names.add(key);
  }
}
export async function importMetadata(files: readonly File[], artworks: readonly {name: string}[], progress?: (n: number) => void) {
  if (!files.length || files.length > MAX_COLLECTION_ITEMS) throw new Error("Choose 1–10,000 JSON files.");
  if (files.reduce((n, f) => n + f.size, 0) > 128 * 1024 * 1024) throw new Error("Metadata exceeds 128 MiB. Remove embedded media from JSON; select the original artwork separately.");
  const allowed = new Set(artworks.map(f => basename(f.name)));
  const seen = new Set<string>();
  for (const file of files) {
    const key = basename(file.name);
    if (!file.name.toLowerCase().endsWith(".json") || file.size > 1024 * 1024) throw new Error(`${file.name}: choose JSON files up to 1 MiB each.`);
    if (seen.has(key)) throw new Error(`Duplicate metadata basename: ${file.name}`);
    if (!allowed.has(key)) throw new Error(`${file.name} has no matching artwork. Match names such as 1.png and 1.json.`);
    seen.add(key);
  }
  let completed = 0;
  const entries = await pool(files, 8, async file => {
    let data: unknown;
    try { data = JSON.parse(await file.text()); } catch { throw new Error(`Invalid JSON: ${file.name}`); }
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error(`${file.name}: metadata must be a JSON object.`);
    if (Object.hasOwn(data, "attributes") && !Array.isArray((data as Metadata).attributes)) throw new Error(`${file.name}: attributes must be an array.`);
    progress?.(++completed);
    return [basename(file.name), data as Metadata] as const;
  });
  return new Map(entries);
}
