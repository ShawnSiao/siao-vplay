type Relationship = { from: string; to: string; label: string };

// Deliberately supports only a small, inert flowchart subset. Unknown syntax
// falls back as a whole rather than showing an incomplete or misleading graph.
export function readableRelationships(source: string): Relationship[] | null {
  if (source.length > 20_000 || source.includes("%%{")) return null;
  const lines = source.split(/[\n;]/).map((line) => line.trim()).filter((line) => line && !line.startsWith("%%"));
  if (lines.length > 200 || !/^(?:flowchart|graph)\s+(?:LR|RL|TB|TD|BT)$/.test(lines.shift() ?? "")) return null;
  const node = '([A-Za-z_][\\w-]*)(?:\\[([^\\[\\]\\r\\n]+)\\])?';
  const edge = new RegExp(`^${node}\\s*-->(?:\\|([^|]+)\\|)?\\s*${node}$`);
  const declaration = new RegExp(`^${node}$`);
  const names = new Map<string, string>();
  const relations: Relationship[] = [];
  const clean = (text: string) => text.trim().replace(/^"(.*)"$/, "$1");
  const register = (id: string, text?: string) => {
    if (!text) return true;
    const label = clean(text);
    if (!label || label.length > 200 || /[<>]/.test(label) || (names.has(id) && names.get(id) !== label)) return false;
    names.set(id, label); return names.size <= 100;
  };
  for (const line of lines) {
    const match = edge.exec(line);
    if (match) {
      if (!register(match[1], match[2]) || !register(match[4], match[5])) return null;
      const label = clean(match[3] ?? "");
      if (label.length > 200 || /[<>]/.test(label)) return null;
      relations.push({ from: match[1], to: match[4], label });
      if (relations.length > 100) return null;
    } else {
      const definition = declaration.exec(line);
      if (!definition || !definition[2] || !register(definition[1], definition[2])) return null;
    }
  }
  return relations.length ? relations.map((item) => ({ ...item, from: names.get(item.from) ?? item.from, to: names.get(item.to) ?? item.to })) : null;
}

