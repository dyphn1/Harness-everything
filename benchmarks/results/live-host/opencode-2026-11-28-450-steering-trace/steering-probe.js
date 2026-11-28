// key-only steering probe (#450): logs hook/event type, key names, value types, pseudonymous ids and order. No text.
import { appendFileSync } from "node:fs"
const OUT = process.env.STEER_TRACE_OUT
const ids = new Map(); const pid = (v, p) => { if (typeof v !== "string" || !v) return v == null ? null : typeof v; if (!ids.has(v)) ids.set(v, p + (ids.size + 1)); return ids.get(v) }
const shape = v => v && typeof v === "object" ? (Array.isArray(v) ? ["array", v.length] : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x && typeof x === "object" ? shape(x) : typeof x]))) : typeof v
const log = o => appendFileSync(OUT, JSON.stringify({ t: Date.now(), ...o }) + "\n")
export default {
  id: "probe.steer-trace",
  async setup(ctx) {
    const ac = new AbortController()
    ctx.session.hook("prompt", async (e) => { log({ hook: "prompt", sid: pid(e?.sessionID, "s"), mid: pid(e?.messageID ?? e?.messageId, "m"), keys: Object.keys(e || {}), delivery: shape(e?.delivery), metadata: shape(e?.metadata) }) })
    ctx.session.hook("context", async (e) => { log({ hook: "context", sid: pid(e?.sessionID, "s"), keys: Object.keys(e || {}), messages: Array.isArray(e?.messages) ? e.messages.map(m => ({ id: pid(m?.id ?? m?.info?.id, "m"), role: m?.role ?? m?.info?.role ?? m?.type ?? null })) : shape(e?.messages) }) })
    ;(async () => { try { for await (const raw of ctx.event.subscribe({ signal: ac.signal })) { const d = raw?.data || {}; log({ event: raw.type, sid: pid(d.sessionID, "s"), mid: pid(d.messageID ?? d.messageId ?? d.info?.id ?? d.part?.messageID, "m"), dataKeys: Object.keys(d) }) } } catch (e) { log({ err: String(e).slice(0, 120) }) } })()
    return async () => ac.abort()
  },
}
