// The types of web/researchstop.js (`@studio/researchstop`, resolved by vite.config.ts): a build that looked
// something up stops with what it found (decision 0025), shown the same way in both apps. tests/next.test.mjs checks
// every name is exported.
export type Finding = { url: string, title: string, took: string, query?: string }
export type Stop = { error: 'research', ask: string, project?: string | null, findings: Finding[], note?: string, refs?: { id: string, url: string }[] }
export type Item = { key: string, url: string, title: string, took: string, host: string, ref: string | null }
export declare function isResearchStop(j: unknown): j is Stop
export declare function stopText(j: Stop): string
export declare function stopItems(j: Stop): Item[]
export declare function againBody(j: Stop, kept: Item[]): { researched: true, found?: Finding[] }
export declare function takeOut(j: Stop, item: Item, post: (path: string, body: object) => Promise<unknown>): Promise<void>
