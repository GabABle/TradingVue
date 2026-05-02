import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Bot, User, Loader2, MessageSquare, Trash2 } from "lucide-react";

interface Message {
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
}

interface ChatContext {
  symbol?: string;
  range?: string;
  interval?: string;
  showRSI?: boolean;
  showDPO?: boolean;
  smaPeriod?: number | null;
  emaPeriod?: number | null;
}

interface ChatPanelProps {
  context?: ChatContext;
}

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";

// ── Inline markdown → React nodes ────────────────────────────────────────────
// Handles: **bold**, *italic*, `code`, links; leaves everything else as text.
function renderInline(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const re = /(\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[2] !== undefined) nodes.push(<strong key={m.index} className="font-semibold text-[#e0e3ea]">{m[2]}</strong>);
    else if (m[3] !== undefined) nodes.push(<em key={m.index} className="italic text-[#c0c3cc]">{m[3]}</em>);
    else if (m[4] !== undefined) nodes.push(<code key={m.index} className="bg-[#0f131d] text-[#82aaff] px-1 rounded font-mono text-[10px]">{m[4]}</code>);
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

// Renders assistant markdown as properly typed React elements (no raw symbols shown).
function MarkdownMessage({ content, streaming }: { content: string; streaming?: boolean }) {
  if (!content) return null;

  const blocks: React.ReactNode[] = [];
  const lines = content.split("\n");
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i];
    const trimmed = raw.trim();

    // ── Headings ──
    const h3 = trimmed.match(/^###\s+(.*)/);
    const h2 = trimmed.match(/^##\s+(.*)/);
    const h1 = trimmed.match(/^#\s+(.*)/);

    if (h1) {
      blocks.push(
        <p key={i} className="font-bold text-[13px] text-[#e0e3ea] mt-2 mb-0.5 leading-snug">
          {renderInline(h1[1])}
        </p>
      );
      i++; continue;
    }
    if (h2) {
      blocks.push(
        <p key={i} className="font-semibold text-[12px] text-[#c8cbdc] mt-2 mb-0.5 leading-snug">
          {renderInline(h2[1])}
        </p>
      );
      i++; continue;
    }
    if (h3) {
      blocks.push(
        <p key={i} className="font-semibold text-[11px] text-[#a0a5bc] mt-1.5 mb-0.5 leading-snug">
          {renderInline(h3[1])}
        </p>
      );
      i++; continue;
    }

    // ── Horizontal rule ──
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      blocks.push(<hr key={i} className="border-[#2a2e39] my-2" />);
      i++; continue;
    }

    // ── Fenced code block ──
    if (trimmed.startsWith("```")) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      blocks.push(
        <pre key={i} className="bg-[#0a0e17] border border-[#2a2e39] rounded p-2 my-1.5 overflow-x-auto">
          <code className="text-[10px] font-mono text-[#82aaff] leading-relaxed">
            {codeLines.join("\n")}
          </code>
        </pre>
      );
      i++; continue;
    }

    // ── Unordered list block ──
    if (/^[-*•]\s/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*•]\s/.test(lines[i].trim())) {
        items.push(lines[i].trim().slice(2));
        i++;
      }
      blocks.push(
        <ul key={i} className="my-1 space-y-0.5 pl-3">
          {items.map((item, j) => (
            <li key={j} className="flex gap-1.5 leading-relaxed">
              <span className="text-[#2962ff] mt-0.5 shrink-0">·</span>
              <span>{renderInline(item)}</span>
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // ── Ordered list block ──
    if (/^\d+\.\s/.test(trimmed)) {
      const items: string[] = [];
      let num = 1;
      while (i < lines.length && /^\d+\.\s/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s/, ""));
        i++;
      }
      blocks.push(
        <ol key={i} className="my-1 space-y-0.5 pl-1">
          {items.map((item, j) => (
            <li key={j} className="flex gap-1.5 leading-relaxed">
              <span className="text-[#2962ff] font-mono text-[10px] shrink-0 mt-0.5 w-3 text-right">{j + num}.</span>
              <span>{renderInline(item)}</span>
            </li>
          ))}
        </ol>
      );
      num++;
      continue;
    }

    // ── Blank lines: small vertical gap ──
    if (trimmed === "") {
      blocks.push(<div key={i} className="h-1.5" />);
      i++; continue;
    }

    // ── Regular paragraph ──
    blocks.push(
      <p key={i} className="leading-relaxed">
        {renderInline(trimmed)}
      </p>
    );
    i++;
  }

  return (
    <div className="text-[11px] text-[#d1d4dc] space-y-px">
      {blocks}
      {streaming && (
        <span
          className="inline-block w-[2px] h-[13px] bg-[#2962ff] ml-0.5 align-middle rounded-full"
          style={{ animation: "blink 0.9s step-end infinite" }}
        />
      )}
    </div>
  );
}

// ── Chat component ────────────────────────────────────────────────────────────
export function ChatPanel({ context }: ChatPanelProps) {
  const [messages, setMessages]     = useState<Message[]>([]);
  const [input, setInput]           = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLTextAreaElement>(null);
  const abortRef  = useRef<AbortController | null>(null);

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || isStreaming) return;

    const userMsg: Message = { role: "user", content: text };
    const history = [...messages, userMsg];
    setMessages(history);
    setInput("");
    setIsStreaming(true);

    setMessages([...history, { role: "assistant", content: "", streaming: true }]);
    abortRef.current = new AbortController();

    try {
      const resp = await fetch(`${API_BASE}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abortRef.current.signal,
        body: JSON.stringify({
          messages: history.map(({ role, content }) => ({ role, content })),
          context,
        }),
      });

      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      if (!resp.body) throw new Error("No response body");

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let full = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const payload = JSON.parse(line.slice(6));
            if (payload.done) break;
            if (payload.content) {
              full += payload.content;
              setMessages((prev) => {
                const next = [...prev];
                next[next.length - 1] = { role: "assistant", content: full, streaming: true };
                return next;
              });
            }
          } catch { /* skip malformed */ }
        }
      }

      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = { role: "assistant", content: full };
        return next;
      });
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return;
      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = {
          role: "assistant",
          content: "Something went wrong. Please try again.",
        };
        return next;
      });
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
      inputRef.current?.focus();
    }
  }, [input, isStreaming, messages, context]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  const clearChat = () => {
    if (isStreaming) { abortRef.current?.abort(); setIsStreaming(false); }
    setMessages([]);
  };

  return (
    <>
      {/* Blink keyframe injected once */}
      <style>{`@keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }`}</style>

      <div className="flex flex-col h-full bg-[#131722]">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-[#2a2e39] shrink-0">
          <div className="flex items-center gap-1.5">
            <Bot className="w-3.5 h-3.5 text-[#2962ff]" />
            <span className="text-xs font-semibold text-[#d1d4dc] tracking-wide">AI ANALYST</span>
            {context?.symbol && (
              <span className="text-[10px] text-[#787b86] font-mono">· {context.symbol}</span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[9px] text-[#363b4e] font-mono">gpt-5.2</span>
            <button
              onClick={clearChat}
              title="Clear chat"
              className="w-5 h-5 flex items-center justify-center rounded hover:bg-[#2a2e39] text-[#787b86] hover:text-[#d1d4dc] transition-colors"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Messages */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto px-3 py-2 space-y-3 min-h-0 scrollbar-thin"
        >
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full gap-2">
              <MessageSquare className="w-6 h-6 text-[#2a2e39]" />
              <p className="text-[10px] text-[#787b86] text-center leading-relaxed">
                Ask about charts, indicators,<br />or market trends.
              </p>
              {context?.symbol && (
                <button
                  onClick={() => {
                    setInput(`Analyze ${context.symbol} based on the current chart.`);
                    inputRef.current?.focus();
                  }}
                  className="text-[10px] text-[#2962ff]/80 hover:text-[#2962ff] border border-[#2962ff]/20 hover:border-[#2962ff]/40 rounded px-2 py-1 transition-colors"
                >
                  Analyze {context.symbol}
                </button>
              )}
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={`flex gap-2 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
              {/* Avatar */}
              <div className={`shrink-0 w-5 h-5 rounded-full flex items-center justify-center mt-0.5 ${
                msg.role === "user" ? "bg-[#2962ff]/20" : "bg-[#1e222d]"
              }`}>
                {msg.role === "user"
                  ? <User className="w-3 h-3 text-[#2962ff]" />
                  : <Bot className="w-3 h-3 text-[#787b86]" />}
              </div>

              {/* Bubble */}
              <div className={`max-w-[85%] rounded-lg px-2.5 py-2 ${
                msg.role === "user"
                  ? "bg-[#2962ff]/15 text-[#d1d4dc] rounded-tr-sm text-[11px] leading-relaxed"
                  : "bg-[#1e222d] rounded-tl-sm"
              }`}>
                {msg.role === "user" ? (
                  msg.content
                ) : msg.content === "" && msg.streaming ? (
                  /* Waiting dots before first token */
                  <span className="inline-flex gap-0.5 items-center px-1 py-1">
                    <span className="w-1.5 h-1.5 bg-[#787b86] rounded-full animate-bounce [animation-delay:0ms]" />
                    <span className="w-1.5 h-1.5 bg-[#787b86] rounded-full animate-bounce [animation-delay:150ms]" />
                    <span className="w-1.5 h-1.5 bg-[#787b86] rounded-full animate-bounce [animation-delay:300ms]" />
                  </span>
                ) : (
                  <MarkdownMessage content={msg.content} streaming={msg.streaming} />
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Input */}
        <div className="px-3 py-2 border-t border-[#2a2e39] shrink-0">
          <div className="flex items-end gap-1.5 bg-[#1e222d] border border-[#2a2e39] rounded-lg px-2.5 py-1.5 focus-within:border-[#2962ff]/40 transition-colors">
            <textarea
              ref={inputRef}
              rows={1}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = Math.min(e.target.scrollHeight, 80) + "px";
              }}
              onKeyDown={handleKeyDown}
              placeholder="Ask about this chart…"
              disabled={isStreaming}
              className="flex-1 bg-transparent text-[11px] text-[#d1d4dc] placeholder-[#787b86] resize-none outline-none leading-relaxed min-h-[20px] max-h-20 disabled:opacity-50"
              style={{ overflow: "hidden" }}
            />
            <button
              onClick={sendMessage}
              disabled={!input.trim() || isStreaming}
              className="shrink-0 w-6 h-6 flex items-center justify-center rounded-md bg-[#2962ff] hover:bg-[#1e4fd8] disabled:opacity-40 disabled:cursor-not-allowed transition-colors mb-0.5"
            >
              {isStreaming
                ? <Loader2 className="w-3 h-3 text-white animate-spin" />
                : <Send className="w-3 h-3 text-white" />}
            </button>
          </div>
          <p className="text-[9px] text-[#787b86]/50 mt-1 text-center">Enter · Shift+Enter for newline</p>
        </div>
      </div>
    </>
  );
}
