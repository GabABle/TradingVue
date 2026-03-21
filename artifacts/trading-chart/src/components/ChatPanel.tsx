import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Bot, User, Loader2, MessageSquare, ChevronDown, Trash2 } from "lucide-react";

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
  showStoch?: boolean;
  smaPeriod?: number | null;
  emaPeriod?: number | null;
}

interface ChatPanelProps {
  context?: ChatContext;
}

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";

export function ChatPanel({ context }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput]       = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const scrollRef  = useRef<HTMLDivElement>(null);
  const inputRef   = useRef<HTMLTextAreaElement>(null);
  const abortRef   = useRef<AbortController | null>(null);

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || isStreaming) return;

    const userMsg: Message = { role: "user", content: text };
    const updatedHistory = [...messages, userMsg];
    setMessages(updatedHistory);
    setInput("");
    setIsStreaming(true);

    const assistantPlaceholder: Message = { role: "assistant", content: "", streaming: true };
    setMessages([...updatedHistory, assistantPlaceholder]);

    abortRef.current = new AbortController();

    try {
      const resp = await fetch(`${API_BASE}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abortRef.current.signal,
        body: JSON.stringify({
          messages: updatedHistory.map(({ role, content }) => ({ role, content })),
          context,
        }),
      });

      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      if (!resp.body) throw new Error("No response body");

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullContent = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const payload = JSON.parse(line.slice(6));
            if (payload.done) break;
            if (payload.content) {
              fullContent += payload.content;
              setMessages((prev) => {
                const next = [...prev];
                next[next.length - 1] = {
                  role: "assistant",
                  content: fullContent,
                  streaming: true,
                };
                return next;
              });
            }
          } catch {
            // skip malformed SSE lines
          }
        }
      }

      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = { role: "assistant", content: fullContent };
        return next;
      });
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return;
      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = {
          role: "assistant",
          content: "Sorry, something went wrong. Please try again.",
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
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const clearChat = () => {
    if (isStreaming) {
      abortRef.current?.abort();
      setIsStreaming(false);
    }
    setMessages([]);
  };

  return (
    <div className="flex flex-col h-full bg-[#131722] border-t border-[#2a2e39]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-[#2a2e39] shrink-0">
        <div className="flex items-center gap-1.5">
          <Bot className="w-3.5 h-3.5 text-[#2962ff]" />
          <span className="text-xs font-semibold text-[#d1d4dc] tracking-wide">AI ANALYST</span>
          {context?.symbol && (
            <span className="text-[10px] text-[#787b86] font-mono ml-1">{context.symbol}</span>
          )}
        </div>
        <button
          onClick={clearChat}
          title="Clear chat"
          className="w-5 h-5 flex items-center justify-center rounded hover:bg-[#2a2e39] text-[#787b86] hover:text-[#d1d4dc] transition-colors"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-3 py-2 space-y-3 scrollbar-thin min-h-0"
      >
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-2 pb-2">
            <MessageSquare className="w-7 h-7 text-[#2a2e39]" />
            <p className="text-[11px] text-[#787b86] text-center leading-relaxed">
              Ask me about charts,<br />indicators, or market trends.
            </p>
            {context?.symbol && (
              <button
                onClick={() => {
                  setInput(`Analyze ${context.symbol} for me based on the current chart.`);
                  inputRef.current?.focus();
                }}
                className="mt-1 text-[10px] text-[#2962ff]/80 hover:text-[#2962ff] transition-colors border border-[#2962ff]/20 hover:border-[#2962ff]/40 rounded px-2 py-1"
              >
                Analyze {context.symbol}
              </button>
            )}
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-2 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
            <div className={`shrink-0 w-5 h-5 rounded-full flex items-center justify-center mt-0.5 ${
              msg.role === "user" ? "bg-[#2962ff]/20" : "bg-[#2a2e39]"
            }`}>
              {msg.role === "user"
                ? <User className="w-3 h-3 text-[#2962ff]" />
                : <Bot className="w-3 h-3 text-[#787b86]" />
              }
            </div>
            <div className={`max-w-[85%] rounded-lg px-2.5 py-2 text-[11px] leading-relaxed ${
              msg.role === "user"
                ? "bg-[#2962ff]/15 text-[#d1d4dc] rounded-tr-sm"
                : "bg-[#1e222d] text-[#d1d4dc] rounded-tl-sm"
            }`}>
              {msg.content || (msg.streaming && (
                <span className="inline-flex gap-0.5 items-center">
                  <span className="w-1 h-1 bg-[#787b86] rounded-full animate-bounce [animation-delay:0ms]" />
                  <span className="w-1 h-1 bg-[#787b86] rounded-full animate-bounce [animation-delay:150ms]" />
                  <span className="w-1 h-1 bg-[#787b86] rounded-full animate-bounce [animation-delay:300ms]" />
                </span>
              ))}
              {msg.streaming && msg.content && (
                <span className="inline-block w-0.5 h-3 bg-[#2962ff] animate-pulse ml-0.5 align-middle" />
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Scroll to bottom hint */}
      {messages.length > 3 && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-16 right-2 w-6 h-6 rounded-full bg-[#2a2e39] border border-[#363b4e] flex items-center justify-center hover:bg-[#363b4e] transition-colors"
          style={{ position: "relative" }}
        >
          <ChevronDown className="w-3 h-3 text-[#787b86]" />
        </button>
      )}

      {/* Input */}
      <div className="px-3 py-2.5 border-t border-[#2a2e39] shrink-0">
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
            className="flex-1 bg-transparent text-[11px] text-[#d1d4dc] placeholder-[#787b86] resize-none outline-none leading-relaxed min-h-[20px] max-h-20 disabled:opacity-50 scrollbar-none"
            style={{ overflow: "hidden" }}
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || isStreaming}
            className="shrink-0 w-6 h-6 flex items-center justify-center rounded-md bg-[#2962ff] hover:bg-[#1e4fd8] disabled:opacity-40 disabled:cursor-not-allowed transition-colors mb-0.5"
          >
            {isStreaming
              ? <Loader2 className="w-3 h-3 text-white animate-spin" />
              : <Send className="w-3 h-3 text-white" />
            }
          </button>
        </div>
        <p className="text-[9px] text-[#787b86]/60 mt-1 text-center">Enter to send · Shift+Enter for newline</p>
      </div>
    </div>
  );
}
