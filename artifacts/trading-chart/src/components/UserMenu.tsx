import { useState, useRef, useEffect } from "react";
import { User, LogOut, ChevronDown } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

export function UserMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [dropdownStyle, setDropdownStyle] = useState<{ top: number; right: number }>({ top: 0, right: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Position dropdown via fixed coords so it's never clipped by overflow:hidden ancestors
  useEffect(() => {
    if (open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setDropdownStyle({
        top: rect.bottom + 6,
        right: window.innerWidth - rect.right,
      });
    }
  }, [open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

  const initials = user?.username?.slice(0, 2).toUpperCase() ?? "?";

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={buttonRef}
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-[#2a2e39] transition-colors group"
        title={`Logged in as ${user?.username}`}
      >
        <div className="w-6 h-6 rounded-full bg-[#2962ff]/20 border border-[#2962ff]/40 flex items-center justify-center">
          <span className="text-[9px] font-bold text-[#2962ff]">{initials}</span>
        </div>
        <span className="text-xs text-[#787b86] group-hover:text-[#d1d4dc] transition-colors hidden sm:block max-w-[80px] truncate">
          {user?.username}
        </span>
        <ChevronDown className={`w-3 h-3 text-[#4c525e] transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          style={{ position: "fixed", top: dropdownStyle.top, right: dropdownStyle.right }}
          className="w-44 bg-[#1e222d] border border-[#2a2e39] rounded-lg shadow-2xl z-[9999] overflow-hidden"
        >
          <div className="px-3 py-2.5 border-b border-[#2a2e39]">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-[#2962ff]/20 border border-[#2962ff]/40 flex items-center justify-center shrink-0">
                <User className="w-3.5 h-3.5 text-[#2962ff]" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-[#d1d4dc] truncate">{user?.username}</p>
                <p className="text-[10px] text-[#4c525e]">Account</p>
              </div>
            </div>
          </div>
          <button
            onClick={() => { setOpen(false); logout(); }}
            className="w-full flex items-center gap-2 px-3 py-2.5 text-xs text-[#787b86] hover:text-[#ef5350] hover:bg-[#ef5350]/5 transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
