import { useState, type FormEvent } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { TrendingUp, User, Lock, Eye, EyeOff, AlertCircle } from "lucide-react";

type Mode = "login" | "register";

export default function LoginPage() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (!username.trim() || !password) { setError("Please fill in all fields."); return; }

    setLoading(true);
    try {
      if (mode === "login") await login(username.trim(), password);
      else await register(username.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-screen bg-[#0a0e17] flex items-center justify-center p-4">
      {/* Subtle grid background */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(41,98,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(41,98,255,0.03)_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none" />

      <div className="relative w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-12 h-12 rounded-xl bg-[#2962ff]/20 border border-[#2962ff]/30 flex items-center justify-center mb-3">
            <TrendingUp className="w-6 h-6 text-[#2962ff]" />
          </div>
          <h1 className="text-2xl font-bold text-[#d1d4dc] tracking-tight">TradingVue</h1>
          <p className="text-[#4c525e] text-sm mt-1">Professional market charts</p>
        </div>

        {/* Card */}
        <div className="bg-[#1e222d] border border-[#2a2e39] rounded-2xl shadow-2xl p-7">

          {/* Mode toggle */}
          <div className="flex bg-[#131722] border border-[#2a2e39] rounded-lg p-0.5 mb-6">
            {(["login", "register"] as Mode[]).map(m => (
              <button
                key={m}
                type="button"
                onClick={() => { setMode(m); setError(""); }}
                className={`flex-1 py-2 text-xs font-semibold rounded-md transition-all duration-150 capitalize ${
                  mode === m
                    ? "bg-[#2962ff] text-white shadow-sm"
                    : "text-[#787b86] hover:text-[#d1d4dc]"
                }`}
              >
                {m === "login" ? "Sign In" : "Create Account"}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Username */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[#787b86] uppercase tracking-wider">Username</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#4c525e]" />
                <input
                  type="text"
                  autoComplete="username"
                  autoFocus
                  placeholder="your_username"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  className="w-full bg-[#131722] border border-[#2a2e39] focus:border-[#2962ff] rounded-lg pl-10 pr-4 py-2.5 text-sm text-[#d1d4dc] placeholder-[#4c525e] outline-none transition-colors"
                />
              </div>
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[#787b86] uppercase tracking-wider">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#4c525e]" />
                <input
                  type={showPw ? "text" : "password"}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  placeholder={mode === "register" ? "Min. 6 characters" : "••••••••"}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full bg-[#131722] border border-[#2a2e39] focus:border-[#2962ff] rounded-lg pl-10 pr-10 py-2.5 text-sm text-[#d1d4dc] placeholder-[#4c525e] outline-none transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPw(p => !p)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#4c525e] hover:text-[#787b86] transition-colors"
                >
                  {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-center gap-2 text-xs text-[#ef5350] bg-[#ef5350]/10 border border-[#ef5350]/20 rounded-lg px-3 py-2.5">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                {error}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-[#2962ff] hover:bg-[#1e53e5] disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-colors mt-2"
            >
              {loading
                ? (mode === "login" ? "Signing in…" : "Creating account…")
                : (mode === "login" ? "Sign In" : "Create Account")
              }
            </button>
          </form>

          {mode === "register" && (
            <p className="text-[10px] text-[#4c525e] text-center mt-4 leading-relaxed">
              Username: 3–50 chars, letters / numbers / _ . - only
            </p>
          )}
        </div>

        <p className="text-center text-[10px] text-[#4c525e] mt-4">
          Your data stays private and secure
        </p>
      </div>
    </div>
  );
}
