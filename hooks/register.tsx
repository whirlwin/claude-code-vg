import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import { REFRESH_MS, byline, fetchLatest, label } from './vg'
import type { Article } from './vg'
import { FRAMES_PER_STORY, LOGO_COLUMNS, LOGO_ROWS, RED, TICK_MS, frame } from './logo'

const isHidden = atom({ plugin: 'vg', key: 'isHidden' } as const, false)

const RASTER = 'vg'
// Rounded down, so the timer is redrawn a little more often than each second
// rather than a little less, which skipped a second now and then.
const TICKS_PER_SECOND = Math.floor(1000 / TICK_MS)
const RANK_COLOR = `#${RED.toString(16).padStart(6, '0')}`
// How often a running turn checks whether the feed is due.
const POLL_MS = 1000
// With no list to show at all, a failed fetch is tried again well before
// REFRESH_MS, so a blip does not leave the spinner without an article for ten
// minutes.
const RETRY_MS = 30 * 1000
// $.http.fetch has no timeout of its own, and a request that never answers
// would hold every later refresh behind it. Under the 10 s hook budget, as
// /vg waits for a fetch.
const FETCH_TIMEOUT_MS = 8 * 1000

// The feed as last fetched. An object rather than variables of register's
// own: the engine lets `$` be handed only to a function declared at the top
// of the file, and refresh needs both.
type Feed = {
  articles: Article[]
  // Why the last fetch failed, for /vg to say; null when it worked.
  problem: string | null
  attemptedAt: number | null
  // The fetch under way, which a second caller joins rather than sending
  // another request for the feed beside it.
  fetching: Promise<void> | null
}

function elapsed(ms: number): string {
  const s = Math.floor(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

function refresh($: EngineInterface, feed: Feed): Promise<void> {
  feed.fetching ??= (async () => {
    let timer: Timer | undefined
    try {
      feed.attemptedAt = await $.clock.now()
      const timeout = new Promise<never>((_, reject) => {
        timer = $.clock.after(FETCH_TIMEOUT_MS, () => {
          reject(new Error(`VG did not answer within ${FETCH_TIMEOUT_MS / 1000} seconds`))
        })
      })
      feed.articles = await Promise.race([fetchLatest(url => $.http.fetch(url)), timeout])
      feed.problem = null
      $.ui.invalidate('ui.render')
    } catch (error) {
      // The list stays as it was, and so does the drawing: stale headlines
      // beat none.
      feed.problem = error instanceof Error ? error.message : String(error)
    } finally {
      timer?.cancel()
    }
  })().finally(() => {
    feed.fetching = null
  })
  return feed.fetching
}

export const register: Register = on => {
  let tick = 0
  // The spinner as last drawn, which the timer repaints between draws.
  let spinner: string | null = null
  // Whether a surface without a Raster shows an article as the spinner's word.
  // Nothing there can be blitted, so no deny says it went: the main turn's end
  // does.
  let isWordShown = false
  // When each spinner first drew: drawing a tree replaces the engine's own
  // elapsed time, so the mod keeps its own.
  const startedAt = new Map<string, number>()
  let isTurnRunning = false
  const feed: Feed = { articles: [], problem: null, attemptedAt: null, fetching: null }

  function articleAt(t: number): Article | null {
    return feed.articles[Math.floor(t / FRAMES_PER_STORY) % feed.articles.length] ?? null
  }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'vg',
      description: 'Show or hide the newest VG articles in the spinner; "next" skips to the next article',
      argumentHint: '[next]',
    })

    // Only while something shows an article, so the rotation picks up at the
    // next turn where it left off rather than having moved on unseen. A word
    // drawn after the turn ended (a last desktop draw) shows nothing for long.
    $.clock.every(TICK_MS, () => {
      if (spinner === null && !(isWordShown && isTurnRunning)) return
      tick += 1
      // The article and the timer are text, so a new article or second is a
      // redraw; a surface showing only the word keeps its own timer.
      if (tick % FRAMES_PER_STORY === 0 || (spinner !== null && tick % TICKS_PER_SECOND === 0)) {
        $.ui.invalidate('ui.render')
        return
      }
      if (spinner === null) return
      const requestId = spinner
      void $.ui.blit({ requestId, key: RASTER, cells: frame(tick) }).then(result => {
        if (result.deny !== undefined && spinner === requestId) {
          spinner = null
          startedAt.delete(requestId)
        }
      })
    })

    // Only while a turn runs: between turns there is no spinner to show it.
    $.clock.every(POLL_MS, () => {
      if (!isTurnRunning || feed.fetching !== null) return
      void (async () => {
        const wait = feed.articles.length === 0 && feed.problem !== null ? RETRY_MS : REFRESH_MS
        if (feed.attemptedAt !== null && (await $.clock.now()) - feed.attemptedAt < wait) return
        if (await read($, isHidden)) return
        // The tile has rolled on while there was no list: the first one
        // starts at rank 1.
        const hadNone = feed.articles.length === 0
        await refresh($, feed)
        if (hadNone && feed.articles.length > 0) tick = 0
      })()
    })

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    // A subagent's or teammate's run starts here too, and ends with an
    // agentId, so only the main loop's start starts the fetches.
    if (e.agentId === undefined) isTurnRunning = true
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    // A subagent's turn ends here too, inside the main turn, so only the main
    // loop's end stops the fetches. The list is kept: the next turn shows it
    // at once.
    if (e.agentId === undefined) {
      isTurnRunning = false
      isWordShown = false
      // A spinner hidden mid-turn was never denied a blit, so its start would
      // otherwise carry over into the next turn's time.
      startedAt.clear()
    }
    return next(e)
  })

  on('command.run', { command: 'vg' }, async ($, e) => {
    const isNext = e.args.trim() === 'next'
    const hadNone = feed.articles.length === 0
    if (isNext) {
      tick = (Math.floor(tick / FRAMES_PER_STORY) + 1) * FRAMES_PER_STORY
      await update($, isHidden, () => false)
      $.ui.invalidate('ui.render')
    } else if (await update($, isHidden, was => !was)) {
      return { text: 'The spinner no longer shows VG.' }
    }
    // Between turns nothing fetches, so with no list yet the answer would
    // have nothing to say. The first list starts at rank 1, skipped or not.
    if (hadNone) {
      await refresh($, feed)
      if (feed.articles.length > 0) tick = 0
    }
    const article = articleAt(tick)
    if (isNext) {
      if (article !== null) return { text: `Next up: ${label(article)}` }
      if (feed.problem !== null) return { text: `The articles could not be fetched: ${feed.problem}` }
      return { text: 'The VG feed is still loading.' }
    }
    const shows = 'The spinner shows the newest VG articles'
    if (feed.problem === null) return { text: `${shows}.` }
    if (article === null) return { text: `${shows}, but they could not be fetched: ${feed.problem}` }
    return { text: `${shows} as last fetched, but they could not be fetched again: ${feed.problem}` }
  })

  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (await read($, isHidden)) {
      spinner = null
      isWordShown = false
      return next(e)
    }
    const article = articleAt(tick)
    if (e.surface !== 'terminal') {
      if (article === null) return next(e)
      isWordShown = true
      return next({ ...e, props: { ...e.props, word: label(article) } })
    }

    const now = await $.clock.now()
    const start = startedAt.get(e.requestId) ?? now
    startedAt.set(e.requestId, start)
    spinner = e.requestId
    const time = ` (${elapsed(now - start)})`
    const { Box, Link, Raster, Text } = $.ui.resolve(e)

    let lines
    if (article === null || e.props.message !== null) {
      // The engine's own state (compacting, say) outranks the article, and
      // before the first list there is no article: either way its words show.
      const text = e.props.message ?? e.props.word
      // As the engine draws it: its ellipsis left off a text ending in one,
      // a suffix another mod rewrote drawn as handed.
      const suffix = text.endsWith('\u2026') && e.props.suffix === '\u2026' ? '' : e.props.suffix
      lines = (
        <Text wrap="truncate-end">
          {text}
          {suffix}
          <Text dimColor>{time}</Text>
        </Text>
      )
    } else {
      // The second line starts under the title, so the rank stands alone at
      // the left. Every article is on vg.no, so no domain follows the title.
      const rank = `${article.rank}.`
      lines = [
        <Text wrap="truncate-end">
          <Text color={RANK_COLOR}>{rank}</Text>{' '}
          <Link href={article.href}>{article.title}</Link>
        </Text>,
        <Text dimColor wrap="truncate-end">
          {' '.repeat(rank.length + 1)}
          {byline(article, now)}
          {time}
        </Text>,
      ]
    }

    // One line centers on the three-row tile; two cannot, and centering them
    // flipped between the top rows and the bottom ones, so they sit at the top.
    return (
      <Box flexDirection="row">
        <Raster key={RASTER} columns={LOGO_COLUMNS} rows={LOGO_ROWS} cells={frame(tick)} />
        <Box flexDirection="column" justifyContent={Array.isArray(lines) ? 'flex-start' : 'center'} marginLeft={1}>
          {lines}
        </Box>
      </Box>
    )
  })
}
