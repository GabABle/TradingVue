import { useEffect, useState, useCallback } from "react";
import { Newspaper, ExternalLink, RefreshCw, AlertCircle } from "lucide-react";

interface NewsArticle {
  id: number;
  headline: string;
  source: string;
  url: string;
  publishedAt: string;
}

interface NewsPanelProps {
  symbol: string;
}

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function NewsPanel({ symbol }: NewsPanelProps) {
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(false);
  const [lastSymbol, setLastSymbol] = useState("");

  const fetchNews = useCallback(async (sym: string) => {
    setLoading(true);
    setError(false);
    try {
      const resp = await fetch(`${API_BASE}/market/news?symbol=${encodeURIComponent(sym)}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json() as { articles: NewsArticle[] };
      setArticles(data.articles ?? []);
      setLastSymbol(sym);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (symbol && symbol !== lastSymbol) {
      fetchNews(symbol);
    }
  }, [symbol, lastSymbol, fetchNews]);

  return (
    <div className="flex flex-col h-full bg-[#131722]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#2a2e39] shrink-0">
        <div className="flex items-center gap-1.5">
          <Newspaper className="w-3.5 h-3.5 text-[#787b86]" />
          <span className="text-xs font-semibold text-[#d1d4dc] tracking-wide">NEWS</span>
          <span className="text-[10px] text-[#787b86] font-mono">· {symbol}</span>
        </div>
        <button
          onClick={() => fetchNews(symbol)}
          disabled={loading}
          title="Refresh news"
          className="w-5 h-5 flex items-center justify-center rounded hover:bg-[#2a2e39] text-[#787b86] hover:text-[#d1d4dc] transition-colors disabled:opacity-40"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto scrollbar-thin min-h-0">
        {loading && articles.length === 0 && (
          <div className="flex flex-col gap-2 px-3 py-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="space-y-1.5 py-2 border-b border-[#2a2e39]/50 last:border-0">
                <div className="h-3 bg-[#2a2e39] rounded animate-pulse w-full" />
                <div className="h-3 bg-[#2a2e39] rounded animate-pulse w-3/4" />
                <div className="h-2.5 bg-[#2a2e39]/60 rounded animate-pulse w-1/3 mt-1" />
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center justify-center h-24 gap-1.5 px-3">
            <AlertCircle className="w-5 h-5 text-[#ef5350]/60" />
            <p className="text-[10px] text-[#787b86] text-center">Could not load news</p>
            <button
              onClick={() => fetchNews(symbol)}
              className="text-[10px] text-[#2962ff]/80 hover:text-[#2962ff] transition-colors"
            >
              Try again
            </button>
          </div>
        )}

        {!loading && !error && articles.length === 0 && lastSymbol && (
          <div className="flex flex-col items-center justify-center h-24 gap-1 px-3">
            <Newspaper className="w-5 h-5 text-[#2a2e39]" />
            <p className="text-[10px] text-[#787b86]">No recent news found</p>
          </div>
        )}

        {articles.length > 0 && (
          <div className="py-1">
            {articles.map((article, i) => (
              <a
                key={article.id ?? i}
                href={article.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex flex-col gap-1 px-3 py-2.5 border-b border-[#2a2e39]/50 last:border-0 hover:bg-[#1e222d]/70 transition-colors cursor-pointer"
              >
                <p className="text-[11px] text-[#c8cbdc] leading-snug group-hover:text-[#e0e3ea] transition-colors line-clamp-3">
                  {article.headline}
                  <ExternalLink className="inline-block w-2.5 h-2.5 ml-1 text-[#787b86] group-hover:text-[#2962ff] transition-colors align-baseline shrink-0" />
                </p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  {article.source && (
                    <span className="text-[9px] font-semibold text-[#787b86] uppercase tracking-wide truncate max-w-[100px]">
                      {article.source}
                    </span>
                  )}
                  {article.source && article.publishedAt && (
                    <span className="text-[9px] text-[#363b4e]">·</span>
                  )}
                  {article.publishedAt && (
                    <span className="text-[9px] text-[#787b86]/70 shrink-0">
                      {timeAgo(article.publishedAt)}
                    </span>
                  )}
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
