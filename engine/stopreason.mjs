// Why a build stopped or a turn failed, in words for the chat and the status pill: {code, message, action}.
// The table itself is web/stopreason.js, so the page reads the same one (page code stays in web/, and the
// server already reads web/route.js): the codes, the words and the rule for what counts as a raw error are there.
export * from '../web/stopreason.js'
