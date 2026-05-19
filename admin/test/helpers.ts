import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";

export { act };

// Tiny render helper — avoids pulling in @testing-library/react. We
// only need to mount a component, fire a click or two, and inspect
// the rendered HTML. The `act()` wrapper from React is enough to keep
// state updates flushed.

export interface RenderResult {
  container: HTMLElement;
  root: Root;
  unmount: () => void;
  rerender: (next: ReactElement) => void;
}

export function render(element: ReactElement): RenderResult {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(element);
  });
  return {
    container,
    root,
    unmount() {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
    rerender(next: ReactElement) {
      act(() => {
        root.render(next);
      });
    },
  };
}

export async function flush(): Promise<void> {
  // happy-dom + React 19 flush microtasks on the next tick.
  await new Promise((r) => setTimeout(r, 0));
}

export function click(el: Element | null) {
  if (!el) throw new Error("click target is null");
  act(() => {
    (el as HTMLElement).click();
  });
}

export function queryByText(root: HTMLElement, text: string): HTMLElement | null {
  const nodes = root.querySelectorAll<HTMLElement>("*");
  for (const n of Array.from(nodes)) {
    if (n.children.length === 0 && n.textContent?.includes(text)) {
      return n;
    }
  }
  return null;
}

export function findButton(root: HTMLElement, text: string): HTMLButtonElement | null {
  const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>("button"));
  for (const b of buttons) {
    if (b.textContent?.includes(text)) return b;
  }
  return null;
}
