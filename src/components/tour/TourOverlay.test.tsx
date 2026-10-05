import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TourOverlay, type TourOverlayProps } from "./TourOverlay";
import type { TourStep } from "./steps";

const step = (over: Partial<TourStep> = {}): TourStep => ({ id: "s", title: "Your full list", body: "Every tour and event.", ...over });

function setup(over: Partial<TourOverlayProps> = {}) {
  const props: TourOverlayProps = {
    step: step(), index: 0, total: 3,
    onNext: vi.fn(), onBack: vi.fn(), onSkip: vi.fn(), onDone: vi.fn(), onMissing: vi.fn(),
    ...over,
  };
  const utils = render(<TourOverlay {...props} />);
  return { ...utils, props };
}
const dialog = () => screen.getByRole("dialog", { hidden: true });
const shown = () => waitFor(() => expect(dialog().style.opacity).toBe("1"));

afterEach(() => { cleanup(); document.body.innerHTML = ""; });

describe("TourOverlay", () => {
  it("shows a labelled dialog with the step, and focuses Next", async () => {
    setup();
    await shown();
    expect(dialog()).toHaveAttribute("aria-modal", "true");
    expect(screen.getByText("Your full list")).toBeInTheDocument();
    expect(screen.getByText("Step 1 of 3")).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Next", hidden: true })));
    expect(screen.queryByRole("button", { name: "Back", hidden: true })).toBeNull();
  });

  it("arrow keys move, Esc skips", async () => {
    const { props, rerender } = setup();
    await shown();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(props.onNext).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(props.onBack).not.toHaveBeenCalled();   // nothing before step one
    rerender(<TourOverlay {...props} index={1} />);
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(props.onBack).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(props.onSkip).toHaveBeenCalledTimes(1);
  });

  it("the last step says Done and finishes", async () => {
    const { props } = setup({ index: 2 });
    await shown();
    fireEvent.click(screen.getByRole("button", { name: "Done", hidden: true }));
    expect(props.onDone).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(props.onDone).toHaveBeenCalledTimes(2);
    expect(props.onNext).not.toHaveBeenCalled();
  });

  it("Skip tour and a click on the backdrop both just close it", async () => {
    const { props } = setup();
    await shown();
    fireEvent.click(screen.getByRole("button", { name: "Skip tour", hidden: true }));
    expect(props.onSkip).toHaveBeenCalledTimes(1);
    const backdrop = screen.getByTestId("tour-overlay").firstElementChild as HTMLElement;
    fireEvent.click(backdrop, { clientX: 5, clientY: 5 });
    expect(props.onSkip).toHaveBeenCalledTimes(2);
  });

  it("keeps Cmd/Ctrl+K away from the Assistant while it's up", async () => {
    setup();
    await shown();
    const assistant = vi.fn();
    window.addEventListener("keydown", assistant);
    const e = new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true, cancelable: true });
    act(() => { document.body.dispatchEvent(e); });
    expect(e.defaultPrevented).toBe(true);
    expect(assistant).not.toHaveBeenCalled();
    window.removeEventListener("keydown", assistant);
  });

  it("traps Tab inside the card", async () => {
    setup({ index: 1 });
    await shown();
    const [skip, back, next] = ["Skip tour", "Back", "Next"].map((n) => screen.getByRole("button", { name: n, hidden: true }));
    next.focus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(document.activeElement).toBe(skip);
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(next);
    expect(back).toBeInTheDocument();
  });

  it("makes the app behind it inert, and gives it back on close", async () => {
    const root = document.createElement("div");
    root.id = "root";
    document.body.appendChild(root);
    const { unmount } = setup();
    await shown();
    expect(root.hasAttribute("inert")).toBe(true);
    unmount();
    expect(root.hasAttribute("inert")).toBe(false);
  });

  it("spotlights the anchor it finds", async () => {
    const el = document.createElement("button");
    el.setAttribute("data-tour", "exp-add");
    el.getBoundingClientRect = () => ({ top: 60, left: 600, width: 120, height: 36, right: 720, bottom: 96, x: 600, y: 60, toJSON: () => ({}) });
    el.scrollIntoView = vi.fn();
    document.body.appendChild(el);
    setup({ step: step({ anchor: "exp-add" }) });
    await shown();
    const spot = screen.getByTestId("tour-overlay").children[1] as HTMLElement;
    await waitFor(() => expect(spot.style.top).toBe("54px"));
    expect(spot.style.left).toBe("594px");
    expect(spot.style.width).toBe("132px");
    expect(spot.style.height).toBe("48px");
    expect(el.scrollIntoView).not.toHaveBeenCalled();   // already on screen
  });

  it("drops a step whose anchor never turns up, when the step asks for that", async () => {
    const { props } = setup({ step: step({ anchor: "nowhere", fallback: "skip" }) });
    await waitFor(() => expect(props.onMissing).toHaveBeenCalledTimes(1), { timeout: 3000 });
  });

  it("otherwise centres the card rather than pointing at nothing", async () => {
    setup({ step: step({ anchor: "nowhere" }) });
    await waitFor(() => expect(dialog().style.opacity).toBe("1"), { timeout: 3000 });
    const spot = screen.getByTestId("tour-overlay").children[1] as HTMLElement;
    expect(spot.style.width).toBe("0px");
  });
});
