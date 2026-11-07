import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface SidebarItem {
  icon?: ReactNode;
  label: string;
  active?: boolean;
  badge?: string | number;
}

interface BrowserWindowProps {
  children?: ReactNode;
  className?: string;
  showSidebar?: boolean;
  sidebarPosition?: "left" | "right" | "top" | "bottom";
  headerStyle?: "minimal" | "full";
  variant?: "chrome" | "safari" | "generic";
  url?: string;
  sidebarItems?: SidebarItem[];
}

function WindowControls({ variant = "chrome", headerStyle = "full" }: { variant?: "chrome" | "safari" | "generic"; headerStyle?: "minimal" | "full" }) {
  const dot = "size-2 rounded-full border border-black/20 transition-colors";
  const colours =
    headerStyle === "minimal"
      ? ["bg-[#E4E4E4]", "bg-[#E4E4E4]", "bg-[#E4E4E4]"]
      : [variant === "chrome" ? "bg-red-500" : "bg-[#F5F5F5]", "bg-yellow-500", "bg-green-500"];
  return (
    <div className="flex gap-2">
      {colours.map((colour) => (
        <div key={colour} className={cn(dot, colour)} />
      ))}
    </div>
  );
}

function AddressBar({ url, variant = "chrome" }: { url: string; variant?: "chrome" | "safari" }) {
  return (
    <div className="flex flex-1 justify-center">
      <div
        className={cn(
          "flex max-w-md min-w-[200px] items-center gap-2 border border-[#E4E4E4] bg-[#F7F7F7] px-4 py-1.5 text-xs text-[#757575]",
          variant === "chrome" ? "rounded-full" : "rounded-[8px]",
        )}
      >
        <svg viewBox="0 0 12 12" fill="currentColor" className="h-3 w-3 text-[#A3A3A3]">
          <path d="M6 1a2.5 2.5 0 0 1 2.5 2.5V5h.5a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h.5V3.5A2.5 2.5 0 0 1 6 1z" />
        </svg>
        <span className="truncate">{url}</span>
      </div>
    </div>
  );
}

function SidebarContent({ items = [] }: { items?: SidebarItem[] | undefined }) {
  return (
    <div className="space-y-1 p-3">
      {items.map((item, index) => (
        <div
          key={`${item.label}-${index}`}
          className={cn(
            "flex items-center gap-2 rounded px-2 py-1.5 text-sm",
            item.active ? "border border-[#1743FF]/10 bg-[#1743FF]/5 text-[#1743FF]" : "text-[#757575]",
          )}
        >
          {item.icon ? <div className="h-4 w-4 flex-shrink-0">{item.icon}</div> : null}
          <span className="flex-1 truncate">{item.label}</span>
          {item.badge ? (
            <span className="min-w-[16px] rounded-full bg-[#1743FF]/5 px-1.5 py-0.5 text-center text-xs text-[#1743FF]">
              {item.badge}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function BrowserWindow({
  children,
  className,
  showSidebar = false,
  sidebarPosition = "left",
  headerStyle = "minimal",
  variant = "generic",
  url = "https://meridian.trade",
  sidebarItems,
}: BrowserWindowProps) {
  const chrome = variant === "chrome" || variant === "generic";
  return (
    <div
      className={cn(
        "relative flex h-full w-full flex-col overflow-hidden rounded-2xl border border-[#D9D9D9] bg-white text-[#1E1E1E] shadow-[0_24px_60px_-24px_rgba(0,0,0,0.35)]",
        className,
      )}
    >
      <div
        className={cn(
          "flex h-11 flex-shrink-0 items-center border-b border-[#ECECEC] px-4",
          chrome ? "bg-[#F5F5F5]" : "bg-[#F7F7F7]",
        )}
      >
        <WindowControls variant={variant} headerStyle={headerStyle} />
        {headerStyle === "full" ? (
          <AddressBar url={url} variant={chrome ? "chrome" : "safari"} />
        ) : null}
      </div>

      {showSidebar && sidebarPosition === "top" ? (
        <div className="h-16 flex-shrink-0 border-b border-[#ECECEC] bg-[#F7F7F7]">
          <SidebarContent items={sidebarItems} />
        </div>
      ) : null}

      <div className="flex h-0 flex-1">
        {showSidebar && sidebarPosition === "left" ? (
          <div className="h-full w-48 flex-shrink-0 border-r border-[#ECECEC] bg-[#F7F7F7]">
            <SidebarContent items={sidebarItems} />
          </div>
        ) : null}

        <div className="relative h-full min-w-0 flex-1">{children}</div>

        {showSidebar && sidebarPosition === "right" ? (
          <div className="h-full w-48 flex-shrink-0 border-l border-[#ECECEC] bg-[#F7F7F7]">
            <SidebarContent items={sidebarItems} />
          </div>
        ) : null}
      </div>

      {showSidebar && sidebarPosition === "bottom" ? (
        <div className="h-16 flex-shrink-0 border-t border-[#ECECEC] bg-[#F7F7F7]">
          <SidebarContent items={sidebarItems} />
        </div>
      ) : null}
    </div>
  );
}
