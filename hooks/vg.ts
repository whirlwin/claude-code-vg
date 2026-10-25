// The newest articles on vg.no, from VG's public RSS feed: VG's terms forbid
// scraping the front page, so the feed is the only source. Every response is
// untrusted: it is parsed field by field and drawn on a terminal.

export const FEED_URL = 'https://www.vg.no/rss/feed/?limit=100'
// The feed is newest first and mostly goal clips, so a hundred items leave
// about this many articles.
export const TOP_COUNT = 20
// The feed's own <ttl>.
export const REFRESH_MS = 10 * 60 * 1000

// The engine's Link takes an href of at most 2048 characters once
// percent-encoded, so an article linking past this is left out.
const MAX_HREF = 2048

// C0 and C1 controls, which could end the OSC 8 hyperlink a title is drawn
// in, and bidi overrides and isolates, which could reorder the line around it.
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g

// VG's own articles sit under a section, /sport/i/77aWL9/<slug>. The partner
// items from E24 and MinMote link to /i/<id>/<slug>, under none.
const ARTICLE_PATH = /^\/([a-z0-9-]+)\/i\/([A-Za-z0-9]+)\/[^/]+$/

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

export type Article = {
  // The short id in the link, the 77aWL9 of /sport/i/77aWL9/.
  id: string
  // The position among the articles kept, so the clips between them leave
  // no gap.
  rank: number
  title: string
  href: string
  // As VG labels it: Sport, Nyheter, Rampelys.
  section: string
  // Unix milliseconds.
  time: number
}

// The subset of $.http.fetch's result this module reads, so it stays testable
// without the engine.
export type Fetch = (url: string) => Promise<{ ok: boolean; status: number; text: string }>

// CDATA is text that may hold markup. Escaped back into character data up
// front, a </title> or </item> inside one ends nothing, and every text is
// then decoded alike.
function unwrapCdata(xml: string): string {
  let out = ''
  let at = 0
  for (;;) {
    const open = xml.indexOf('<![CDATA[', at)
    if (open === -1) break
    const close = xml.indexOf(']]>', open + 9)
    // No later section can close either, so the scan ends here.
    if (close === -1) break
    const text = xml.slice(open + 9, close)
    out += xml.slice(at, open) + text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    at = close + 3
  }
  return out + xml.slice(at)
}

function* elements(text: string, name: string): Generator<string | null> {
  const open = new RegExp(`<${name}(?:\\s[^<>]*?)?(/?)>`, 'g')
  const close = new RegExp(`</${name}\\s*>`, 'g')
  for (let m = open.exec(text); m !== null; m = open.exec(text)) {
    if (m[1] === '/') {
      yield null
      continue
    }
    close.lastIndex = open.lastIndex
    const end = close.exec(text)
    if (end === null) return
    yield text.slice(open.lastIndex, end.index)
    open.lastIndex = close.lastIndex
  }
}

// In one pass, so `&amp;lt;` reads as `&lt;` rather than `<`. A reference to
// no character (past U+10FFFF, or half a surrogate pair) is dropped, as
// String.fromCodePoint would throw on the first. Before cleaning, so `&#27;`
// is stripped as the escape it stands for.
function decode(text: string): string {
  return text.replace(
    /&(?:#(\d+)|#x([0-9a-fA-F]+)|(amp|lt|gt|quot|apos));/g,
    (_, dec: string | undefined, hex: string | undefined, name: string | undefined) => {
      if (name !== undefined) return ENTITIES[name] ?? ''
      const code = dec !== undefined ? Number(dec) : parseInt(hex ?? '', 16)
      if (code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return ''
      return String.fromCodePoint(code)
    },
  )
}

// Whitespace first, so a tab, newline or NEL (controls too, and NEL is not in
// \s) stays a word break instead of gluing two words; again after, for the
// spaces a removed control leaves side by side.
function clean(text: string): string {
  return text.replace(/[\s\u0085]+/g, ' ').replace(UNSAFE, '').replace(/\s+/g, ' ').trim()
}

// The decoded text of an item's first `name` element, '' when it is written
// empty or self-closing, null when there is none. Anchored on `<`, so `link`
// does not find <vg:waplink>.
function field(item: string, name: string): string | null {
  for (const text of elements(item, name)) return decode(text ?? '')
  return null
}

// The serialized URL rather than the string VG sent: serializing
// percent-encodes controls and bidi characters, which in the raw string
// would break out of the hyperlink just as they would in a title.
function articleLink(text: string | null): { id: string; href: string; section: string } | null {
  if (text === null) return null
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return null
  }
  // The host rather than the hostname, so a port of its own is refused too.
  if (url.protocol !== 'https:' || url.host !== 'www.vg.no') return null
  // A user name ahead of the host would show as another site's address
  // wherever the terminal prints the link.
  if (url.username !== '' || url.password !== '') return null
  if (url.href.length > MAX_HREF) return null
  const path = ARTICLE_PATH.exec(url.pathname)
  if (path === null) return null
  const [, section = '', id = ''] = path
  return { id, href: url.href, section: section.charAt(0).toUpperCase() + section.slice(1) }
}

/**
 * The first TOP_COUNT articles of the feed in its order, newest first,
 * leaving out the clips, the partner items and whatever could not be read.
 */
export function parseFeed(xml: string): Article[] {
  const articles: Article[] = []
  const ids = new Set<string>()
  for (const item of elements(unwrapCdata(xml), 'item')) {
    if (item === null) continue
    if (articles.length === TOP_COUNT) break
    // An item listed twice would show twice in the rotation.
    const link = articleLink(field(item, 'link'))
    if (link === null || ids.has(link.id)) continue
    const title = clean(field(item, 'title') ?? '')
    // A goal clip links under a section like an article, but has no lead.
    const lead = clean(field(item, 'description') ?? '')
    const time = Date.parse((field(item, 'pubDate') ?? '').trim())
    if (title === '' || lead === '' || !Number.isFinite(time)) continue
    ids.add(link.id)
    articles.push({
      id: link.id,
      rank: articles.length + 1,
      title,
      href: link.href,
      section: clean(field(item, 'category') ?? '') || link.section,
      time,
    })
  }
  return articles
}

/**
 * The newest articles on vg.no, from one request for the feed. Throws, in
 * words fit to show the person, when the feed fails or holds none. A request
 * that fails or is refused rejects with the host's own reason.
 */
export async function fetchLatest(fetch: Fetch): Promise<Article[]> {
  const feed = await fetch(FEED_URL)
  if (!feed.ok) throw new Error(`the VG feed answered ${feed.status}`)
  const articles = parseFeed(feed.text)
  if (articles.length === 0) throw new Error('the VG feed held no articles')
  return articles
}

/**
 * How long ago `timeMs` was, as VG words it. An article from the future (the
 * clock here behind VG's) reads as just published.
 */
export function ago(nowMs: number, timeMs: number): string {
  const minutes = Math.max(1, Math.floor((nowMs - timeMs) / 60_000))
  if (minutes < 60) return minutes === 1 ? 'for 1 minutt siden' : `for ${minutes} minutter siden`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return hours === 1 ? 'for 1 time siden' : `for ${hours} timer siden`
  const days = Math.floor(hours / 24)
  return days === 1 ? 'for 1 dag siden' : `for ${days} dager siden`
}

/**
 * `Nyheter · for 23 minutter siden`.
 */
export function byline(article: Article, nowMs: number): string {
  return `${article.section} · ${ago(nowMs, article.time)}`
}

/**
 * `1. Oversvømmelse: E6 stengt mellom Lillehammer og Biri`, the spinner's
 * word where it cannot draw a link.
 */
export function label(article: Article): string {
  return `${article.rank}. ${article.title}`
}
