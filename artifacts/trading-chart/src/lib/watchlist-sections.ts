export interface WatchlistSection {
  id: string;
  name: string;
  symbols: string[];
  collapsed: boolean;
}

const STORAGE_KEY = "tradingTerminalWatchlistSections_v1";

export function makeId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function createSection(name: string, symbols: string[] = []): WatchlistSection {
  return { id: makeId(), name, symbols, collapsed: false };
}

export function loadSections(fallbackSymbols: string[]): WatchlistSection[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch { /* ignore */ }
  return [createSection("Watchlist", fallbackSymbols)];
}

export function saveSections(sections: WatchlistSection[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sections));
  } catch { /* ignore */ }
}

export function syncSectionsWithSymbols(
  sections: WatchlistSection[],
  symbols: string[],
): WatchlistSection[] {
  const symbolSet = new Set(symbols);

  const cleaned = sections.map((s) => ({
    ...s,
    symbols: s.symbols.filter((sym) => symbolSet.has(sym)),
  }));

  const inSections = new Set(cleaned.flatMap((s) => s.symbols));
  const newSyms = symbols.filter((sym) => !inSections.has(sym));

  if (newSyms.length === 0) return cleaned;

  if (cleaned.length === 0) return [createSection("Watchlist", newSyms)];

  return [{ ...cleaned[0], symbols: [...cleaned[0].symbols, ...newSyms] }, ...cleaned.slice(1)];
}
