import { useEffect, useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import {
  Activity, Radar, LayoutGrid, Wallet, Settings, Search, NotebookPen,
  Moon, Sun, ChevronsLeft, ChevronsRight, LineChart,
  Star, FileText, Swords, LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useDarkMode } from "@/hooks/useDarkMode";
import { storageGet, storageSet } from "@/lib/storage";
import { AUTH_LOGOUT_EVENT } from "@/components/auth/AuthGate";

const APP_VERSION = "v0.2.2";

const NAV = [
  { to: "/daily-review", icon: Activity, label: "每日复盘" },
  { to: "/watchlist", icon: Star, label: "自选股" },
  { to: "/stock-data", icon: Search, label: "个股数据" },
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

  useEffect(() => {
    storageSet("vr-sidebar", collapsed ? "collapsed" : "expanded");
  }, [collapsed]);

  return (
    <div className="flex h-[100dvh] flex-col md:flex-row">
      {/* Sidebar */}
      <aside className={cn(
        "glass z-10 order-2 mx-2 mb-2 flex h-16 w-auto shrink-0 flex-row rounded-2xl pb-[env(safe-area-inset-bottom)] transition-all duration-200 md:order-none md:m-2 md:h-auto md:flex-col md:pb-0",
        collapsed ? "md:w-14" : "md:w-60",
      )}>
        {/* Brand */}
        <div className={cn("hidden border-b border-border/50 md:block", collapsed ? "md:flex md:justify-center md:p-3" : "md:p-4")}>
          <Link to="/daily-review" className={cn("flex items-center", collapsed ? "justify-center" : "gap-2")}>
            <LineChart className="h-6 w-6 shrink-0 text-primary text-glow" />
            {!collapsed && (
              <span className="text-lg font-extrabold tracking-tight">
                Vibe-<span className="text-primary">Research</span>
              </span>
            )}
          </Link>
          {!collapsed && <p className="mt-1 text-[11px] text-muted-foreground">个人 AI 投研系统 · 美股/欧洲/A股</p>}
        </div>

        {/* Nav */}
        <nav className={cn("flex flex-1 items-center gap-1 overflow-x-auto p-1.5 md:block md:space-y-1 md:overflow-auto", collapsed ? "md:p-1.5" : "md:p-2.5")}>
          {NAV.map(({ to, icon: Icon, label }) => {
            const active = pathname === to;
            return (
              <div key={to}>
                <Link
                  to={to}
                  title={collapsed ? label : undefined}
                  className={cn(
                    "flex shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg px-2 py-1 text-[10px] transition-colors md:flex-row md:text-sm",
                    collapsed ? "md:p-2.5" : "md:justify-start md:gap-2.5 md:px-3 md:py-2.5",
                    active
                      ? "bg-primary/15 font-medium text-primary shadow-glow"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className={cn(collapsed && "md:hidden")}>{label}</span>
                </Link>

              </div>
            );
          })}
        </nav>

        {/* Footer */}
        <div className={cn("hidden border-t border-border/50 md:block", collapsed ? "md:flex md:flex-col md:items-center md:gap-2 md:p-2" : "md:space-y-2 md:p-3")}>
          {collapsed ? (
            <>
              <button onClick={toggle} className="rounded p-1.5 text-muted-foreground transition-colors hover:text-foreground" title={dark ? "亮色" : "暗色"}>
                {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </button>
              <button onClick={() => setCollapsed(false)} className="rounded p-1.5 text-muted-foreground transition-colors hover:text-foreground" title="展开">
                <ChevronsRight className="h-4 w-4" />
              </button>
            </>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <button onClick={toggle} className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground">
                  {dark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
                  {dark ? "亮色" : "暗色"}
                </button>
                <div className="flex items-center gap-2">
                  <button onClick={() => window.dispatchEvent(new Event(AUTH_LOGOUT_EVENT))} className="text-muted-foreground transition-colors hover:text-foreground" title="退出登录">
                    <LogOut className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => setCollapsed(true)} className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground" title="收起">
                    <ChevronsLeft className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground/60">
                {APP_VERSION} · 不荐股 · 不预测 · 无倾向
              </p>
            </>
          )}
        </div>
      </aside>

      {/* Main */}
      <main className="order-1 min-h-0 w-full flex-1 overflow-auto md:order-none">
        <div className="mx-auto max-w-6xl px-3 py-4 sm:px-4 md:px-6 md:py-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
