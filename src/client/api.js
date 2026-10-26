import { ROUTE_BASE, MAX_RAW_BYTES } from "../shared/constants.js";
import { bounded, readBoundedBlob } from "./async.js";

export class HostApiError extends Error {
  constructor(code, status = 0) { super(code); this.name = "HostApiError"; this.code = code; this.status = status; }
}

export function createHostApi() {
  const request = async (suffix, options = {}, raw = false) => {
    const controller = new AbortController();
    const signal = options.signal === undefined ? controller.signal : AbortSignal.any([controller.signal, options.signal]);
    try {
      return await bounded(async () => {
        const response = await fetch(`${ROUTE_BASE}${suffix}`, { ...options, signal });
        if (response.ok) return raw ? await readBoundedBlob(response, MAX_RAW_BYTES) : await response.json();
        const body = await response.json().catch(() => ({}));
        const error = body && typeof body === "object" ? body : {};
        if (response.status === 404 && !error.code) return undefined;
        throw new HostApiError(error.code ?? (response.status === 401 || response.status === 403 ? "unauthorized" : "failed"), response.status);
      }, signal, raw ? 30000 : suffix === "/save-as" ? 30000 : suffix === "/open-location" ? 15000 : 5000);
    } catch (error) {
      if (error instanceof HostApiError || error.code === "file-too-large" || error.name === "AbortError" || error.name === "TimeoutError") throw error;
      return undefined;
    } finally { controller.abort(); }
  };
  return {
    post: (suffix, body, signal) => request(suffix, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal }),
    rawBlob: path => request(`/raw?path=${encodeURIComponent(path)}`, {}, true),
    async probe(signal) {
      try {
        const value = await request("/ping", { signal });
        return value?.service === "dsh-right" ? { available: true, ...value } : { available: false, code: "host-unavailable" };
      } catch (error) { return { available: false, code: error.code ?? error.name }; }
    }
  };
}
