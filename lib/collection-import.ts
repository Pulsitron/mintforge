export function parseTraitCsv(source: string) {
  const rows: string[][] = [];
  let row: string[] = [], value = "", quoted = false;
  const text = source.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { value += '"'; i++; }
      else if (quoted) quoted = false;
      else if (!value.trim()) { value = ""; quoted = true; }
      else throw new Error("Unexpected quote in CSV. Use the downloaded template.");
    } else if (char === "," && !quoted) {
      row.push(value.trim()); value = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      row.push(value.trim()); value = "";
      if (row.some(Boolean)) rows.push(row);
      row = [];
      if (char === "\r" && text[i + 1] === "\n") i++;
    } else value += char;
  }
  if (quoted) throw new Error("A quoted CSV value is not closed.");
  row.push(value.trim());
  if (row.some(Boolean)) rows.push(row);
  if (rows.length < 2) throw new Error("CSV needs a header row plus at least one data row.");
  const [header, ...entries] = rows;
  if (header[0].toLowerCase() !== "filename") throw new Error("The first CSV column must be filename.");
  if (header.length < 2 || header.slice(1).some((name) => !name)) throw new Error("Give each trait column a name.");
  const byFilename = new Map<string, { trait_type: string; value: string }[]>();
  entries.forEach((cells, index) => {
    const filename = cells[0].toLowerCase();
    if (!filename) throw new Error(`Row ${index + 2} needs a filename.`);
    if (cells.length > header.length) throw new Error(`Row ${index + 2} has too many values. Quote filenames or traits containing commas.`);
    if (byFilename.has(filename)) throw new Error(`Filename ${cells[0]} appears more than once.`);
    byFilename.set(filename, header.slice(1).map((trait_type, i) => ({ trait_type, value: cells[i + 1] || "" })).filter((trait) => trait.value !== ""));
  });
  return { byFilename, rowCount: entries.length };
}

export function traitCsvTemplate(filenames: string[]) {
  const escaped = (value: string) => /[",\r\n]/.test(value) ? '"' + value.replaceAll('"', '""') + '"' : value;
  return ["filename,Background,Eyes,Rarity", ...filenames.map((name) => escaped(name) + ",,,")].join("\r\n");
}
