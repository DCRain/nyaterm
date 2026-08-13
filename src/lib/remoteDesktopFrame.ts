export type RemoteDesktopPixelFormat = "BGRA8888" | "RGBA8888";

export interface RemoteDesktopFramePatch {
  sequence: bigint;
  desktopWidth: number;
  desktopHeight: number;
  x: number;
  y: number;
  width: number;
  height: number;
  stride: number;
  pixelFormat: RemoteDesktopPixelFormat;
  payload: Uint8Array;
}

const HEADER_BYTES = 44;
const FORMAT_BGRA8888 = 1;
const FORMAT_RGBA8888 = 2;
const BYTES_PER_PIXEL = 4;

function checkedProduct(left: number, right: number, label: string) {
  const product = left * right;
  if (!Number.isSafeInteger(product)) {
    throw new Error(`Remote desktop frame patch ${label} overflows`);
  }
  return product;
}

function checkedSum(left: number, right: number, label: string) {
  const sum = left + right;
  if (!Number.isSafeInteger(sum)) {
    throw new Error(`Remote desktop frame patch ${label} overflows`);
  }
  return sum;
}

export function decodeRemoteDesktopFramePatch(buffer: ArrayBuffer): RemoteDesktopFramePatch {
  if (buffer.byteLength < HEADER_BYTES) {
    throw new Error("Remote desktop frame patch is too short");
  }

  const view = new DataView(buffer);
  const sequence = view.getBigUint64(0, true);
  const desktopWidth = view.getUint32(8, true);
  const desktopHeight = view.getUint32(12, true);
  const x = view.getUint32(16, true);
  const y = view.getUint32(20, true);
  const width = view.getUint32(24, true);
  const height = view.getUint32(28, true);
  const stride = view.getUint32(32, true);
  const format = view.getUint32(36, true);
  const payloadLength = view.getUint32(40, true);
  const expectedLength = checkedSum(HEADER_BYTES, payloadLength, "payload length");

  if (buffer.byteLength !== expectedLength) {
    throw new Error("Remote desktop frame patch payload length mismatch");
  }
  if (desktopWidth === 0 || desktopHeight === 0) {
    throw new Error("Remote desktop frame patch desktop size is empty");
  }
  if (width === 0 || height === 0) {
    throw new Error("Remote desktop frame patch rectangle is empty");
  }

  const rowBytes = checkedProduct(width, BYTES_PER_PIXEL, "row size");
  if (stride < rowBytes) {
    throw new Error("Remote desktop frame patch stride is too small");
  }
  const requiredPayloadLength = checkedProduct(stride, height, "payload size");
  if (payloadLength < requiredPayloadLength) {
    throw new Error("Remote desktop frame patch payload is too small for stride and height");
  }

  const right = checkedSum(x, width, "horizontal bounds");
  const bottom = checkedSum(y, height, "vertical bounds");
  if (right > desktopWidth || bottom > desktopHeight) {
    throw new Error("Remote desktop frame patch rectangle exceeds desktop bounds");
  }

  const pixelFormat =
    format === FORMAT_BGRA8888 ? "BGRA8888" : format === FORMAT_RGBA8888 ? "RGBA8888" : null;
  if (!pixelFormat) {
    throw new Error(`Unsupported remote desktop pixel format ${format}`);
  }

  return {
    sequence,
    desktopWidth,
    desktopHeight,
    x,
    y,
    width,
    height,
    stride,
    pixelFormat,
    payload: new Uint8Array(buffer, HEADER_BYTES, payloadLength),
  };
}

export function createRemoteDesktopFramePatchBuffer(
  patch: Omit<RemoteDesktopFramePatch, "payload"> & { payload: Uint8Array },
): ArrayBuffer {
  const buffer = new ArrayBuffer(HEADER_BYTES + patch.payload.byteLength);
  const view = new DataView(buffer);
  view.setBigUint64(0, patch.sequence, true);
  view.setUint32(8, patch.desktopWidth, true);
  view.setUint32(12, patch.desktopHeight, true);
  view.setUint32(16, patch.x, true);
  view.setUint32(20, patch.y, true);
  view.setUint32(24, patch.width, true);
  view.setUint32(28, patch.height, true);
  view.setUint32(32, patch.stride, true);
  view.setUint32(36, patch.pixelFormat === "BGRA8888" ? FORMAT_BGRA8888 : FORMAT_RGBA8888, true);
  view.setUint32(40, patch.payload.byteLength, true);
  new Uint8Array(buffer, HEADER_BYTES).set(patch.payload);
  return buffer;
}
