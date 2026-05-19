// Vitest setup for admin tests. happy-dom installs a window/document
// globally, but it doesn't auto-polyfill the clipboard API. We stub
// navigator.clipboard so the invite "copy" button doesn't throw under
// test. We also opt-in to React's act-environment so `act()` calls
// inside our render helper don't emit warnings.

// Tell React the runtime is configured for act() — silences the
// "current testing environment is not configured to support act(...)"
// warning when running components that schedule effects.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

if (typeof globalThis.navigator !== "undefined" && !globalThis.navigator.clipboard) {
  Object.defineProperty(globalThis.navigator, "clipboard", {
    value: { writeText: async () => undefined },
    configurable: true,
  });
}
