/** Bound RPCs even when an older Remote implementation ignores AbortSignal. */
export function bounded(task, signal, timeout = 5000) {
  return new Promise((resolve, reject) => {
    let timer;
    const stop = () => finish(reject, signal.reason ?? new DOMException("Cancelled", "AbortError"));
    const finish = (settle, value) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", stop);
      settle(value);
    };
    if (signal?.aborted) { stop(); return; }
    signal?.addEventListener("abort", stop, { once: true });
    timer = setTimeout(() => finish(reject, new DOMException("Request timed out", "TimeoutError")), timeout);
    Promise.resolve().then(() => { signal?.throwIfAborted(); return task(); }).then(value => finish(resolve, value), error => finish(reject, error));
  });
}

/** Enforce the byte ceiling while streaming, even without a Content-Length. */
export async function readBoundedBlob(response, limit) {
  const tooLarge = () => Object.assign(new Error("File too large"), { code: "file-too-large" });
  const length = Number(response.headers?.get?.("content-length"));
  if (length > limit) { await response.body?.cancel?.(); throw tooLarge(); }
  if (!response.body?.getReader) {
    const blob = await response.blob();
    if (blob.size > limit) throw tooLarge();
    return blob;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw tooLarge(); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return new Blob(chunks);
}
