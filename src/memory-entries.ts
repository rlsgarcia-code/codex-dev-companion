import { createHash } from "node:crypto";

export type DurableMemoryEntry = {
  id: string;
  date?: string;
  text: string;
  lineNumber: number;
};

export type DurableMemorySnapshot = {
  entries: DurableMemoryEntry[];
  total: number;
  omitted: number;
};

const ENTRY_PATTERN = /^-\s+(?:(\d{4}-\d{2}-\d{2}):\s*)?(.+?)\s*$/;

export function durableMemorySnapshot(source: string, maximumEntries = 200): DurableMemorySnapshot {
  const entries = parseDurableMemoryEntries(source);
  const maximum = Math.max(1, Math.floor(maximumEntries));
  const retained = entries.slice(-maximum).reverse();
  return {
    entries: retained,
    total: entries.length,
    omitted: Math.max(0, entries.length - retained.length)
  };
}

export function replaceDurableMemoryEntry(source: string, id: string, text: string): string {
  const clean = normalizeMemoryText(text);
  const { lines, newline } = splitMemorySource(source);
  const entry = locateEntry(lines, id);
  lines[entry.lineNumber - 1] = `- ${entry.date ? `${entry.date}: ` : ""}${clean}`;
  return lines.join(newline);
}

export function deleteDurableMemoryEntry(source: string, id: string): string {
  const { lines, newline } = splitMemorySource(source);
  const entry = locateEntry(lines, id);
  lines.splice(entry.lineNumber - 1, 1);
  return lines.join(newline);
}

export function normalizeMemoryText(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) throw new Error("Memory entry cannot be empty.");
  if (clean.length > 4_000) throw new Error("Keep one memory entry under 4,000 characters.");
  return clean;
}

function parseDurableMemoryEntries(source: string): DurableMemoryEntry[] {
  return source.split(/\r?\n/).flatMap((line, index): DurableMemoryEntry[] => {
    const match = ENTRY_PATTERN.exec(line);
    if (!match) return [];
    const text = match[2]?.trim();
    if (!text) return [];
    const lineNumber = index + 1;
    return [{
      id: memoryEntryId(lineNumber, line),
      ...(match[1] ? { date: match[1] } : {}),
      text,
      lineNumber
    }];
  });
}

function locateEntry(lines: string[], id: string): DurableMemoryEntry {
  const entry = parseDurableMemoryEntries(lines.join("\n")).find((candidate) => candidate.id === id);
  if (!entry) throw new Error("This memory entry changed or no longer exists. Refresh the memory center and try again.");
  return entry;
}

function splitMemorySource(source: string): { lines: string[]; newline: string } {
  return {
    lines: source.split(/\r?\n/),
    newline: source.includes("\r\n") ? "\r\n" : "\n"
  };
}

function memoryEntryId(lineNumber: number, line: string): string {
  return createHash("sha256").update(`${lineNumber}\0${line}`).digest("hex").slice(0, 24);
}
