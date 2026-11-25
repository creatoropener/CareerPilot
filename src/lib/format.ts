// Small display helpers for the job feed.

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** "3 hours ago", "yesterday", "5 days ago", "2 weeks ago". Returns null for a missing or invalid date. */
export function ageLabel(value: string | null | undefined, now = new Date()): string | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return null;
  const age = Math.max(0, now.getTime() - time);
  if (age < HOUR) return 'just now';
  if (age < DAY) {
    const hours = Math.floor(age / HOUR);
    return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  }
  const days = Math.floor(age / DAY);
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks} weeks ago`;
}

/** True for a screen narrow enough that the profile form pushes the results out of view. */
export const isNarrowScreen = (): boolean =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 850px)').matches;

/** Scrolls an element to the top of the screen, without animation when the user asked for reduced motion. */
export function scrollToElement(element: HTMLElement | null): void {
  if (!element || typeof element.scrollIntoView !== 'function') return;
  const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  element.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
}
