import { describe, expect, it } from "vitest";
import { clampPanelWidth, nextPanelWidth } from "./use-panel-layout";

describe("panel layout resize math (shipped)", () => {
  it("clamps widths to min/max", () => {
    expect(clampPanelWidth(100, 200, 420)).toBe(200);
    expect(clampPanelWidth(500, 200, 420)).toBe(420);
    expect(clampPanelWidth(300, 200, 420)).toBe(300);
  });

  it("left panel grows when pointer moves right", () => {
    expect(nextPanelWidth("left", 260, 100, 140, 200, 420)).toBe(300);
    expect(nextPanelWidth("left", 260, 100, 50, 200, 420)).toBe(210);
    // clamp at max
    expect(nextPanelWidth("left", 400, 0, 100, 200, 420)).toBe(420);
  });

  it("right panel grows when pointer moves left", () => {
    expect(nextPanelWidth("right", 340, 900, 860, 280, 560)).toBe(380);
    expect(nextPanelWidth("right", 340, 900, 940, 280, 560)).toBe(300);
    // clamp at min
    expect(nextPanelWidth("right", 290, 900, 950, 280, 560)).toBe(280);
  });
});
