import { appendFileSync } from "node:fs"
const OUT = process.env.EVENT_TRACE_OUT
const shape = v => v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x && typeof x === "object" && !Array.isArray(x) ? shape(x) : typeof x])) : typeof v
export default {
  id: "probe.event-trace",
  async setup(ctx) {
    const ac = new AbortController()
    ;(async () => { try { for await (const raw of ctx.event.subscribe({ signal: ac.signal })) appendFileSync(OUT, JSON.stringify({ t: Date.now(), type: raw.type, sid: raw.data?.sessionID ? "data.sessionID" : null, shape: shape(raw) }) + "\n") } catch (e) { appendFileSync(OUT, JSON.stringify({ err: String(e) }) + "\n") } })()
    return async () => ac.abort()
  },
}
