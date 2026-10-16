import { describe, expect, it } from "vitest";
import { zoomFactorForInput } from "../src/shared/viewZoom.js";

const input = (key: string) => ({ type: "keyDown", key, control: true, meta: false, alt: false });

describe("session view zoom shortcuts", () => {
  it.each(["+", "=", "Add"])("enlarges using %s", key => {
    expect(zoomFactorForInput(1, input(key))).toBe(1.25);
    expect(zoomFactorForInput(2.25, input(key))).toBe(2.25);
  });
  it.each(["-", "Subtract"])("reduces using %s", key => {
    expect(zoomFactorForInput(1, input(key))).toBe(0.75);
    expect(zoomFactorForInput(0.75, input(key))).toBe(0.75);
  });
  it("resets enlarged and reduced views", () => {
    expect(zoomFactorForInput(2.25, input("0"))).toBe(1);
    expect(zoomFactorForInput(0.75, input("0"))).toBe(1);
  });
  it("leaves typing, modifier combinations and unrelated shortcuts alone", () => {
    expect(zoomFactorForInput(1, { ...input("+"), control: false })).toBeUndefined();
    expect(zoomFactorForInput(1, { ...input("+"), alt: true })).toBeUndefined();
    expect(zoomFactorForInput(1, { ...input("+"), type: "keyUp" })).toBeUndefined();
    expect(zoomFactorForInput(1, input("Enter"))).toBeUndefined();
    expect(zoomFactorForInput(1, { ...input("+"), control: false, meta: true })).toBe(1.25);
  });
});
