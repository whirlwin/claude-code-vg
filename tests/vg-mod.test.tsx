import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock, Mounted } from 'claude-code/testing'
import type { On, RenderElement, RenderPropsOf } from 'claude-code'

import { FEED_URL, REFRESH_MS } from '../hooks/vg'
import { FRAMES_PER_STORY, TICK_MS } from '../hooks/logo'

const SURFACES = ['terminal', 'desktop'] as const
const SPINNER = { word: 'Baking', message: null, suffix: '\u2026', mode: 'responding' as const }
const ENDED = { answer: '', durationMs: 1000, isAborted: false, reason: 'answer' } as const
const SLASH_VG = {
  command: 'vg',
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 120 },
} as const
const SLASH_NEXT = { ...SLASH_VG, args: 'next' } as const
// Copies of the hooks module's timing, which it keeps private: a running turn
// checks each second whether the feed is due, tries a failed one again after
// 30 s, and gives up on a fetch after 8 s.
const POLL_MS = 1000
const RETRY_MS = 30 * 1000
const TIMEOUT_MS = 8 * 1000
const ARTICLE_MS = FRAMES_PER_STORY * TICK_MS

// Five real items in the order VG's feed sent them on 25 October 2026, cut to
// the fields the mod reads: three articles with a goal clip and a MinMote
// partner item between them, which leave no gap in the ranks.
const AALESUND = {
  title: 'Aalesund raknet med ti mann',
  pubDate: 'Sun, 25 Oct 2026 18:01:11 GMT',
  description: 'Aalesund ble redusert til ti mann i første omgang, og måtte gi tapt med 1-2 etter et stormløp fra Sarpsborg i Eliteserien søndag.',
  link: 'https://www.vg.no/sport/i/77aWL9/aalesund-raknet-med-ti-mann',
  category: 'Sport',
}
const CLIP = {
  title: 'Douglas Luiz med scoring for Juventus',
  pubDate: 'Sun, 25 Oct 2026 17:51:56 GMT',
  link: 'https://www.vg.no/sport/i/oKoXlg/douglas-luiz-med-scoring-for-juventus',
  category: 'Sport',
}
const E6 = {
  title: 'Oversvømmelse: E6 stengt mellom Lillehammer og Biri',
  pubDate: 'Sun, 25 Oct 2026 17:39:08 GMT',
  description: 'E6 mellom Lillehammer og Biri er stengt i begge retninger etter oversvømmelser i veibanen.',
  link: 'https://www.vg.no/nyheter/i/jv5Rpb/oversvoemmelse-e6-stengt-mellom-lillehammer-og-biri',
  category: 'Nyheter',
}
const MINMOTE = {
  title: 'Kris Jenner hyllet Elizabeth Taylor',
  pubDate: 'Sun, 25 Oct 2026 17:22:00 GMT',
  description: 'Kappen har en helt spesiell Hollywood-historie bak seg.',
  link: 'https://www.vg.no/i/X9mKEE/kris-jenner-hyllet-elizabeth-taylor-med-ikonisk-kappe-i-roma',
  category: 'MinMote',
}
const MEGHAN = {
  title: 'BBC: Meghan Markle advarte faren i brev',
  pubDate: 'Sun, 25 Oct 2026 17:01:40 GMT',
  description: 'Hertuginne Meghan skal i fjor ha skrevet til faren Thomas Markle (82) at hun visste om alvorlige overgrepsanklager mot ham. ',
  link: 'https://www.vg.no/rampelys/i/Qgv1E4/meghan-markle-advarte-faren-i-brev',
  category: 'Rampelys',
}
// An hour after the newest was published, and under two after the oldest, so
// each article reads `for 1 time siden`.
const HOUR_LATER = Date.UTC(2026, 9, 25, 19, 1, 11)

function item(fields: Record<string, string>): string {
  return `<item>${Object.entries(fields)
    .map(([name, text]) => `<${name}>${text}</${name}>`)
    .join('')}</item>`
}

type Answer = { status: number; text: string }
// How a test answers a URL otherwise than LATEST does (late, or with an
// error); undefined leaves it to LATEST.
type Change = (url: string) => Answer | undefined | Promise<Answer | undefined>

const LATEST: Answer = {
  status: 200,
  text:
    '<?xml version="1.0"?><rss xmlns:vg="http://www.vg.no/namespace" version="2.0"><channel>' +
    '<title>Siste nytt fra VG</title><ttl>10</ttl><link>http://www.vg.no/feed/rss</link>' +
    `${[AALESUND, CLIP, E6, MINMOTE, MEGHAN].map(item).join('')}</channel></rss>`,
}
const NOT_FOUND: Answer = { status: 404, text: 'Not Found' }
const DOWN: Answer = { status: 503, text: 'Service Unavailable' }

// VG beneath the plugin; `fetches` counts the requests for the feed.
function api(on: On, change: Change = () => undefined): { fetches: number } {
  const seen = { fetches: 0 }
  on('http.fetch', async (_, e) => {
    if (e.url === FEED_URL) seen.fetches += 1
    const answer = (await change(e.url)) ?? (e.url === FEED_URL ? LATEST : NOT_FOUND)
    return { value: { status: answer.status, ok: answer.status === 200, headers: {}, text: answer.text } }
  })
  return seen
}

// The feed answers 503 while `isDown` says so.
function feedDown(isDown: () => boolean = () => true): Change {
  return url => (url === FEED_URL && isDown() ? DOWN : undefined)
}

// The engine beneath: a session that starts, turns that start and end, a
// spinner drawn from the props it is handed, and a terminal that takes a
// blit while the spinner is up and denies one once it is gone.
function engine(on: On): { isUp: boolean } {
  const spinner = { isUp: true }
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.blit', () => ({ value: spinner.isUp ? {} : { deny: 'nothing of vg is mounted there' } }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    const props = e.props as { word: string; suffix: string }
    return h(Text, {}, `${props.word}${props.suffix}`) as RenderElement
  })
  return spinner
}

async function startSession($: Engine): Promise<void> {
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
}

async function startTurn($: Engine, clock: MockClock): Promise<void> {
  await startSession($)
  await $.turn.start({ text: 'hi', turnId: 'main' })
  await clock.advance(POLL_MS)
}

function mount<P extends (typeof SURFACES)[number]>($: Engine, surface: P, props: RenderPropsOf['Spinner'] = SPINNER) {
  return $.ui.mount({ plugin: 'vg', surface, component: 'Spinner', requestId: 'main', props })
}

// What a terminal shows of an element: the kit's own `text` of a Link
// carries its href too.
function shown(node: unknown): string {
  if (typeof node === 'string') return node
  if (typeof node !== 'object' || node === null || !('children' in node) || !Array.isArray(node.children)) return ''
  return node.children.map(shown).join('')
}

// The whole drawing as one string, the tree's or the engine's.
async function screen(ui: Pick<Mounted, 'drawn'>): Promise<string> {
  return shown(await ui.drawn())
}

// The lines beside the tile, the only Texts that truncate.
async function lines(ui: Pick<Mounted, 'findAll'>): Promise<string[]> {
  const texts = await ui.findAll({ type: 'Text' })
  return texts.filter(text => text.props.wrap === 'truncate-end').map(shown)
}

// How the column of lines sits beside the tile.
async function justified(ui: Pick<Mounted, 'findAll'>): Promise<unknown> {
  return (await ui.findAll({ type: 'Box' }))[1]?.props.justifyContent
}

describe('spinner', () => {
  test('draws the tile beside the article and its link in the terminal', async ($, on) => {
    const clock = mock.clock(on, { now: HOUR_LATER })
    engine(on)
    api(on)
    await startTurn($, clock)
    const ui = await mount($, 'terminal')

    expect(await ui.find({ type: 'Raster', key: 'vg' })).toBeDefined()
    // No domain after the title and no comments link after the age.
    expect(await lines(ui)).toEqual(['1. Aalesund raknet med ti mann', '   Sport · for 1 time siden (0s)'])
    expect(await justified(ui)).toBe('flex-start')
    expect((await ui.find({ type: 'Text', text: /^1\.$/ }))?.props.color).toBe('#dd1f02')
    const links = await ui.findAll({ type: 'Link' })
    expect(links.map(link => link.props.href)).toEqual([AALESUND.link])
    expect(links.map(shown)).toEqual(['Aalesund raknet med ti mann'])
  })

  test('redraws its own elapsed time each second, which the engine no longer draws', async ($, on) => {
    const clock = mock.clock(on, { now: HOUR_LATER })
    engine(on)
    api(on)
    await startTurn($, clock)
    const ui = await mount($, 'terminal')
    await clock.advance(5500)
    expect((await lines(ui))[1]).toMatch(/ \(5s\)$/)
  })

  test('only swaps the word where it cannot draw a raster', async ($, on) => {
    const clock = mock.clock(on, { now: HOUR_LATER })
    engine(on)
    api(on)
    await startTurn($, clock)
    const ui = await mount($, 'desktop')
    expect(await ui.find({ type: 'Raster' })).toBeUndefined()
    expect(await screen(ui)).toBe('1. Aalesund raknet med ti mann\u2026')
  })

  test('shows the engine word beside the tile before the first fetch', async ($, on) => {
    mock.clock(on, { now: HOUR_LATER })
    engine(on)
    api(on)
    await startSession($)
    await $.turn.start({ text: 'hi', turnId: 'main' })
    for (const surface of SURFACES) {
      const ui = await mount($, surface)
      expect(await ui.find({ type: 'Raster', key: 'vg' }), surface).toEqual(surface === 'terminal' ? expect.anything() : undefined)
      expect(await screen(ui)).toBe(surface === 'terminal' ? 'Baking\u2026 (0s)' : 'Baking\u2026')
      if (surface === 'terminal') expect(await justified(ui)).toBe('center')
      await ui.unmount()
    }
  })

  for (const surface of SURFACES) {
    test(`draws the article as soon as the first fetch lands on ${surface}`, async ($, on) => {
      const clock = mock.clock(on, { now: HOUR_LATER })
      engine(on)
      api(on)
      await startSession($)
      await $.turn.start({ text: 'hi', turnId: 'main' })
      const ui = await mount($, surface)
      expect(await screen(ui)).toMatch(/^Baking\u2026/)
      await clock.advance(POLL_MS)
      expect(await screen(ui)).toMatch(/^1\. Aalesund raknet med ti mann/)
    })
  }

  test('shows the engine word when the feed cannot be fetched, and /vg says why', async ($, on) => {
    const clock = mock.clock(on, { now: HOUR_LATER })
    engine(on)
    api(on, feedDown())
    await startTurn($, clock)
    for (const surface of SURFACES) {
      const ui = await mount($, surface)
      expect(await ui.find({ type: 'Raster', key: 'vg' }), surface).toEqual(surface === 'terminal' ? expect.anything() : undefined)
      expect(await screen(ui)).toMatch(/^Baking\u2026/)
      await ui.unmount()
    }
    expect((await $.command.run(SLASH_VG)).text).toBe('The spinner no longer shows VG.')
    expect((await $.command.run(SLASH_VG)).text).toBe(
      'The spinner shows the newest VG articles, but they could not be fetched: the VG feed answered 503',
    )
  })

  test('shows the engine message in place of the article', async ($, on) => {
    const clock = mock.clock(on, { now: HOUR_LATER })
    engine(on)
    api(on)
    await startTurn($, clock)
    const ui = await mount($, 'terminal', { ...SPINNER, message: 'Compacting conversation' })
    expect(await ui.find({ type: 'Raster', key: 'vg' })).toBeDefined()
    expect(await lines(ui)).toEqual(['Compacting conversation\u2026 (0s)'])
    expect(await justified(ui)).toBe('center')
    expect(await ui.find({ type: 'Link' })).toBeUndefined()
  })

  test('draws one ellipsis after a message that ends in one', async ($, on) => {
    const clock = mock.clock(on, { now: HOUR_LATER })
    engine(on)
    api(on)
    await startTurn($, clock)
    const ui = await mount($, 'terminal', { ...SPINNER, message: 'Compacting conversation\u2026' })
    expect(await lines(ui)).toEqual(['Compacting conversation\u2026 (0s)'])
  })

  test('ranks the articles past a clip and a partner item without a gap', async ($, on) => {
    const clock = mock.clock(on, { now: HOUR_LATER })
    engine(on)
    api(on)
    await startTurn($, clock)
    await $.command.run(SLASH_NEXT)
    expect((await $.command.run(SLASH_NEXT)).text).toBe('Next up: 3. BBC: Meghan Markle advarte faren i brev')
    const ui = await mount($, 'terminal')
    expect(await lines(ui)).toEqual(['3. BBC: Meghan Markle advarte faren i brev', '   Rampelys · for 1 time siden (0s)'])
    expect((await ui.findAll({ type: 'Link' })).map(link => link.props.href)).toEqual([MEGHAN.link])
  })

  test('links each article to its own page, under its own section', async ($, on) => {
    const clock = mock.clock(on, { now: HOUR_LATER })
    engine(on)
    api(on)
    await startTurn($, clock)
    expect((await $.command.run(SLASH_NEXT)).text).toBe('Next up: 2. Oversvømmelse: E6 stengt mellom Lillehammer og Biri')
    const ui = await mount($, 'terminal')
    expect(await lines(ui)).toEqual(['2. Oversvømmelse: E6 stengt mellom Lillehammer og Biri', '   Nyheter · for 1 time siden (0s)'])
    expect((await ui.findAll({ type: 'Link' })).map(link => link.props.href)).toEqual([E6.link])
  })

  for (const surface of SURFACES) {
    test(`rotates through the articles and back to the newest on ${surface}`, async ($, on) => {
      const clock = mock.clock(on, { now: HOUR_LATER })
      engine(on)
      api(on)
      await startTurn($, clock)
      const ui = await mount($, surface)
      expect(await screen(ui)).toMatch(/^1\. Aalesund raknet med ti mann/)
      await clock.advance(ARTICLE_MS)
      expect(await screen(ui)).toMatch(/^2\. Oversvømmelse: E6 stengt/)
      await clock.advance(2 * ARTICLE_MS)
      expect(await screen(ui)).toMatch(/^1\. Aalesund raknet med ti mann/)
    })
  }

  test('starts at rank 1 when the first list comes late', async ($, on) => {
    const clock = mock.clock(on, { now: HOUR_LATER })
    engine(on)
    let isDown = true
    api(on, feedDown(() => isDown))
    await startTurn($, clock)
    const ui = await mount($, 'terminal')
    isDown = false
    // The tile rolls on through the wait, long enough to reach another article.
    await clock.advance(RETRY_MS)
    expect(await screen(ui)).toMatch(/^1\. Aalesund raknet med ti mann/)
  })

  test('picks the rotation up where it left off at the next turn', async ($, on) => {
    const clock = mock.clock(on, { now: HOUR_LATER })
    const spinner = engine(on)
    api(on)
    await startTurn($, clock)
    let ui = await mount($, 'terminal')
    await clock.advance(ARTICLE_MS / 2)
    spinner.isUp = false
    await ui.unmount()
    await $.turn.complete({ ...ENDED, turnId: 'main' })
    await clock.advance(60 * 1000)

    await $.turn.start({ text: 'again', turnId: 'next' })
    spinner.isUp = true
    ui = await mount($, 'terminal')
    expect(await screen(ui)).toMatch(/^1\. Aalesund raknet med ti mann/)
    expect((await lines(ui))[1]).toMatch(/ \(0s\)$/)
    await clock.advance(ARTICLE_MS / 2)
    expect(await screen(ui)).toMatch(/^2\. Oversvømmelse/)
  })

  test('starts its elapsed time afresh each turn, even after hiding mid-turn', async ($, on) => {
    const clock = mock.clock(on, { now: HOUR_LATER })
    engine(on)
    api(on)
    await startTurn($, clock)
    let ui = await mount($, 'terminal')
    await clock.advance(3000)
    await $.command.run(SLASH_VG)
    await ui.unmount()
    await $.turn.complete({ ...ENDED, turnId: 'main' })
    await clock.advance(60 * 1000)

    await $.command.run(SLASH_VG)
    await $.turn.start({ text: 'again', turnId: 'next' })
    ui = await mount($, 'terminal')
    expect((await lines(ui))[1]).toMatch(/ \(0s\)$/)
  })

  test('does not rotate while hidden', async ($, on) => {
    const clock = mock.clock(on, { now: HOUR_LATER })
    engine(on)
    api(on)
    await startTurn($, clock)
    const ui = await mount($, 'terminal')
    await $.command.run(SLASH_VG)
    await clock.advance(2 * ARTICLE_MS)
    await $.command.run(SLASH_VG)
    expect(await screen(ui)).toMatch(/^1\. Aalesund raknet med ti mann/)
  })

  test('does not rotate a word drawn after the main turn ended', async ($, on) => {
    const clock = mock.clock(on, { now: HOUR_LATER })
    engine(on)
    api(on)
    await startTurn($, clock)
    const ui = await mount($, 'desktop')
    await $.turn.complete({ ...ENDED, turnId: 'main' })
    await ui.redraw()
    await clock.advance(ARTICLE_MS)
    expect(await screen(ui)).toBe('1. Aalesund raknet med ti mann\u2026')
  })

  test('/vg hides the articles and shows them again', async ($, on) => {
    const clock = mock.clock(on, { now: HOUR_LATER })
    engine(on)
    api(on)
    await startTurn($, clock)
    for (const surface of SURFACES) {
      const ui = await mount($, surface)
      expect((await $.command.run(SLASH_VG)).text).toBe('The spinner no longer shows VG.')
      expect(await ui.find({ type: 'Raster' })).toBeUndefined()
      expect(await screen(ui)).toBe('Baking\u2026')

      expect((await $.command.run(SLASH_VG)).text).toBe('The spinner shows the newest VG articles.')
      expect(await screen(ui)).toMatch(/^1\. Aalesund raknet med ti mann/)
      await ui.unmount()
    }
  })

  test('/vg next shows the articles again and skips one', async ($, on) => {
    const clock = mock.clock(on, { now: HOUR_LATER })
    engine(on)
    api(on)
    await startTurn($, clock)
    const ui = await mount($, 'terminal')
    await $.command.run(SLASH_VG)
    expect(await ui.find({ type: 'Raster' })).toBeUndefined()
    expect((await $.command.run(SLASH_NEXT)).text).toBe('Next up: 2. Oversvømmelse: E6 stengt mellom Lillehammer og Biri')
    expect(await ui.find({ type: 'Raster', key: 'vg' })).toBeDefined()
    expect(await screen(ui)).toMatch(/^2\. Oversvømmelse/)
  })
})

describe('fetching', () => {
  test('fetches only while a turn runs', async ($, on) => {
    const clock = mock.clock(on, { now: HOUR_LATER })
    engine(on)
    const seen = api(on)
    await startSession($)
    await clock.advance(REFRESH_MS * 2)
    expect(seen.fetches).toBe(0)
    await $.turn.start({ text: 'hi', turnId: 'main' })
    await clock.advance(POLL_MS)
    expect(seen.fetches).toBe(1)
    await $.turn.complete({ ...ENDED, turnId: 'main' })
    await clock.advance(REFRESH_MS * 2)
    expect(seen.fetches).toBe(1)
  })

  test('does not fetch while hidden, turn or not', async ($, on) => {
    const clock = mock.clock(on, { now: HOUR_LATER })
    engine(on)
    const seen = api(on)
    await startSession($)
    await $.command.run(SLASH_VG)
    await $.turn.start({ text: 'hi', turnId: 'main' })
    await clock.advance(REFRESH_MS * 2)
    expect(seen.fetches).toBe(0)
  })

  test('fetches again REFRESH_MS into a long turn', async ($, on) => {
    const clock = mock.clock(on, { now: HOUR_LATER })
    engine(on)
    const seen = api(on)
    await startTurn($, clock)
    expect(seen.fetches).toBe(1)
    await clock.advance(REFRESH_MS - POLL_MS)
    expect(seen.fetches).toBe(1)
    await clock.advance(POLL_MS)
    expect(seen.fetches).toBe(2)
  })

  test('follows the main loop: a subagent turn neither stops nor starts the fetches', async ($, on) => {
    const clock = mock.clock(on, { now: HOUR_LATER })
    engine(on)
    const seen = api(on)
    await startTurn($, clock)
    await $.turn.complete({ ...ENDED, turnId: 'sub', agentId: 'agent-1' })
    await clock.advance(REFRESH_MS)
    expect(seen.fetches).toBe(2)
    await $.turn.complete({ ...ENDED, turnId: 'main' })
    await $.turn.start({ text: 'task', turnId: 'sub-2', agentId: 'agent-2' })
    await $.turn.complete({ ...ENDED, turnId: 'sub-2', agentId: 'agent-2' })
    await clock.advance(REFRESH_MS * 2)
    expect(seen.fetches).toBe(2)
  })

  test('tries again RETRY_MS after a failure that left no list', async ($, on) => {
    const clock = mock.clock(on, { now: HOUR_LATER })
    engine(on)
    const seen = api(on, feedDown())
    await startTurn($, clock)
    expect(seen.fetches).toBe(1)
    await clock.advance(RETRY_MS - POLL_MS)
    expect(seen.fetches).toBe(1)
    await clock.advance(POLL_MS)
    expect(seen.fetches).toBe(2)
  })

  test('keeps the old list when a refresh fails, and waits REFRESH_MS to try again', async ($, on) => {
    const clock = mock.clock(on, { now: HOUR_LATER })
    engine(on)
    let isDown = false
    const seen = api(on, feedDown(() => isDown))
    await startTurn($, clock)
    isDown = true
    await clock.advance(REFRESH_MS)
    expect(seen.fetches).toBe(2)
    await clock.advance(RETRY_MS)
    expect(seen.fetches).toBe(2)
    const ui = await mount($, 'terminal')
    expect((await lines(ui))[0]).toBe('1. Aalesund raknet med ti mann')
    await $.command.run(SLASH_VG)
    expect((await $.command.run(SLASH_VG)).text).toBe(
      'The spinner shows the newest VG articles as last fetched, but they could not be fetched again: the VG feed answered 503',
    )
  })

  test('gives up on a feed that does not answer, and fetches again later', async ($, on) => {
    const clock = mock.clock(on, { now: HOUR_LATER })
    engine(on)
    let isHung = false
    // Long past the timeout, but within the test, so nothing is left waiting.
    const seen = api(on, url => (url === FEED_URL && isHung ? clock.sleep(60 * 1000).then(() => undefined) : undefined))
    await startTurn($, clock)
    isHung = true
    await clock.advance(REFRESH_MS)
    expect(seen.fetches).toBe(2)
    await clock.advance(TIMEOUT_MS)

    const ui = await mount($, 'terminal')
    expect((await lines(ui))[0]).toBe('1. Aalesund raknet med ti mann')
    await ui.unmount()
    await $.command.run(SLASH_VG)
    expect((await $.command.run(SLASH_VG)).text).toBe(
      'The spinner shows the newest VG articles as last fetched, but they could not be fetched again: VG did not answer within 8 seconds',
    )
    isHung = false
    await clock.advance(REFRESH_MS)
    expect(seen.fetches).toBe(3)
  })

  test('/vg joins a fetch under way rather than starting another', async ($, on) => {
    const clock = mock.clock(on, { now: HOUR_LATER })
    engine(on)
    const seen = api(on, url => (url === FEED_URL ? clock.sleep(500).then(() => undefined) : undefined))
    await startTurn($, clock)
    const reply = $.command.run(SLASH_NEXT)
    await clock.settle()
    await clock.advance(500)
    expect((await reply).text).toBe('Next up: 1. Aalesund raknet med ti mann')
    expect(seen.fetches).toBe(1)
  })

  test('/vg fetches the feed when it has none to answer with', async ($, on) => {
    mock.clock(on, { now: HOUR_LATER })
    engine(on)
    const seen = api(on)
    await startSession($)
    expect((await $.command.run(SLASH_NEXT)).text).toBe('Next up: 1. Aalesund raknet med ti mann')
    expect(seen.fetches).toBe(1)
  })
})
