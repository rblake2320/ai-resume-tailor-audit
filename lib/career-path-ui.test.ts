import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CareerPathPlanner } from "@/components/CareerPathPlanner";

describe("career-path planner UI boundary", () => {
  it("exposes accessible inputs and keeps observations distinct from projections", () => {
    const html = renderToStaticMarkup(createElement(CareerPathPlanner));
    expect(html).toContain("O*NET-SOC code");
    expect(html).toContain("Optional BLS observational series");
    expect(html).toContain("This does not create a projection");
    expect(html).toContain("Authoritative projection snapshot (JSON)");
    expect(html).toContain("Explicit evidence gaps");
    expect(html).toContain("Training resource catalog");
    expect(html).toContain('aria-live="polite"');
    expect(html).not.toContain("BLS predicts");
  });
});
