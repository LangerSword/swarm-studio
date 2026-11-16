// @ts-check
// Why something stopped or failed, in words for a person: {code, message, action}. The ONE place a raw failure
// (a provider's "HTTP 500 {…}", ECONNREFUSED, a timeout, an empty plan) becomes plain words: a stopped build, a
// talk turn the planner did not answer, a planner's retry during a build and Fix mode all read it, on the server
// (engine/stopreason.mjs hands this file on) and in the page (server/page.mjs joins it in). The raw text is the
// Log's, never the chat's. The codes are a closed set:
//   person   the person pressed Stop
//   replaced a newer build started (only one website build runs at a time)
//   hermes   Hermes went away or was never there (engine/hermeshealth.mjs says which)
//   model    the model's provider refused, failed or answered with nothing, with the provider's own reason
//   timeout  the model took too long
//   setup    no model is set up yet
//   nothing  the model answered, and found nothing to add from the message
//   studio   something of the Studio's own failed (not the model, not Hermes)
//   retry    not a failure yet: the planner is asked once more
//   interrupted  a website build whose file had no end when the server started (it stopped mid-build)
// "Stopped before any page was planned." on its own told nobody anything.

export const CODES = ['person', 'replaced', 'hermes', 'model', 'timeout', 'setup', 'nothing', 'studio', 'retry', 'interrupted']
export const STOPS = {
  person: 'Stopped by you.',
  replaced: 'Stopped: a newer build started.',
  timeout: 'Stopped: the model took too long to answer.',
  // no end was ever written: Swarm Studio stopped mid-build, or a newer build took over (nobody knows which).
  // The server writes it when it starts (server/server.mjs closeStoppedBuilds); the same sentence a build with
  // no end has always read (web/replaytalk.js endWords)
  interrupted: 'This run stopped before it finished.'
}
export const PILL = { person: 'stopped', replaced: 'stopped: replaced', hermes: 'stopped: no Hermes', model: 'stopped: model', timeout: 'stopped: timed out' }

// What a raw failure looks like. Nothing that matches may reach the chat, a toast or a card: tests/stopreason.test.mjs
// runs every reason through it, and the walkthrough's failure steps read the chat with it.
export const RAW = /HTTP \d{3}|\{"|"\}|\[object Object\]|\bundefined\b|\bNaN\b|\bE[A-Z]{4,}\b|\b\w*Error:|fetch failed|socket hang up|other side closed|\n\s+at /
/** @param {unknown} text */
export const isRaw = text => RAW.test(String(text ?? ''))
// a provider's own text quoted in a sentence somebody else wrote (a model's answer in Fix mode, which may rightly
// name ENOENT or a missing module): the narrow rule
export const QUOTED_RAW = /HTTP \d{3}|\{"error"|ECONN|\[object Object\]/

// What a run's controller was aborted with: 'person', 'replaced', or Hermes's {code: 'hermes_…', message, action}
/** @param {any} r */
export function reasonFromAbort(r) {
  if (r && typeof r === 'object' && typeof r.code === 'string' && typeof r.message === 'string') {
    return { code: r.code.startsWith('hermes') ? 'hermes' : r.code, message: r.message, action: String(r.action || '') }
  }
  if (r === 'replaced') return { code: 'replaced', message: STOPS.replaced, action: '' }
  return { code: 'person', message: STOPS.person, action: '' }
}

// The provider's own words from a failed call's text ("planner: HTTP 402 {"error":{"message":"…"}}")
/** @param {unknown} text */
export function providerSaid(text) {
  const t = String(text || '')
  const json = t.match(/HTTP \d{3}\s*(\{[\s\S]*)$/)
  if (json) {
    try {
      const e = JSON.parse(json[1]).error
      const said = typeof e === 'string' ? e : e?.message
      if (said) return String(said)
    } catch {}
    const loose = json[1].match(/"message"\s*:\s*"((?:[^"\\]|\\.){1,300})/)
    if (loose) return loose[1].replace(/\\"/g, '"')
  }
  return ''
}

// a status with no words of the provider's own, said plainly (never "HTTP 500")
const SR_STATUS = { 401: 'the key was refused', 403: 'the key was refused', 402: 'out of credit', 404: 'no such model', 429: 'too many requests' }
const SR_BROKE = /terminated|ECONNRESET|ECONNREFUSED|socket hang up|fetch failed|other side closed/i
const SR_SLOW = /abort|timed? ?out|took too long|stall/i
// the model answered, with nothing that could be used
const SR_EMPTY = /came back empty|did not answer|did not write a brief|no layers parsed/i
const SR_NO_MODEL = /No planner model|No model key|no model (?:is )?set/i
const SR_NOTHING = /nothing to add from that message/i
// a failure that names the model or the way to it; anything else is the Studio's own
const SR_MODEL = /\bmodels?\b|planner|provider|network|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|EPIPE|certificate/i

/**
 * A failed model call's text (an 'error' event's message, a thrown error's) as a reason.
 * viaHermes: the call went through Hermes, so a connection that broke part way is Hermes going away, not the model.
 * ended: nothing "Stopped" (a build that ran to its end with sections failed, a talk turn): the words say what
 * happened. resume: sections are kept and Resume is the way on, so the action names Resume, not Try again
 * (engine/buildstate.mjs `next`). talk: a turn of the chat, not a build: nothing was being built, so nothing is
 * "kept" and nothing "goes on".
 * @param {unknown} text
 * @param {{ viaHermes?: boolean, ended?: boolean, resume?: boolean, talk?: boolean }} [o]
 * @returns {{ code: string, message: string, action: string }}
 */
export function reasonFromFailure(text, { viaHermes = false, ended = false, resume = false, talk = false } = {}) {
  const t = String(text || '')
  const lead = ended || talk ? 'The' : 'Stopped: the'
  const again = resume ? 'Resume' : 'Try again', then = resume ? 'resume' : 'try again'
  const status = Number((t.match(/HTTP (\d{3})/) || [])[1]) || 0
  const another = `${again}, or pick another model in \`hermes model\`.`
  if (!status && viaHermes && SR_BROKE.test(t)) {
    return talk ? { code: 'hermes', message: "Hermes isn't connected.", action: `Open Hermes Desktop, or run \`hermes swarm\`, then ${then}.` }
      : { code: 'hermes', message: 'Hermes closed during the build. What was built is kept.', action: 'Open Hermes again and the build goes on.' }
  }
  if (!status && SR_SLOW.test(t)) return { code: 'timeout', message: `${lead} model took too long to answer.`, action: `${again}; if it keeps happening, pick a faster model in \`hermes model\`.` }
  if (/Hermes isn't connected|Restart Hermes to finish|hermes_(closed|updated)/.test(t)) {
    const updated = /Restart Hermes|hermes_updated/.test(t)
    return { code: 'hermes', message: updated ? 'Swarm Studio was updated. Restart Hermes to finish.' : "Hermes isn't connected.", action: updated ? 'Run `hermes gateway restart`, or quit Hermes Desktop and open it again.' : `Open Hermes Desktop, or run \`hermes swarm\`, then ${then}.` }
  }
  if (!status && SR_NO_MODEL.test(t)) {
    return /planner/i.test(t) ? { code: 'setup', message: 'No planner model yet.', action: 'Pick one in Models.' }
      : { code: 'setup', message: 'No model key yet.', action: 'Start a build from Hermes once (`hermes swarm`) so it can pass its model settings.' }
  }
  if (!status && SR_NOTHING.test(t)) return { code: 'nothing', message: 'Nothing to add from that message.', action: 'Name a page or a section.' }
  if (!status && SR_EMPTY.test(t)) return { code: 'model', message: `${lead} model didn't answer.`, action: another }
  if (!status && !SR_BROKE.test(t) && !SR_MODEL.test(t)) return { code: 'studio', message: ended || talk ? 'Something went wrong in the Studio.' : 'Stopped: something went wrong in the Studio.', action: `${again}. The Log has the details.` }
  // the provider's own reason, when it is words; its JSON, a status line or a code is the Log's
  const own = providerSaid(t).replace(/\s+/g, ' ').trim().slice(0, 200)
  const said = own && !isRaw(own) ? own.replace(/[.\s]+$/, '') : SR_STATUS[/** @type {keyof typeof SR_STATUS} */ (status)] || ''
  const action = status === 402 ? `Check the provider's credit or budget cap, then ${then}.`
    : status === 429 ? `Wait a minute, then ${then}.`
      : status === 401 || status === 403 ? 'Check the model key in Hermes (`hermes model`).'
        : another
  return { code: 'model', message: `${lead} model didn't answer${said ? ` (${said})` : ''}.`, action }
}

/**
 * A talk turn that failed (the planner's chat, Ask, a brief being written), from the thrown error: the reason
 * and the one thing to do. Never Hermia's words.
 * @param {any} err  @param {{ viaHermes?: boolean }} [o]
 */
export function reasonFromTalk(err, { viaHermes = false } = {}) {
  // Hermes's own answer through the bridge ({code: 'hermes_…', message, action}, engine/llm.mjs)
  if (err?.hermes && typeof err.hermes.message === 'string' && !isRaw(err.hermes.message)) return { code: 'hermes', message: err.hermes.message, action: String(err.hermes.action || '') }
  return reasonFromFailure(err?.message ?? err, { viaHermes, talk: true })
}

/**
 * One 'error' event of a build ({where, message}) for the chat. A retry in progress is `retry`, said once; the
 * rest are reasons like any other (the build's end says them: engine/buildstate.mjs `reason`).
 * @param {{ where?: string, message?: string }} e  @param {{ viaHermes?: boolean }} [o]
 */
export function reasonFromError(e, o = {}) {
  const t = String(e?.message || '')
  if (/trying once more|replanning/i.test(t)) return { code: 'retry', message: 'The plan came back empty. Trying once more.', action: '' }
  return reasonFromFailure(t, { ...o, ended: true })
}

/** A reason in one line, for a place that has only a line (an answer's `error`).  @param {{ message: string, action?: string }} r */
export const reasonLine = r => [r.message, String(r.action || '').replace(/`/g, '')].filter(Boolean).join(' ')
