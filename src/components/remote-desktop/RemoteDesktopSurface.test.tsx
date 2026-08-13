import { act, fireEvent, render } from "@testing-library/react";
import { createRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RemoteDesktopFramePatch } from "@/lib/remoteDesktopFrame";
import { RemoteDesktopSurface, type RemoteDesktopSurfaceHandle } from "./RemoteDesktopSurface";

const { createRenderer, draw, drawMany, dispose } = vi.hoisted(() => ({
  createRenderer: vi.fn(),
  draw: vi.fn(),
  drawMany: vi.fn(),
  dispose: vi.fn(),
}));

vi.mock("./renderer", () => ({
  createRemoteDesktopRenderer: createRenderer,
}));

const patch: RemoteDesktopFramePatch = {
  sequence: 1n,
  desktopWidth: 10,
  desktopHeight: 10,
  x: 0,
  y: 0,
  width: 1,
  height: 1,
  stride: 4,
  pixelFormat: "RGBA8888",
  payload: new Uint8Array([0, 0, 0, 255]),
};

describe("RemoteDesktopSurface", () => {
  beforeEach(() => {
    draw.mockReset();
    drawMany.mockReset();
    dispose.mockReset();
    createRenderer.mockReset();
    createRenderer.mockReturnValue({ draw, drawMany, dispose });
  });

  it("batches imperative frame draws on the next animation frame", () => {
    const ref = createRef<RemoteDesktopSurfaceHandle>();
    let rafCallback: FrameRequestCallback | null = null;
    const requestAnimationFrame = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        rafCallback = callback;
        return 1;
      });
    const cancelAnimationFrame = vi
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation(() => {});
    render(<RemoteDesktopSurface ref={ref} scaleMode="fit" active visible />);

    act(() => ref.current?.drawFrame(patch));
    act(() => ref.current?.drawFrame({ ...patch, sequence: 2n }));

    expect(requestAnimationFrame).toHaveBeenCalledOnce();
    expect(createRenderer).not.toHaveBeenCalled();
    expect(drawMany).not.toHaveBeenCalled();

    act(() => rafCallback?.(16));

    expect(createRenderer).toHaveBeenCalledOnce();
    expect(drawMany).toHaveBeenCalledWith([patch, { ...patch, sequence: 2n }]);
    expect(draw).not.toHaveBeenCalled();

    requestAnimationFrame.mockRestore();
    cancelAnimationFrame.mockRestore();
  });

  it("implements fit, actual, and stretch as local canvas presentation modes", () => {
    const view = render(<RemoteDesktopSurface scaleMode="fit" active visible />);
    const canvas = view.container.querySelector("canvas");
    expect(canvas?.style.objectFit).toBe("contain");
    expect(canvas?.style.width).toBe("100%");

    view.rerender(<RemoteDesktopSurface scaleMode="actual" active visible />);
    expect(canvas?.style.width).toBe("auto");
    expect(canvas?.style.maxWidth).toBe("none");

    view.rerender(<RemoteDesktopSurface scaleMode="stretch" active visible />);
    expect(canvas?.style.width).toBe("100%");
    expect(canvas?.style.height).toBe("100%");
    expect(canvas?.style.objectFit).toBe("");
  });

  it("marks its focus root as a remote desktop input surface", () => {
    const view = render(<RemoteDesktopSurface scaleMode="fit" active visible />);
    expect(view.container.querySelector('[data-remote-desktop-input-root="true"]')).not.toBeNull();
  });

  it("disposes renderer resources on reset and unmount", () => {
    const ref = createRef<RemoteDesktopSurfaceHandle>();
    vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
    const cancelAnimationFrame = vi
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation(() => {});
    const view = render(<RemoteDesktopSurface ref={ref} scaleMode="fit" active visible />);
    act(() => ref.current?.drawFrame(patch));
    act(() => ref.current?.reset());
    expect(cancelAnimationFrame).toHaveBeenCalledWith(1);
    expect(dispose).not.toHaveBeenCalled();

    let rafCallback: FrameRequestCallback | null = null;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      rafCallback = callback;
      return 2;
    });
    act(() => ref.current?.drawFrame(patch));
    act(() => rafCallback?.(16));
    view.unmount();
    expect(dispose).toHaveBeenCalledOnce();

    vi.restoreAllMocks();
  });

  it("maps pointer coordinates with stretch presentation", () => {
    const onPointerMove = vi.fn();
    const view = render(
      <RemoteDesktopSurface scaleMode="stretch" active visible onPointerMove={onPointerMove} />,
    );
    const canvas = view.container.querySelector("canvas");
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error("expected canvas");
    canvas.width = 100;
    canvas.height = 100;
    canvas.getBoundingClientRect = () =>
      ({
        left: 10,
        top: 20,
        width: 300,
        height: 200,
        right: 310,
        bottom: 220,
        x: 10,
        y: 20,
        toJSON: () => ({}),
      }) as DOMRect;

    fireEvent.pointerMove(canvas, { clientX: 160, clientY: 120 });

    expect(onPointerMove).toHaveBeenCalledWith({ x: 50, y: 50 }, expect.any(PointerEvent));
  });
});
