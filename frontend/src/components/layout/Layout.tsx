import { useEffect, useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import {
  Activity, Radar, LayoutGrid, Wallet, Settings, Search, NotebookPen,
  Moon, Sun, ChevronsLeft, LineChart, Menu, X,
  Star, FileText, Swords, LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useDarkMode } from "@/hooks/useDarkMode";
import { storageGet, storageSet } from "@/lib/storage";
import { AUTH_LOGOUT_EVENT } from "@/components/auth/AuthGate";

const APP_VERSION = "v0.3.0";

const NAV = [
  { to: "/daily-review", icon: Activity, label: "每日复盘" },
  { to: "/watchlist", icon: Star, label: "自选股" },
  { to: "/stock-data", icon: Search, label: "标的数据" },
  { to: "/intel", icon: Radar, label: "资讯雷达" },
  { to: "/debate", icon: Swords, label: "多空辩论" },
  { to: "/portfolio", icon: Wallet, label: "我的持仓" },
  { to: "/sectors", icon: LayoutGrid, label: "板块中心" },
  { to: "/my-reports", icon: FileText, label: "我的研报" },
  { to: "/notes", icon: NotebookPen, label: "研究记录" },
  { to: "/settings", icon: Settings, label: "接入 AI" },
];

export function Layout() {
  const { pathname } = useLocation();
  const { dark, toggle } = useDarkMode();
  const [collapsed, setCollapsed] = useState(() => storageGet("vr-sidebar") === "collapsed");
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    storageSet("vr-sidebar", collapsed ? "collapsed" : "expanded");
  }, [collapsed]);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [mobileOpen]);

  return (
    <div className="flex h-[100dvh] md:flex-row">
      {mobileOpen && <button type="button" aria-label="关闭导航菜单" onClick={() => setMobileOpen(false)} className="fixed inset-0 z-40 bg-black/55 backdrop-blur-[1px] md:hidden" />}

      {/* Sidebar */}
      <aside id="app-navigation" className={cn(
        "glass fixed inset-y-2 left-2 z-50 flex w-72 flex-col rounded-2xl transition-[transform,width,opacity,margin] duration-200 md:static md:z-10 md:m-2 md:h-auto md:shrink-0 md:translate-x-0",
        mobileOpen ? "translate-x-0" : "-translate-x-[calc(100%+1rem)]",
        collapsed ? "md:m-0 md:w-0 md:overflow-hidden md:border-0 md:opacity-0 md:pointer-events-none" : "md:w-60",
      )}>
        {/* Brand */}
        <div className="border-b border-border/50 p-4">
          <div className="flex items-center gap-2">
            <Link to="/daily-review" className="flex min-w-0 items-center gap-2">
              <LineChart className="h-6 w-6 shrink-0 text-primary text-glow" />
              <span className="truncate text-lg font-extrabold tracking-tight">
                Vibe-<span className="text-primary">Research</span>
              </span>
            </Link>
            <button type="button" onClick={() => setMobileOpen(false)} className="ml-auto rounded-lg p-2 text-muted-foreground hover:bg-muted/50 hover:text-foreground md:hidden" aria-label="关闭导航菜单">
              <X className="h-5 w-5" />
            </button>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">个人 AI 投研系统 · 股票/加密货币</p>
        </div>

        {/* Nav */}
        <nav className="flex-1 space-y-1 overflow-auto p-2.5">
          {NAV.map(({ to, icon: Icon, label }) => {
            const active = pathname === to;
            return (
              <div key={to}>
                <Link
                  to={to}
                  className={cn(
                    "flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm transition-colors",
                    active
                      ? "bg-primary/15 font-medium text-primary shadow-glow"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{label}</span>
                </Link>

              </div>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="space-y-2 border-t border-border/50 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="flex items-center justify-between">
            <button onClick={toggle} className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground">
              {dark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
              {dark ? "亮色" : "暗色"}
            </button>
            <div className="flex items-center gap-2">
              <button onClick={() => window.dispatchEvent(new Event(AUTH_LOGOUT_EVENT))} className="text-muted-foreground transition-colors hover:text-foreground" title="退出登录">
                <LogOut className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => setMobileOpen(false)} className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground md:hidden" title="关闭">
                <X className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => setCollapsed(true)} className="hidden rounded p-1 text-muted-foreground transition-colors hover:text-foreground md:block" title="隐藏侧栏">
                <ChevronsLeft className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground/60">
            {APP_VERSION} · 不荐股 · 不预测 · 无倾向
          </p>
        </div>
      </aside>

      {/* Main */}
      <main className="min-h-0 w-full flex-1 overflow-auto">
        <div className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b border-border/40 bg-background/90 px-3 backdrop-blur md:hidden">
          <button type="button" onClick={() => setMobileOpen(true)} aria-controls="app-navigation" aria-expanded={mobileOpen} className="rounded-lg p-2 text-muted-foreground hover:bg-muted/50 hover:text-foreground" aria-label="打开导航菜单">
            <Menu className="h-5 w-5" />
          </button>
          <span className="text-sm font-semibold">Vibe-<span className="text-primary">Research</span></span>
        </div>
        {collapsed && <button type="button" onClick={() => setCollapsed(false)} className="fixed left-3 top-3 z-40 hidden items-center gap-1.5 rounded-lg border border-border/70 bg-background/90 px-2.5 py-2 text-xs text-muted-foreground shadow-lg backdrop-blur hover:text-foreground md:inline-flex" aria-label="显示侧栏">
          <Menu className="h-4 w-4" />菜单
        </button>}
        <div className={cn("mx-auto px-3 py-4 transition-[max-width] sm:px-4 md:px-6 md:py-6", collapsed ? "max-w-[1440px]" : "max-w-6xl")}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}
