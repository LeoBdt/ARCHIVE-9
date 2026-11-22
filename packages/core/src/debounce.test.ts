import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KeyedDebouncer } from "./debounce.ts";

describe("KeyedDebouncer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("runs once after the last call of a burst", () => {
    const fn = vi.fn();
    const debouncer = new KeyedDebouncer(100, fn);
    debouncer.schedule("a");
    vi.advanceTimersByTime(80);
    debouncer.schedule("a");
    vi.advanceTimersByTime(80);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(30);
    expect(fn).toHaveBeenCalledExactlyOnceWith("a");
  });

  it("keeps keys independent", () => {
    const fn = vi.fn();
    const debouncer = new KeyedDebouncer(100, fn);
    debouncer.schedule("a");
    debouncer.schedule("b");
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("can cancel one key or everything", () => {
    const fn = vi.fn();
    const debouncer = new KeyedDebouncer(100, fn);
    debouncer.schedule("a");
    debouncer.schedule("b");
    debouncer.cancel("a");
    debouncer.cancel("unknown");
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledExactlyOnceWith("b");
    debouncer.schedule("c");
    debouncer.clear();
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
