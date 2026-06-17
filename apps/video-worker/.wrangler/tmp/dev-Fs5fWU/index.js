var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/grant.ts
var encoder = new TextEncoder();
var decoder = new TextDecoder();
function base64UrlToBytes(s) {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - b64.length % 4);
  const bin = atob(b64 + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
__name(base64UrlToBytes, "base64UrlToBytes");
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
__name(timingSafeEqual, "timingSafeEqual");
async function importKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
}
__name(importKey, "importKey");
async function verifyGrant(token, secret) {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const encoded = parts[0];
  const sig = parts[1];
  let key;
  try {
    key = await importKey(secret);
  } catch {
    return null;
  }
  const expected = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(encoded)));
  let got;
  try {
    got = base64UrlToBytes(sig);
  } catch {
    return null;
  }
  if (!timingSafeEqual(expected, got)) return null;
  let payload;
  try {
    payload = JSON.parse(decoder.decode(base64UrlToBytes(encoded)));
  } catch {
    return null;
  }
  if (typeof payload.exp === "number" && Date.now() > payload.exp) return null;
  return payload;
}
__name(verifyGrant, "verifyGrant");

// src/index.ts
var DEFAULT_COOKIE = "mdn_video";
function isTrue(v) {
  return v === "true" || v === "1";
}
__name(isTrue, "isTrue");
function allowedOrigins(env) {
  return (env.ALLOWED_ORIGIN ?? "").split(",").map((s) => s.trim()).filter((s) => s.length > 0);
}
__name(allowedOrigins, "allowedOrigins");
function corsHeaders(req, env) {
  const h = new Headers();
  h.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  h.set("Vary", "Origin");
  const origin = req.headers.get("Origin");
  const allow = allowedOrigins(env);
  if (origin && allow.includes(origin)) {
    h.set("Access-Control-Allow-Origin", origin);
    h.set("Access-Control-Allow-Credentials", "true");
  }
  return h;
}
__name(corsHeaders, "corsHeaders");
function authConfigOk(env) {
  if (env.ENVIRONMENT === "production") {
    return allowedOrigins(env).length > 0;
  }
  return true;
}
__name(authConfigOk, "authConfigOk");
function json(body, status, headers) {
  const h = headers ? new Headers(headers) : new Headers();
  h.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status, headers: h });
}
__name(json, "json");
function readCookie(req, name) {
  const raw = req.headers.get("Cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    if (k === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}
__name(readCookie, "readCookie");
function parseRange(header) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return "invalid";
  const startStr = m[1];
  const endStr = m[2];
  if (startStr === "" && endStr === "") return "invalid";
  if (startStr === "") {
    const suffix = Number(endStr);
    if (!Number.isFinite(suffix) || suffix <= 0) return "invalid";
    return { suffix };
  }
  const offset = Number(startStr);
  if (!Number.isFinite(offset)) return "invalid";
  if (endStr === "") return { offset };
  const end = Number(endStr);
  if (!Number.isFinite(end) || end < offset) return "invalid";
  return { offset, length: end - offset + 1 };
}
__name(parseRange, "parseRange");
async function authorizeFileRequest(req, env, cookieName, key) {
  const token = readCookie(req, cookieName);
  if (!token) return new Response("unauthorized", { status: 401 });
  const grant = await verifyGrant(token, env.VIDEO_GRANT_SECRET);
  if (!grant) return new Response("unauthorized", { status: 401 });
  if (grant.key !== key) return new Response("forbidden", { status: 403 });
  if (isTrue(env.ENFORCE_IP)) {
    const ip = req.headers.get("cf-connecting-ip") ?? "";
    if (grant.ip && !ip) {
      console.warn("[video-worker] ENFORCE_IP: \u0E02\u0E32\u0E14 cf-connecting-ip \u2014 \u0E1B\u0E0F\u0E34\u0E40\u0E2A\u0E18 (fail-closed)");
      return new Response("forbidden", { status: 403 });
    }
    if (grant.ip && ip && grant.ip !== ip) return new Response("forbidden", { status: 403 });
  }
  return null;
}
__name(authorizeFileRequest, "authorizeFileRequest");
async function handleAuth(req, url, env, cookieName) {
  const cors = corsHeaders(req, env);
  if (!authConfigOk(env)) {
    console.error("[video-worker] ALLOWED_ORIGIN \u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E31\u0E49\u0E07\u0E43\u0E19 production \u2014 \u0E1B\u0E0F\u0E34\u0E40\u0E2A\u0E18 /__auth");
    return json({ error: "server_misconfigured" }, 500, cors);
  }
  const token = url.searchParams.get("token");
  if (!token) return json({ error: "missing_token" }, 400, cors);
  const grant = await verifyGrant(token, env.VIDEO_GRANT_SECRET);
  if (!grant) return json({ error: "invalid_token" }, 401, cors);
  if (isTrue(env.ENFORCE_IP)) {
    const ip = req.headers.get("cf-connecting-ip") ?? "";
    if (grant.ip && !ip) {
      console.warn("[video-worker] ENFORCE_IP: \u0E02\u0E32\u0E14 cf-connecting-ip \u0E17\u0E35\u0E48 /__auth \u2014 \u0E1B\u0E0F\u0E34\u0E40\u0E2A\u0E18 (fail-closed)");
      return json({ error: "ip_unavailable" }, 403, cors);
    }
    if (grant.ip && ip && grant.ip !== ip) return json({ error: "ip_mismatch" }, 403, cors);
  }
  const maxAge = Math.max(0, Math.floor((grant.exp - Date.now()) / 1e3));
  const cookie = `${cookieName}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=${maxAge}`;
  const headers = new Headers(cors);
  headers.set("Set-Cookie", cookie);
  return new Response(null, { status: 204, headers });
}
__name(handleAuth, "handleAuth");
var MEDIA_CACHE_CONTROL = "private, no-cache";
function resolveRange(r2Range, total) {
  if ("suffix" in r2Range) {
    const len = Math.min(r2Range.suffix, total);
    if (len <= 0) return "unsatisfiable";
    return { offset: total - len, length: len };
  }
  const offset = r2Range.offset ?? 0;
  if (offset >= total) return "unsatisfiable";
  const requested = r2Range.length ?? total - offset;
  const length = Math.min(requested, total - offset);
  if (length <= 0) return "unsatisfiable";
  return { offset, length };
}
__name(resolveRange, "resolveRange");
async function handleFile(req, url, env, cookieName) {
  const key = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  if (!key) return new Response("not found", { status: 404 });
  const denied = await authorizeFileRequest(req, env, cookieName, key);
  if (denied) return denied;
  if (req.method === "HEAD") {
    const head = await env.MOVIES_BUCKET.head(key);
    if (!head) return new Response("not found", { status: 404 });
    const headers2 = new Headers();
    head.writeHttpMetadata(headers2);
    headers2.set("Content-Type", head.httpMetadata?.contentType ?? "video/mp4");
    headers2.set("Content-Length", String(head.size));
    headers2.set("Accept-Ranges", "bytes");
    headers2.set("Cache-Control", MEDIA_CACHE_CONTROL);
    return new Response(null, { status: 200, headers: headers2 });
  }
  const rangeHeader = req.headers.get("Range");
  let r2Range;
  if (rangeHeader) {
    const parsed = parseRange(rangeHeader);
    if (parsed === "invalid") {
      const head = await env.MOVIES_BUCKET.head(key);
      const h416 = new Headers();
      if (head) h416.set("Content-Range", `bytes */${head.size}`);
      return new Response("range not satisfiable", { status: 416, headers: h416 });
    }
    r2Range = parsed;
  }
  if (!r2Range) {
    const object2 = await env.MOVIES_BUCKET.get(key, { onlyIf: req.headers });
    if (!object2) return new Response("not found", { status: 404 });
    const total2 = object2.size;
    if (!("body" in object2)) {
      const h304 = new Headers();
      object2.writeHttpMetadata(h304);
      if (object2.httpEtag) h304.set("ETag", object2.httpEtag);
      h304.set("Cache-Control", MEDIA_CACHE_CONTROL);
      h304.set("Accept-Ranges", "bytes");
      return new Response(null, { status: 304, headers: h304 });
    }
    const headers2 = new Headers();
    object2.writeHttpMetadata(headers2);
    headers2.set("Content-Type", object2.httpMetadata?.contentType ?? "video/mp4");
    headers2.set("Accept-Ranges", "bytes");
    headers2.set("Cache-Control", MEDIA_CACHE_CONTROL);
    if (object2.httpEtag) headers2.set("ETag", object2.httpEtag);
    headers2.set("Content-Length", String(total2));
    return new Response(object2.body, { status: 200, headers: headers2 });
  }
  const object = await env.MOVIES_BUCKET.get(key, { range: r2Range });
  if (!object) return new Response("not found", { status: 404 });
  const total = object.size;
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Content-Type", object.httpMetadata?.contentType ?? "video/mp4");
  headers.set("Accept-Ranges", "bytes");
  headers.set("Cache-Control", MEDIA_CACHE_CONTROL);
  if (object.httpEtag) headers.set("ETag", object.httpEtag);
  const resolved = resolveRange(r2Range, total);
  if (resolved === "unsatisfiable") {
    const h416 = new Headers();
    h416.set("Content-Range", `bytes */${total}`);
    h416.set("Accept-Ranges", "bytes");
    return new Response("range not satisfiable", { status: 416, headers: h416 });
  }
  const { offset, length } = resolved;
  const end = offset + length - 1;
  headers.set("Content-Range", `bytes ${offset}-${end}/${total}`);
  headers.set("Content-Length", String(length));
  return new Response(object.body, { status: 206, headers });
}
__name(handleFile, "handleFile");
var src_default = {
  async fetch(req, env) {
    const url = new URL(req.url);
    const cookieName = env.COOKIE_NAME || DEFAULT_COOKIE;
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(req, env) });
    }
    if (url.pathname === "/__auth") {
      return handleAuth(req, url, env, cookieName);
    }
    if (req.method === "GET" || req.method === "HEAD") {
      return handleFile(req, url, env, cookieName);
    }
    return new Response("method not allowed", { status: 405 });
  }
};

// ../../../../../../private/var/folders/2h/q2lnkqfj7ng0rwr_880xbb4m0000gq/T/bunx-503-wrangler@latest/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../../../../../private/var/folders/2h/q2lnkqfj7ng0rwr_880xbb4m0000gq/T/bunx-503-wrangler@latest/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-PfGQoW/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// ../../../../../../private/var/folders/2h/q2lnkqfj7ng0rwr_880xbb4m0000gq/T/bunx-503-wrangler@latest/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-PfGQoW/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
