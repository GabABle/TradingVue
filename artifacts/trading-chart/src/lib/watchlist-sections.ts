export interface WatchlistSection {
  id: string;
  name: string;
  symbols: string[];
  collapsed: boolean;
}

const STORAGE_KEY_V1 = "tradingTerminalWatchlistSections_v1";
const STORAGE_KEY    = "tradingTerminalWatchlistSections_v2";

export const DEFAULT_STOCKS: string[] = [
  "NVDA", "MU", "MSFT", "META", "SNDK", "AVGO", "PLTR", "TSM", "LITE", "INTC",
  "DUO", "AI", "SE", "UPST", "TSLA", "NFLX", "UBER", "DASH", "ADBE", "SNOW",
];

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

    const v1stored = localStorage.getItem(STORAGE_KEY_V1);
    if (v1stored) {
      const v1 = JSON.parse(v1stored);
      if (Array.isArray(v1) && v1.length > 0) {
        const stocksSet = new Set(DEFAULT_STOCKS);
        const migratedSections: WatchlistSection[] = v1.map((s: WatchlistSection) => ({
          ...s,
          symbols: s.symbols.filter((sym) => !stocksSet.has(sym)),
        }));
        const sections = [...migratedSections, createSection("Stocks", DEFAULT_STOCKS)];
        saveSections(sections);
        return sections;
      }
    }
  } catch { /* ignore */ }

  const stocksSet = new Set(DEFAULT_STOCKS);
  const watchlistSymbols = fallbackSymbols.filter((s) => !stocksSet.has(s));
  const sections: WatchlistSection[] = [];
  if (watchlistSymbols.length > 0) sections.push(createSection("Watchlist", watchlistSymbols));
  sections.push(createSection("Stocks", DEFAULT_STOCKS));
  return sections;
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

/** Add a symbol to the first section (no-op if already present anywhere). */
export function addSymbolToSections(sections: WatchlistSection[], symbol: string): WatchlistSection[] {
  if (sections.some((s) => s.symbols.includes(symbol))) return sections;
  if (sections.length === 0) return [createSection("Watchlist", [symbol])];
  return [{ ...sections[0], symbols: [...sections[0].symbols, symbol] }, ...sections.slice(1)];
}

/** Remove a symbol from all sections. */
export function removeSymbolFromSections(sections: WatchlistSection[], symbol: string): WatchlistSection[] {
  return sections.map((s) => ({ ...s, symbols: s.symbols.filter((sym) => sym !== symbol) }));
}
