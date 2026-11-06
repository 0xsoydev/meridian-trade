"use client";

/**
 * Adapted from Cult UI's Terminal Animation (MIT).
 * https://www.cult-ui.com/docs/components/terminal-animation
 */

import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";

export interface TerminalLine {
  text: string;
  color?: string;
  delay?: number;
}

export interface TabContent {
  label: string;
  command: string;
  lines: TerminalLine[];
}

interface TerminalAnimationContextValue {
  activeTab: number;
  setActiveTab: (index: number) => void;
  commandTyped: string;
  isTypingCommand: boolean;
  showCursor: boolean;
  visibleLines: number;
  currentTab: TabContent | undefined;
}

const TerminalAnimationContext = createContext<TerminalAnimationContextValue | undefined>(undefined);

function useTerminalAnimationContext() {
  const ctx = useContext(TerminalAnimationContext);
  if (!ctx) throw new Error("TerminalAnimation components must be used within TerminalAnimationRoot");
  return ctx;
}

export function TerminalAnimationRoot({
  tabs,
  activeTab,
  onActiveTabChange,
  onComplete,
  className,
  children,
}: {
  tabs: TabContent[];
  activeTab: number;
  onActiveTabChange: (index: number) => void;
  onComplete?: () => void;
  className?: string;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [started, setStarted] = useState(false);
  const [visibleLines, setVisibleLines] = useState(0);
  const [commandTyped, setCommandTyped] = useState("");
  const [isTypingCommand, setIsTypingCommand] = useState(true);
  const [showCursor, setShowCursor] = useState(true);
  const timeouts = useRef<ReturnType<typeof setTimeout>[]>([]);
  const completed = useRef(onComplete);

  useEffect(() => {
    completed.current = onComplete;
  });

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setStarted(true);
        observer.disconnect();
      },
      { threshold: 0.3 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const clearTimeouts = useCallback(() => {
    for (const timeout of timeouts.current) clearTimeout(timeout);
    timeouts.current = [];
  }, []);

  useEffect(() => {
    clearTimeouts();
    const tab = tabs[activeTab];
    if (!tab) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setCommandTyped(tab.command);
      setIsTypingCommand(false);
      setVisibleLines(tab.lines.length);
      setShowCursor(false);
      return;
    }
    setVisibleLines(0);
    setCommandTyped("");
    setIsTypingCommand(true);
    setShowCursor(true);
    if (!started) return;

    const later = (run: () => void, ms: number) => {
      timeouts.current.push(setTimeout(run, ms));
    };
    const showLines = (lineIndex: number) => {
      setVisibleLines(lineIndex);
      if (lineIndex < tab.lines.length) {
        later(() => showLines(lineIndex + 1), tab.lines[lineIndex]?.delay ?? 100);
        return;
      }
      later(() => setShowCursor(false), 600);
      later(() => completed.current?.(), 2200);
    };
    let charIndex = 0;
    const typeCommand = () => {
      if (charIndex <= tab.command.length) {
        setCommandTyped(tab.command.slice(0, charIndex));
        charIndex++;
        later(typeCommand, 25 + Math.random() * 35);
        return;
      }
      later(() => {
        setIsTypingCommand(false);
        showLines(0);
      }, 250);
    };
    later(typeCommand, 300);
    return clearTimeouts;
  }, [activeTab, started, tabs, clearTimeouts]);

  return (
    <TerminalAnimationContext.Provider
      value={{
        activeTab,
        setActiveTab: onActiveTabChange,
        commandTyped,
        isTypingCommand,
        showCursor,
        visibleLines,
        currentTab: tabs[activeTab],
      }}
    >
      <div ref={root} className={className}>
        {children}
      </div>
    </TerminalAnimationContext.Provider>
  );
}

export function TerminalAnimationCommandBar({ className }: { className?: string }) {
  const { commandTyped, isTypingCommand, showCursor } = useTerminalAnimationContext();
  return (
    <div className={className}>
      {commandTyped}
      {isTypingCommand && showCursor ? <span aria-hidden="true">▌</span> : null}
    </div>
  );
}

export function TerminalAnimationOutput({ className }: { className?: string }) {
  const { isTypingCommand, visibleLines, currentTab, activeTab } = useTerminalAnimationContext();
  if (isTypingCommand || !currentTab) return null;
  return (
    <div className={className}>
      {currentTab.lines.slice(0, visibleLines).map((line, index) => (
        <div key={`${activeTab}-${index}`} className={line.color}>
          {line.text || "\u00A0"}
        </div>
      ))}
    </div>
  );
}

export function TerminalAnimationTrailingPrompt({ className, children }: { className?: string; children: ReactNode }) {
  const { isTypingCommand, visibleLines, currentTab } = useTerminalAnimationContext();
  if (isTypingCommand || !currentTab || visibleLines < currentTab.lines.length) return null;
  return <div className={className}>{children}</div>;
}

export function TerminalAnimationTabList({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div role="tablist" aria-label="Agent steps" className={className}>
      {children}
    </div>
  );
}

export function TerminalAnimationTabTrigger({
  index,
  className,
  children,
}: {
  index: number;
  className?: string;
  children: ReactNode;
}) {
  const { activeTab, setActiveTab } = useTerminalAnimationContext();
  const active = activeTab === index;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      data-state={active ? "active" : "inactive"}
      onClick={() => setActiveTab(index)}
      className={className}
    >
      {children}
    </button>
  );
}
