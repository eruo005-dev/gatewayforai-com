export class StreamDiedAtBirth extends Error {
  constructor() {
    super("stream produced no data");
    this.name = "StreamDiedAtBirth";
  }
}

const decoder = new TextDecoder();

/**
 * Reads from `body` until the first chunk containing a `data:` line arrives,
 * or `firstTokenTimeoutMs` elapses, or the stream ends/errors.
 * - First data chunk seen → resolves with a NEW ReadableStream that re-emits
 *   the buffered chunk(s) then pipes the remainder via the SAME reader.
 *   (Non-data preamble chunks, e.g. SSE comments/pings, are buffered and
 *   re-emitted but do not commit.)
 * - Stream ends/errors with zero data frames → throws StreamDiedAtBirth.
 * - Timeout with zero data frames → cancels upstream, throws StreamDiedAtBirth.
 */
export async function guardFirstToken(
  body: ReadableStream<Uint8Array>,
  firstTokenTimeoutMs: number,
): Promise<ReadableStream<Uint8Array>> {
  const reader = body.getReader();
  const buffered: Uint8Array[] = [];
  // Rolling tail (last few decoded chars) so a `data:` split across chunk
  // boundaries is still detected.
  let tail = "";

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new StreamDiedAtBirth()), firstTokenTimeoutMs);
  });

  const findFirstToken = (async (): Promise<void> => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) throw new StreamDiedAtBirth();
      if (value) {
        buffered.push(value);
        const text = tail + decoder.decode(value, { stream: true });
        if (text.includes("data:")) return; // committed
        tail = text.slice(-5);
      }
    }
  })();

  try {
    await Promise.race([findFirstToken, timeout]);
  } catch (e) {
    clearTimeout(timer);
    void reader.cancel().catch(() => {});
    throw e instanceof StreamDiedAtBirth ? e : new StreamDiedAtBirth();
  }
  clearTimeout(timer);

  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of buffered) controller.enqueue(chunk);
    },
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        if (value) controller.enqueue(value);
      } catch (err) {
        controller.error(err);
      }
    },
    cancel(reason) {
      void reader.cancel(reason).catch(() => {});
    },
  });
}
