import { describe, expect, it } from "vitest";
import {
  createOutputQueue,
  getOutputQueueDebugSnapshot,
  hasOutputQueueItems,
  peekOutputQueue,
  pushOutputQueue,
  replaceOutputQueueHead,
  shiftOutputQueue,
  splitOutputChunk,
  type QueuedOutputChunk,
} from "./xterminalOutputQueue";

describe("OutputQueue", () => {
  it("releases consumed chunk references while preserving order and bytes", () => {
    const queue = createOutputQueue();
    const chunks: QueuedOutputChunk[] = Array.from({ length: 256 }, (_, index) => ({
      data: `${index}:`.padEnd(4096, "x"),
      bytes: 4096,
    }));

    for (const chunk of chunks) {
      pushOutputQueue(queue, chunk);
    }

    expect(queue.bytes).toBe(256 * 4096);

    for (let i = 0; i < 128; i += 1) {
      expect(shiftOutputQueue(queue)).toBe(chunks[i]);
    }

    const snapshot = getOutputQueueDebugSnapshot(queue);
    expect(snapshot.bytes).toBe(128 * 4096);
    expect(snapshot.liveSlots).toBe(128);
    expect(snapshot.consumedSlots).toBe(128);
    expect(queue.chunks.slice(0, queue.headIndex).every((slot) => slot === undefined)).toBe(true);
  });

  it("continues growing and consuming without retaining old consumed slots", () => {
    const queue = createOutputQueue();
    const written: string[] = [];

    for (let round = 0; round < 40; round += 1) {
      for (let i = 0; i < 10; i += 1) {
        const data = `r${round}-c${i};`;
        pushOutputQueue(queue, { data, bytes: data.length });
      }

      for (let i = 0; i < 7; i += 1) {
        const chunk = shiftOutputQueue(queue);
        if (chunk) written.push(chunk.data);
      }

      expect(queue.chunks.slice(0, queue.headIndex).every((slot) => slot === undefined)).toBe(
        true,
      );
    }

    const remaining: string[] = [];
    while (hasOutputQueueItems(queue)) {
      const chunk = shiftOutputQueue(queue);
      if (chunk) remaining.push(chunk.data);
    }

    expect([...written, ...remaining].join("")).toBe(
      Array.from({ length: 40 }, (_, round) =>
        Array.from({ length: 10 }, (_unused, i) => `r${round}-c${i};`).join(""),
      ).join(""),
    );
    expect(queue.bytes).toBe(0);
    expect(getOutputQueueDebugSnapshot(queue).liveSlots).toBe(0);
  });

  it("handles split head replacement and final queue drain", () => {
    const queue = createOutputQueue();
    const original = { data: "abcde", bytes: 5 };
    pushOutputQueue(queue, original);
    pushOutputQueue(queue, { data: "fg", bytes: 2 });

    const head = peekOutputQueue(queue);
    expect(head).toBe(original);
    expect(head).not.toBeNull();

    const [splitHead, splitTail] = splitOutputChunk(head!, 2);
    replaceOutputQueueHead(queue, splitTail);
    queue.bytes = Math.max(0, queue.bytes - splitHead.bytes);

    expect(splitHead).toEqual({ data: "ab", bytes: 2 });
    expect(shiftOutputQueue(queue)).toEqual({ data: "cde", bytes: 3 });
    expect(queue.chunks.slice(0, queue.headIndex).every((slot) => slot === undefined)).toBe(true);
    expect(shiftOutputQueue(queue)).toEqual({ data: "fg", bytes: 2 });
    expect(queue.bytes).toBe(0);
    expect(hasOutputQueueItems(queue)).toBe(false);
  });

  it("does not retain a consumed large string reference in the queue slots", () => {
    const queue = createOutputQueue();
    const large = "x".repeat(8 * 1024 * 1024);
    const chunk = { data: large, bytes: large.length };

    pushOutputQueue(queue, chunk);
    expect(shiftOutputQueue(queue)).toBe(chunk);

    expect(queue.chunks.some((slot) => slot?.data === large)).toBe(false);
    expect(getOutputQueueDebugSnapshot(queue)).toMatchObject({
      bytes: 0,
      liveSlots: 0,
    });
  });
});
