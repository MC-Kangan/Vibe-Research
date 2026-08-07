import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { LockKeyhole, Loader2, LogIn } from "lucide-react";
import { ApiError, api, type AuthSession } from "@/lib/api";

export const AUTH_LOGOUT_EVENT = "vibe-auth-logout";

function LoginScreen({ onLogin }: { onLogin: (session: AuthSession) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      onLogin(await api.authLogin(username, password));
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "登录失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-border bg-card/80 p-6 shadow-xl">
        <div className="mb-6 flex items-center gap-2">
          <LockKeyhole className="h-5 w-5 text-primary" />
          <div><h1 className="font-semibold">Vibe Research</h1><p className="text-xs text-muted-foreground">登录后访问投研与持仓数据</p></div>
        </div>
        <label className="mb-3 block text-sm"><span className="mb-1 block text-xs text-muted-foreground">用户名</span><input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2 outline-none focus:border-primary/60" /></label>
        <label className="mb-4 block text-sm"><span className="mb-1 block text-xs text-muted-foreground">密码</span><input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2 outline-none focus:border-primary/60" /></label>
        {error && <p className="mb-3 rounded-lg border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">{error}</p>}
        <button disabled={loading || !username || !password} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary/15 px-4 py-2 text-sm font-medium text-primary hover:bg-primary/25 disabled:opacity-50">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}登录</button>
      </form>
    </main>
  );
}

export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setError(null);
    api.authSession().then(setSession).catch((reason) => setError(reason instanceof ApiError ? reason.message : "无法检查登录状态"));
  };
  useEffect(() => {
    load();
    const logout = () => api.authLogout().finally(load);
    window.addEventListener(AUTH_LOGOUT_EVENT, logout);
    return () => window.removeEventListener(AUTH_LOGOUT_EVENT, logout);
  }, []);

  if (error) return <main className="flex min-h-screen items-center justify-center p-6 text-sm text-destructive">{error} <button onClick={load} className="ml-2 underline">重试</button></main>;
  if (!session) return <main className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">检查访问权限…</main>;
  if (session.enabled && !session.authenticated) return <LoginScreen onLogin={setSession} />;
  return <>{children}</>;
}
