/** Download source bytes with measurable progress; cancellation never leaves a request running. */
export function fetchOriginal(
  src: string,
  signal: AbortSignal,
  progress: (fraction: number | null) => void,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    const cleanup = () => signal.removeEventListener("abort", abort);
    const fail = (error: Error) => { cleanup(); reject(error); };
    const abort = () => {
      request.abort();
      fail(new DOMException("Image download cancelled", "AbortError"));
    };
    if (signal.aborted) { abort(); return; }
    request.open("GET", src);
    request.responseType = "blob";
    request.onprogress = (event) => progress(event.lengthComputable && event.total > 0 ? event.loaded / event.total : null);
    request.onload = () => {
      cleanup();
      if (request.status >= 200 && request.status < 300) resolve(request.response);
      else reject(new Error(`Image download failed (${request.status})`));
    };
    request.onerror = () => fail(new Error("Image download failed"));
    signal.addEventListener("abort", abort, { once: true });
    request.send();
  });
}
