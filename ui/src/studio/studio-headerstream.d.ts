// The types of web/headerstream.js (`@studio/headerstream`, resolved by vite.config.ts): the server's token in its
// header for the event stream, a picture stream and a download, the same in both apps. tests/next.test.mjs checks
// every name is exported.
export declare const TOKEN_HEADER: string
export declare function sseEvents(text: string): { events: string[], rest: string }
export declare function eventStream(url: string, o: { token?: string, onMessage: (m: { data: string }) => void, onOpen?: () => void, retryMs?: number, fetchImpl?: typeof fetch }): { close: () => void, opened: Promise<void> }
export declare function multipartFrames(bytes: Uint8Array): { frames: { type: string, body: Uint8Array }[], rest: Uint8Array }
export declare function frameStream(url: string, o: { token?: string, onFrame: (b: Blob) => void, onEnd?: () => void, fetchImpl?: typeof fetch }): { close: () => void }
export declare function download(url: string, o: { token?: string, name: string, fetchImpl?: typeof fetch, doc?: Document }): Promise<void>
