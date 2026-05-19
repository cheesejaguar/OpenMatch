import { afterEach, describe, expect, it } from "vitest";
import MetricCard from "../components/ui/MetricCard";
import { render } from "./helpers";

// Unit-test MetricCard's formatting + delta coloring rules. We use
// inline-style assertions because the component sets the color
// directly on the span via inline style (no class-based variants for
// delta).

describe("MetricCard", () => {
  let result: ReturnType<typeof render> | null = null;

  afterEach(() => {
    result?.unmount();
    result = null;
  });

  it("renders the label and value as written", () => {
    result = render(<MetricCard label="Signups" value={42} />);
    expect(result.container.textContent).toContain("Signups");
    expect(result.container.textContent).toContain("42");
  });

  it("colors positive delta green when improveDirection=up", () => {
    result = render(
      <MetricCard label="Signups" value={42} deltaPercent={12.3} improveDirection="up" />,
    );
    const delta = result.container.querySelector<HTMLSpanElement>(
      "span[aria-label*='vs prior period']",
    );
    expect(delta).not.toBeNull();
    expect(delta?.style.color).toBe("var(--success)");
    expect(delta?.textContent).toContain("12.3%");
  });

  it("colors positive delta red when improveDirection=down", () => {
    // Error rate going UP is bad, hence red.
    result = render(
      <MetricCard label="Error rate" value="3.2%" deltaPercent={5} improveDirection="down" />,
    );
    const delta = result.container.querySelector<HTMLSpanElement>(
      "span[aria-label*='vs prior period']",
    );
    expect(delta?.style.color).toBe("var(--danger)");
  });

  it("renders a sparkline when given more than one data point", () => {
    result = render(<MetricCard label="Sessions" value={100} sparkline={[1, 3, 2, 5, 4, 6]} />);
    const svg = result.container.querySelector("svg");
    expect(svg).not.toBeNull();
    // sparkline draws a path
    expect(result.container.querySelectorAll("path").length).toBeGreaterThan(0);
  });

  it("omits the delta pill entirely when deltaPercent is undefined", () => {
    result = render(<MetricCard label="Signups" value={42} />);
    const delta = result.container.querySelector("span[aria-label*='vs prior period']");
    expect(delta).toBeNull();
  });
});
