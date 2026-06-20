"use client";

import { useState, useEffect, useRef } from 'preact/hooks';
import { BEFORE_NAVIGATE_EVENT, AFTER_NAVIGATE_EVENT } from '@takazudo/zudo-doc/transitions';

export const SIDEBAR_STORAGE_KEY = 'zudo-doc-sidebar-visible';

function readState(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return localStorage.getItem(SIDEBAR_STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
}

function setDataAttribute(isVisible: boolean) {
  if (isVisible) {
    document.documentElement.removeAttribute('data-sidebar-hidden');
  } else {
    document.documentElement.setAttribute('data-sidebar-hidden', '');
  }
}

// SPA-navigation guard for the desktop sidebar's hidden-state (#2198).
//
// zfb's Strategy-B client router wipes EVERY <html> attribute during the body
// swap (swapRootAttributes re-adds only NON_OVERRIDABLE_ZFB_ATTRS plus the
// incoming SSR document's attributes), so the persisted `data-sidebar-hidden`
// runtime value is lost on every navigation, and the pre-paint inline script
// does not re-run on SPA hops. Left alone, the freshly-rendered sidebar paints
// visible and then animates shut when the value is restored — the flash + slide.
//
// These listeners MUST live at module scope, NOT in the island's useEffect:
// zfb-runtime (>= 0.1.0-next.51) calls unmountIslands() BEFORE the swap and
// before firing AFTER_NAVIGATE_EVENT, so a useEffect-registered listener is torn
// down (effect cleanup) before the swap and never sees the after-swap event —
// the restore would never run (#2198 verification). Registering once on
// `document` at bundle load — the same lifecycle-independent pattern as
// client-router-bootstrap.tsx — keeps the guard alive across island
// unmount/remount. SSR-safe: no-ops when `document` is undefined.
//
// Strategy: on BEFORE_NAVIGATE_EVENT, record whether the sidebar was hidden and
// set a transient `data-sidebar-no-transition` marker (global.css zeroes the
// sidebar/wrapper/band/toggle transitions). The swap then wipes BOTH the marker
// and data-sidebar-hidden. On AFTER_NAVIGATE_EVENT (swap done → the live <html>
// is no longer wiped) RE-SET the marker, then re-add data-sidebar-hidden in the
// same synchronous batch, so the hidden geometry snaps in with transitions
// suppressed (no slide, no open frame). Remove the marker on a double rAF
// afterward so a later user toggle still animates.
let spaNavGuardRegistered = false;
function registerSidebarSpaNavGuard() {
  if (typeof document === 'undefined' || spaNavGuardRegistered) return;
  spaNavGuardRegistered = true;

  let wasHidden = false;
  let swapToken = 0;
  // Long enough to outlast the View-Transition swap pipeline on slow
  // machines/CI; short enough that an aborted nav self-heals quickly. Only a
  // safety net for a nav that never reaches `restore` (aborted/superseded).
  const STUCK_MARKER_FALLBACK_MS = 1500;

  const capture = () => {
    wasHidden = document.documentElement.hasAttribute('data-sidebar-hidden');
    document.documentElement.setAttribute('data-sidebar-no-transition', '');
    const token = ++swapToken;
    window.setTimeout(() => {
      if (token === swapToken) {
        document.documentElement.removeAttribute('data-sidebar-no-transition');
      }
    }, STUCK_MARKER_FALLBACK_MS);
  };

  const restore = () => {
    // Marker first, then the attribute, in one synchronous batch — so the
    // hidden geometry is restored with transitions off (the swap already wiped
    // the capture-time marker, so re-setting it here on the post-swap <html> is
    // what actually suppresses the animation).
    document.documentElement.setAttribute('data-sidebar-no-transition', '');
    if (wasHidden) {
      document.documentElement.setAttribute('data-sidebar-hidden', '');
    }
    // Drop the marker only after the restored state is committed. A single rAF
    // can coincide with the restore's style recalc and animate it, so defer one
    // extra frame. The token bump no-ops capture's safety-net for this swap.
    const token = ++swapToken;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (token === swapToken) {
          document.documentElement.removeAttribute('data-sidebar-no-transition');
        }
      });
    });
  };

  document.addEventListener(BEFORE_NAVIGATE_EVENT, capture);
  document.addEventListener(AFTER_NAVIGATE_EVENT, restore);
}

// Register at module load (browser-only via the guard) so the listeners exist
// before the first navigation and survive island unmount/remount.
registerSidebarSpaNavGuard();

export default function DesktopSidebarToggle() {
  // Initial state must match server render (always `true`) to avoid a
  // hydration mismatch when the persisted preference is "hidden". The
  // doc-layout's pre-paint inline script applies `data-sidebar-hidden`
  // to <html> from localStorage *before* this island mounts, so the
  // visual state stays correct; we only need to sync this island's
  // React state to the persisted preference after hydration. Same
  // pattern as packages/zudo-doc/src/theme-toggle/index.tsx (commit 9aebd8e).
  const [visible, setVisible] = useState<boolean>(true);
  // Tracks whether the hydration sync (below) has run. The persistence
  // effect below skips the very first mount so we don't overwrite the
  // user's persisted "hidden" preference with the SSR-safe default
  // `true` before the hydration sync gets a chance to fire.
  const hydrated = useRef(false);

  // Persist state changes to localStorage and the <html> data-attribute.
  // The `hydrated.current` guard is the real protection: it is still
  // `false` on the very first effect run (the hydration-sync effect
  // below sets it to `true` only after this one fires, since effects
  // run in declaration order on mount), so the first run bails out
  // and we don't clobber the user's persisted "hidden" preference
  // with the SSR-safe default `true`.
  useEffect(() => {
    if (!hydrated.current) return;
    setDataAttribute(visible);
    try {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, String(visible));
    } catch {
      // ignore storage errors
    }
  }, [visible]);

  // After mount, read the persisted preference and reconcile state
  // with the SSR default. Sets the ref so subsequent runs of the
  // persistence effect above start syncing normally.
  useEffect(() => {
    hydrated.current = true;
    const actual = readState();
    if (actual !== visible) {
      setVisible(actual);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The SPA-navigation flash guard (data-sidebar-hidden preservation +
  // transition suppression) is NOT registered here. It must outlive this
  // island's mount/unmount, so it lives at module scope — see
  // registerSidebarSpaNavGuard() above. (#2198)

  return (
    <button
      type="button"
      onClick={() => setVisible((v) => !v)}
      className="zd-desktop-sidebar-toggle hidden lg:flex fixed bottom-vsp-xl z-sidebar items-center justify-center w-[1.5rem] h-[3rem] bg-surface border border-muted border-l-0 rounded-r-DEFAULT text-muted cursor-pointer transition-[left,color] duration-200 ease-in-out hover:text-fg"
      aria-label={visible ? 'Hide sidebar' : 'Show sidebar'}
      aria-pressed={visible}
      data-zfb-transition-persist="desktop-sidebar-toggle"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="h-icon-sm w-icon-sm"
        aria-hidden="true"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d={visible ? 'M15 19l-7-7 7-7' : 'M9 5l7 7-7 7'}
        />
      </svg>
    </button>
  );
}
