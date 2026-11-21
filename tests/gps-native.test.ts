import { afterEach, describe, expect, it, vi } from "vitest";
import { inAndroidApp, nativeStop, nativeSync, onNativeState, parseNativeState } from "@/lib/workforce/gps/native";

const state = { type: "state", app: "android", version: "1.0.0", location: "granted", background: true, notifications: true, batteryUnrestricted: false, tracking: true, sites: 2, error: null };

describe("Android app bridge", () => {
  afterEach(() => { delete (globalThis as { window?: unknown }).window; });

  it("parses the app's state and ignores anything else", () => {
    expect(parseNativeState(JSON.stringify(state))).toMatchObject({ location: "granted", background: true, tracking: true, sites: 2, error: null });
    expect(parseNativeState({ ...state, location: "weird" })?.location).toBe("prompt");
    expect(parseNativeState({ ...state, app: "ios" })).toBeNull();
    expect(parseNativeState("not json")).toBeNull();
    expect(parseNativeState({ type: "other" })).toBeNull();
  });

  it("is a no-op in a normal browser", () => {
    (globalThis as { window?: unknown }).window = {};
    expect(inAndroidApp()).toBe(false);
    expect(() => nativeSync({ resourceId: "x", sites: [], dwellMin: 5, graceMin: 10, maxAccuracyM: 100 })).not.toThrow();
    expect(onNativeState(() => {})).toBeTypeOf("function");
  });

  it("sends sync/stop to the app and delivers state replies", () => {
    const sent: string[] = [];
    const port: { postMessage: (d: string) => void; onmessage: ((e: { data: string }) => void) | null } = { postMessage: (d) => sent.push(d), onmessage: null };
    (globalThis as { window?: unknown }).window = { Built2BidNative: port };
    expect(inAndroidApp()).toBe(true);
    const seen = vi.fn();
    onNativeState(seen);
    expect(JSON.parse(sent[0])).toEqual({ type: "hello" });
    port.onmessage?.({ data: JSON.stringify(state) });
    expect(seen).toHaveBeenCalledWith(expect.objectContaining({ tracking: true }));
    nativeSync({ resourceId: "r", sites: [{ id: "s", name: "Shop", lat: 44, lng: -92.5, radiusM: 150 }], dwellMin: 5, graceMin: 10, maxAccuracyM: 100 });
    expect(JSON.parse(sent[1])).toMatchObject({ type: "sync", resourceId: "r", sites: [{ id: "s", radiusM: 150 }] });
    nativeStop();
    expect(JSON.parse(sent[2])).toEqual({ type: "stop" });
  });
});
