import { appendFileSync } from "node:fs"
import { basename } from "node:path"
const log = o => appendFileSync(process.env.PROBE_TRACE || "trace.jsonl", JSON.stringify(o) + "\n")
const shape = v => v && typeof v === "object" ? Object.keys(v) : typeof v
export default {
  id: "probe.workspace",
  async setup(ctx) {
    const id = Math.random().toString(36).slice(2, 8)
    log({ ev: "setup", id, ctxKeys: Object.keys(ctx), location: ctx.location && { keys: Object.keys(ctx.location), dir: ctx.location.directory && basename(ctx.location.directory) }, directory: ctx.directory && basename(ctx.directory), cwd: basename(process.cwd()) })
    await ctx.session.hook("prompt", async event => {
      let info = null
      try { const s = await ctx.session.get({ sessionID: event.sessionID }); info = { keys: shape(s), dir: s && (s.directory || s.location?.directory) ? basename(s.directory || s.location.directory) : null, location: shape(s?.location) } } catch (e) { info = { error: String(e).slice(0, 80) } }
      log({ ev: "prompt", id, eventKeys: Object.keys(event), eventLocation: shape(event.location), session: info })
    })
  },
}
