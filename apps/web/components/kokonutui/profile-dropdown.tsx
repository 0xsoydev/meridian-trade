"use client";

/**
 * Adapted from KokonutUI's Account Menu (profile-dropdown v2.0.0, MIT).
 * Trimmed for this venue: markets are the accounts, no status/theme/account pages.
 * https://kokonutui.com/docs/navigation/profile-dropdown
 */

import { Check, ChevronsUpDown } from "lucide-react";
import {
  animate,
  motion,
  type Transition,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
} from "motion/react";
import Link from "next/link";
import {
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/utils";

export interface ProfileAccount {
  id: string;
  name: string;
  email: string;
  /** Shown in the avatar. Defaults to the first letters of `name`. */
  initials?: string;
  /** Plain label shown in the menu header, such as "Spot". */
  plan?: string;
}

export interface ProfileMenuItem {
  label: string;
  icon?: ReactNode;
  /** Quiet text on the right, such as a price or a shortcut. */
  value?: string;
  /** Renders the item as a link. Without it the item is a button. */
  href?: string;
  onSelect?: () => void;
}

interface ProfileDropdownProps {
  accounts?: ProfileAccount[];
  defaultAccountId?: string;
  onAccountChange?: (account: ProfileAccount) => void;
  /** Menu entries after the market list. */
  items?: ProfileMenuItem[];
  /** Quiet label + value row at the top of the menu, such as the balance. */
  info?: { label: string; value: string };
  badge?: string;
  className?: string;
}

const AVATAR_TONES = [
  "bg-[#1E1E1E] text-white",
  "bg-[#F5F5F5] text-[#1E1E1E] ring-1 ring-[#CECECE] ring-inset",
  "bg-[#1743FF]/10 text-[#1743FF]",
];

const WHITESPACE = /\s+/;
const PANEL_W = 288;
const RADIUS = 10;
const SPRING: Transition = { type: "spring", duration: 0.3, bounce: 0 };
const INSTANT: Transition = { duration: 0 };
const EASE_OUT = [0.23, 1, 0.32, 1] as const;
const NAV_KEYS = new Set(["ArrowDown", "ArrowUp", "Home", "End"]);

const ITEM_CLASS =
  "flex w-full cursor-default items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-left text-[13px] text-[#1E1E1E] outline-none transition-colors duration-100 focus:bg-[#F5F5F5]";

type Phase = "closed" | "open" | "closing";
type Via = "pointer" | "keyboard";

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

const FALLBACK_ACCOUNT: ProfileAccount = { id: "loading", name: "loading models…", email: "" };

function initialsOf(account: ProfileAccount): string {
  if (account.initials) {
    return account.initials;
  }
  return account.name
    .split(WHITESPACE)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase();
}

function viaOf(event: MouseEvent): Via {
  // A click fired by Enter or Space carries no pointer detail.
  return event.detail === 0 ? "keyboard" : "pointer";
}

function menuItems(root: HTMLElement | null): HTMLElement[] {
  if (!root) {
    return [];
  }
  return Array.from(root.querySelectorAll<HTMLElement>("[data-menu-item]"));
}

function nextTarget(items: HTMLElement[], active: Element | null, key: string): HTMLElement | undefined {
  if (key === "Home") {
    return items[0];
  }
  if (key === "End") {
    return items.at(-1);
  }
  const current = items.find((item) => item === active);
  if (!current) {
    return key === "ArrowUp" ? items.at(-1) : items[0];
  }
  const index = items.indexOf(current);
  const step = key === "ArrowDown" ? 1 : -1;
  return items[(index + step + items.length) % items.length];
}

function Avatar({
  account,
  tone,
  className,
}: {
  account: ProfileAccount;
  tone: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative grid shrink-0 select-none place-items-center rounded-full font-medium text-[11px] tracking-wide",
        AVATAR_TONES[tone % AVATAR_TONES.length],
        className,
      )}
    >
      {initialsOf(account)}
    </span>
  );
}

/**
 * The avatar, name and email. Rendered in the trigger while the menu is
 * closed and in the menu header while it is open; shared layout ids let the
 * three pieces travel between the two places.
 */
function Identity({
  uid,
  shared,
  account,
  tone,
  transition,
  stacked,
}: {
  uid: string;
  shared: boolean;
  account: ProfileAccount;
  tone: number;
  transition: Transition;
  stacked: boolean;
}) {
  const hidden = shared ? undefined : "invisible";
  const travel = (id: string) => (shared ? { layoutId: `${uid}-${id}` } : {});
  return (
    <span className={cn("flex min-w-0", stacked ? "flex-col items-start gap-3" : "items-center gap-2.5")}>
      <motion.span
        className={cn("relative z-20 block", hidden)}
        key={shared ? "avatar-shared" : "avatar-static"}
        transition={transition}
        {...travel("avatar")}
      >
        <Avatar account={account} className={stacked ? "h-10 w-10" : "h-8 w-8"} tone={tone} />
      </motion.span>
      <span className="flex min-w-0 flex-col text-left">
        <motion.span
          className={cn(
            "relative z-20 block truncate text-[14px] leading-5 font-semibold text-[#1E1E1E]",
            hidden,
          )}
          key={shared ? "name-shared" : "name-static"}
          transition={transition}
          {...travel("name")}
        >
          {account.name}
        </motion.span>
        <motion.span
          className={cn("relative z-20 block truncate text-[11px] leading-4 text-[#757575]", hidden)}
          key={shared ? "email-shared" : "email-static"}
          transition={transition}
          {...travel("email")}
        >
          {account.email}
        </motion.span>
      </span>
    </span>
  );
}

function Separator() {
  return <hr className="mx-2.5 my-1.5 h-px border-0 bg-[#EBEBEB]" />;
}

function LinkItem({
  item,
  onSelect,
}: {
  item: ProfileMenuItem;
  onSelect: (event: MouseEvent, run?: () => void) => void;
}) {
  const inner = (
    <>
      <span className="text-[#757575]">{item.icon}</span>
      <span className="flex-1">{item.label}</span>
      {item.value ? <span className="text-[11px] text-[#757575]">{item.value}</span> : null}
    </>
  );
  const common = {
    className: ITEM_CLASS,
    "data-menu-item": "",
    onClick: (event: MouseEvent) => onSelect(event, item.onSelect),
    role: "menuitem",
    tabIndex: -1,
  } as const;
  if (item.href) {
    return (
      <Link {...common} href={item.href}>
        {inner}
      </Link>
    );
  }
  return (
    <button {...common} type="button">
      {inner}
    </button>
  );
}

export default function ProfileDropdown({
  accounts = [],
  defaultAccountId,
  onAccountChange,
  items = [],
  info,
  badge = "spot",
  className,
}: ProfileDropdownProps) {
  const uid = useId();
  const reduced = useReducedMotion() === true;
  const [phase, setPhase] = useState<Phase>("closed");
  const [instant, setInstant] = useState(false);
  const [openSeq, setOpenSeq] = useState(0);
  const [accountId, setAccountId] = useState(defaultAccountId ?? accounts[0]?.id);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const phaseRef = useRef<Phase>("closed");
  phaseRef.current = phase;
  const openIntent = useRef<{ focus: "first" | "last" | "menu"; resume: boolean }>({
    focus: "menu",
    resume: false,
  });
  const closeSeq = useRef(0);
  const targetH = useRef(0);

  // The panel's visible box. The two surface layers (border and fill) and the
  // content all clip to it, so the menu grows out of the trigger's own
  // rectangle without any layout work per frame.
  const w = useMotionValue(0);
  const h = useMotionValue(0);
  const bodyOpacity = useMotionValue(1);
  const outerClip = useMotionTemplate`inset(0px 0px calc(100% - ${h}px) calc(100% - ${w}px) round ${RADIUS}px)`;
  const innerClip = useMotionTemplate`inset(1px 1px calc(100% - ${h}px + 1px) calc(100% - ${w}px + 1px) round ${RADIUS - 1}px)`;

  useEffect(() => {
    if (defaultAccountId) {
      setAccountId(defaultAccountId);
    }
  }, [defaultAccountId]);

  const account = accounts.find((entry) => entry.id === accountId) ?? accounts[0] ?? FALLBACK_ACCOUNT;
  const tone = Math.max(0, accounts.indexOf(account));
  const sharedTransition = instant ? INSTANT : SPRING;
  const sharedInPanel = phase === "open";
  const menuId = `${uid}-menu`;

  const openMenu = (via: Via, focus: "first" | "last" | "menu") => {
    if (phaseRef.current === "open") {
      return;
    }
    openIntent.current = { focus, resume: phaseRef.current === "closing" };
    closeSeq.current += 1;
    setInstant(via === "keyboard" || reduced);
    setPhase("open");
    setOpenSeq((seq) => seq + 1);
  };

  const closeMenu = (via: Via, returnFocus: boolean) => {
    if (phaseRef.current !== "open") {
      return;
    }
    const trigger = triggerRef.current;
    if (returnFocus) {
      trigger?.focus({ preventScroll: true });
    }
    if (via === "keyboard" || reduced || !trigger) {
      setInstant(true);
      setPhase("closed");
      return;
    }
    setInstant(false);
    setPhase("closing");
    const seq = ++closeSeq.current;
    animate(bodyOpacity, 0, { duration: 0.12, ease: EASE_OUT });
    animate(w, trigger.offsetWidth, SPRING);
    animate(h, trigger.offsetHeight, SPRING).then(() => {
      if (closeSeq.current === seq) {
        setPhase("closed");
      }
    });
  };

  const select = (event: MouseEvent, run?: () => void) => {
    run?.();
    closeMenu(viaOf(event), true);
  };

  // Opening: size the clip to the trigger, then spring it out to the menu.
  // A keyboard open skips straight to the end.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per open
  useIsoLayoutEffect(() => {
    const trigger = triggerRef.current;
    const main = mainRef.current;
    if (openSeq === 0 || phaseRef.current !== "open" || !trigger || !main) {
      return;
    }
    targetH.current = main.offsetHeight;
    if (instant) {
      w.jump(PANEL_W);
      h.jump(targetH.current);
      bodyOpacity.jump(1);
    } else {
      if (!openIntent.current.resume) {
        w.jump(trigger.offsetWidth);
        h.jump(trigger.offsetHeight);
        bodyOpacity.jump(0);
      }
      animate(w, PANEL_W, SPRING);
      animate(h, targetH.current, SPRING);
      animate(bodyOpacity, 1, { duration: 0.2, delay: 0.05, ease: EASE_OUT });
    }
    const list = menuItems(main);
    const focusOn = openIntent.current.focus;
    const target =
      focusOn === "first" ? list[0] : focusOn === "last" ? list.at(-1) : main.querySelector<HTMLElement>("[role=menu]");
    target?.focus({ preventScroll: true });
  }, [openSeq]);

  // Keep the height in step if the menu content changes size while open.
  useEffect(() => {
    if (phase !== "open") {
      return;
    }
    const observer = new ResizeObserver(() => {
      const el = mainRef.current;
      if (!el || phaseRef.current !== "open") {
        return;
      }
      const next = el.offsetHeight;
      if (Math.abs(next - targetH.current) < 0.5) {
        return;
      }
      targetH.current = next;
      animate(h, next, reduced ? INSTANT : SPRING);
    });
    if (mainRef.current) {
      observer.observe(mainRef.current);
    }
    return () => observer.disconnect();
  }, [phase, h, reduced]);

  // A press anywhere outside closes, with the morph.
  // biome-ignore lint/correctness/useExhaustiveDependencies: closeMenu reads refs
  useEffect(() => {
    if (phase !== "open") {
      return;
    }
    const onDown = (event: globalThis.PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        closeMenu("pointer", false);
      }
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [phase]);

  const onPanelKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      closeMenu("keyboard", true);
      return;
    }
    if (!NAV_KEYS.has(event.key)) {
      return;
    }
    event.preventDefault();
    const target = nextTarget(menuItems(mainRef.current), document.activeElement, event.key);
    if (target) {
      target.focus({ preventScroll: true });
    }
  };

  // Hovering an item focuses it, so pointer and keyboard share one highlight.
  const onPanelPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "mouse") {
      return;
    }
    const item = (event.target as HTMLElement).closest<HTMLElement>("[data-menu-item]");
    if (item && document.activeElement !== item) {
      item.focus({ preventScroll: true });
    }
  };

  return (
    <div
      className={cn("relative isolate inline-block", phase !== "closed" && "z-50", className)}
      ref={wrapperRef}
    >
      <button
        aria-controls={sharedInPanel ? menuId : undefined}
        aria-expanded={sharedInPanel}
        aria-haspopup="menu"
        className="flex w-64 items-center gap-2.5 rounded-[10px] bg-white p-2 pr-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-[#1743FF]/40"
        onClick={(event) => {
          const via = viaOf(event);
          openMenu(via, via === "keyboard" ? "first" : "menu");
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            openMenu("keyboard", event.key === "ArrowDown" ? "first" : "last");
          }
        }}
        ref={triggerRef}
        type="button"
      >
        <span className="min-w-0 flex-1">
          <Identity
            account={account}
            shared={!sharedInPanel}
            stacked={false}
            tone={tone}
            transition={sharedTransition}
            uid={uid}
          />
        </span>
        <span className="shrink-0 rounded-[6px] border border-[#CECECE] px-1.5 py-0.5 text-[11px] leading-none text-[#1E1E1E]">
          {badge}
        </span>
        <ChevronsUpDown
          aria-hidden="true"
          className={cn(
            "h-4 w-4 shrink-0 text-[#757575] transition-opacity duration-150",
            phase !== "closed" && "opacity-0",
          )}
        />
      </button>

      {phase === "closed" ? null : (
        <div className="pointer-events-none absolute top-0 left-0 z-10" style={{ width: PANEL_W }}>
          <div
            aria-hidden="true"
            className="absolute inset-0 [filter:drop-shadow(0_12px_24px_rgb(0_0_0/0.08))_drop-shadow(0_2px_4px_rgb(0_0_0/0.04))]"
          >
            <motion.div className="absolute inset-0 bg-[#CECECE]" style={{ clipPath: outerClip }} />
            <motion.div className="absolute inset-0 bg-white" style={{ clipPath: innerClip }} />
          </div>
          <motion.div
            className={cn("relative", sharedInPanel && "pointer-events-auto")}
            onKeyDown={onPanelKeyDown}
            onPointerMove={onPanelPointerMove}
            style={{ clipPath: innerClip }}
          >
            <div className="p-1.5" ref={mainRef} style={{ width: PANEL_W }}>
              <div className="flex items-start justify-between px-2.5 pt-2.5 pb-3">
                <Identity
                  account={account}
                  shared={sharedInPanel}
                  stacked
                  tone={tone}
                  transition={sharedTransition}
                  uid={uid}
                />
                {account.plan ? (
                  <motion.span
                    className="shrink-0 pt-0.5 text-[11px] text-[#757575]"
                    style={{ opacity: bodyOpacity }}
                  >
                    {account.plan}
                  </motion.span>
                ) : null}
              </div>
              <motion.div
                aria-label={account.name}
                className="outline-none"
                id={menuId}
                role="menu"
                style={{ opacity: bodyOpacity }}
                tabIndex={-1}
              >
                {info ? (
                  <div className="flex items-center justify-between px-2.5 py-1.5">
                    <span className="text-[13px] text-[#757575]">{info.label}</span>
                    <span className="text-[13px] tabular-nums text-[#1E1E1E]">{info.value}</span>
                  </div>
                ) : null}
                <Separator />
                <div className="max-h-[260px] overflow-y-auto">
                  {accounts.map((entry, index) => {
                    const checked = entry.id === account.id;
                    return (
                      <button
                        aria-checked={checked}
                        className={ITEM_CLASS}
                        data-menu-item=""
                        key={entry.id}
                        onClick={(event) => {
                          if (!checked) {
                            setAccountId(entry.id);
                            onAccountChange?.(entry);
                          }
                          closeMenu(viaOf(event), true);
                        }}
                        role="menuitemradio"
                        tabIndex={-1}
                        type="button"
                      >
                        <Avatar account={entry} className="h-7 w-7" tone={index} />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate font-medium text-[#1E1E1E]">{entry.name}</span>
                          <span className="truncate text-[11px] text-[#757575]">{entry.email}</span>
                        </span>
                        {checked ? <Check className="h-4 w-4 text-[#1743FF]" /> : null}
                      </button>
                    );
                  })}
                </div>
                {accounts.length === 0 ? (
                  <p className="px-2.5 py-2 text-[13px] text-[#757575]">loading models…</p>
                ) : null}
                {items.length > 0 ? <Separator /> : null}
                {items.map((item) => (
                  <LinkItem item={item} key={item.label} onSelect={select} />
                ))}
              </motion.div>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
