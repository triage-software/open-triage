"use client";
import type { Priority, User } from "@/lib/types";
import { SignalHigh, SignalMedium, SignalLow, ChevronsUp } from "lucide-react";

/**
 * Brand mark: three narrowing lines — the triage gesture (full queue sorted
 * down to what matters). Drawn on the DS "clay" tile (--ot-brand-symbol-*).
 */
export function TriageMark({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.1}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M4 6h16" />
      <path d="M7 12h10" />
      <path d="M10 18h4" />
    </svg>
  );
}

export function Avatar({
  user,
  name,
  color,
  size = "normal",
}: {
  user?: User;
  name?: string;
  color?: string;
  size?: "tiny" | "small" | "normal" | "large";
}) {
  const initials =
    user?.initials ??
    name
      ?.split(" ")
      .map((n) => n[0])
      .slice(0, 2)
      .join("") ??
    "?";
  return (
    <span
      className={`avatar avatar-${size}`}
      style={
        {
          "--avatar-color": user?.color ?? color ?? "#91887d",
        } as React.CSSProperties
      }
      title={user?.name ?? name}
    >
      {initials}
    </span>
  );
}
export function PriorityBadge({
  priority,
  compact = false,
}: {
  priority: Priority;
  compact?: boolean;
}) {
  const Icon =
    priority === "Krytyczny"
      ? ChevronsUp
      : priority === "Wysoki"
        ? SignalHigh
        : priority === "Normalny"
          ? SignalMedium
          : SignalLow;
  return (
    <span
      className={`priority priority-${priority.toLowerCase()}`}
      title={priority}
    >
      <Icon size={13} strokeWidth={2.1} />
      {!compact && priority}
    </span>
  );
}
export function relativeTime(date: string) {
  const minutes = Math.max(
    1,
    Math.floor((Date.now() - new Date(date).getTime()) / 60_000),
  );
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} godz.`;
  return `${Math.floor(minutes / 1440)} dni`;
}
export function time(date: string) {
  return new Date(date).toLocaleTimeString("pl-PL", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
export function dateTime(date: string) {
  return new Date(date).toLocaleString("pl-PL", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
export async function copyLink(conversationId: string, commentId?: string) {
  const url = new URL(window.location.href);
  url.searchParams.set("view", "inbox");
  url.searchParams.set("conversation", conversationId);
  url.searchParams.delete("document");
  url.hash = commentId ? `comment-${commentId}` : "";
  await navigator.clipboard.writeText(url.toString());
}
