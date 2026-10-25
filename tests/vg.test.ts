import { describe, expect, test } from 'claude-code/testing'

import { FEED_URL, REFRESH_MS, TOP_COUNT, ago, byline, fetchLatest, label, parseFeed } from '../hooks/vg'
import type { Article, Fetch } from '../hooks/vg'
import { FEED } from './fixtures/feed'

// An item's elements by name, each text written as the feed writes it, so a
// test can hand it entities or CDATA: undefined leaves the element out and
// null writes it self-closing, as VG writes <vg:body/>. A name may carry
// attributes, which the closing tag leaves off.
type Fields = Record<string, string | null | undefined>

// Six real items in the order VG's feed sent them on 25 October 2026, their
// images left off: three articles, a goal clip, and the partner items from
// MinMote and E24.
const AALESUND: Fields = {
  title: 'Aalesund raknet med ti mann',
  pubDate: 'Sun, 25 Oct 2026 18:01:11 GMT',
  description: 'Aalesund ble redusert til ti mann i første omgang, og måtte gi tapt med 1-2 etter et stormløp fra Sarpsborg i Eliteserien søndag.',
  link: 'https://www.vg.no/sport/i/77aWL9/aalesund-raknet-med-ti-mann',
  guid: 'https://www.vg.no/i/77aWL9',
  'vg:waplink': 'https://www.vg.no/i/77aWL9',
  'vg:body': null,
  category: 'Sport',
}
const CLIP: Fields = {
  title: 'Douglas Luiz med scoring for Juventus',
  pubDate: 'Sun, 25 Oct 2026 17:51:56 GMT',
  // What makes it a clip: no lead.
  description: undefined,
  link: 'https://www.vg.no/sport/i/oKoXlg/douglas-luiz-med-scoring-for-juventus',
  guid: 'https://www.vg.no/i/oKoXlg',
  'vg:waplink': 'https://www.vg.no/i/oKoXlg',
  'vg:body': null,
  category: 'Sport',
}
const E6: Fields = {
  title: 'Oversvømmelse: E6 stengt mellom Lillehammer og Biri',
  pubDate: 'Sun, 25 Oct 2026 17:39:08 GMT',
  description: 'E6 mellom Lillehammer og Biri er stengt i begge retninger etter oversvømmelser i veibanen.',
  link: 'https://www.vg.no/nyheter/i/jv5Rpb/oversvoemmelse-e6-stengt-mellom-lillehammer-og-biri',
  guid: 'https://www.vg.no/i/jv5Rpb',
  'vg:waplink': 'https://www.vg.no/i/jv5Rpb',
  'vg:body': null,
  category: 'Nyheter',
}
const MINMOTE: Fields = {
  title: 'Kris Jenner hyllet Elizabeth Taylor',
  pubDate: 'Sun, 25 Oct 2026 17:22:00 GMT',
  description: 'Kappen har en helt spesiell Hollywood-historie bak seg.',
  link: 'https://www.vg.no/i/X9mKEE/kris-jenner-hyllet-elizabeth-taylor-med-ikonisk-kappe-i-roma',
  guid: 'https://www.vg.no/i/X9mKEE',
  'vg:waplink': 'https://www.vg.no/i/X9mKEE',
  'vg:body': null,
  category: 'MinMote',
}
const MEGHAN: Fields = {
  title: 'BBC: Meghan Markle advarte faren i brev',
  pubDate: 'Sun, 25 Oct 2026 17:01:40 GMT',
  description: 'Hertuginne Meghan skal i fjor ha skrevet til faren Thomas Markle (82) at hun visste om alvorlige overgrepsanklager mot ham. ',
  link: 'https://www.vg.no/rampelys/i/Qgv1E4/meghan-markle-advarte-faren-i-brev',
  guid: 'https://www.vg.no/i/Qgv1E4',
  'vg:waplink': 'https://www.vg.no/i/Qgv1E4',
  'vg:body': null,
  category: 'Rampelys',
}
const E24: Fields = {
  title: 'Mener NHO la opp til selvmål for 20 år siden',
  pubDate: 'Sun, 25 Oct 2026 16:45:34 GMT',
  description: 'Kun Odd Nerdrum eller Jon Fosse passer til beskrivelsen fra NHO, ifølge advokat Nicolay Skarning. ',
  link: 'https://www.vg.no/i/d7AyMJ/mener-nho-la-opp-til-selvmaal-for-20-aar-siden',
  guid: 'https://www.vg.no/i/d7AyMJ',
  'vg:waplink': 'https://www.vg.no/i/d7AyMJ',
  'vg:body': null,
  category: 'E24',
}
const REAL = [AALESUND, CLIP, E6, MINMOTE, MEGHAN, E24]

const POSTED = Date.UTC(2026, 9, 25, 18, 1, 11)
const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
// What must never reach the terminal from a title, a section or a link.
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/

type Answer = { ok: boolean; status: number; text: string }

function item(fields: Fields): string {
  let xml = ''
  for (const [name, text] of Object.entries(fields)) {
    if (text === undefined) continue
    xml += text === null ? `<${name}/>` : `<${name}>${text}</${name.replace(/ .*/, '')}>`
  }
  return `<item>${xml}</item>`
}

// The feed around some items, the channel's own <title> and <link> ahead of
// them as VG sends it.
function feed(...items: string[]): string {
  return (
    '<?xml version="1.0"?><rss xmlns:vg="http://www.vg.no/namespace" version="2.0"><channel>' +
    '<image><title>Siste nytt fra VG</title><url>https://vgc.no/gfx/vg-rss.png</url><link>https://www.vg.no</link></image>' +
    '<title>Siste nytt fra VG</title><ttl>10</ttl>' +
    '<description>Siste nytt fra VG. Alt innen nyheter, sport og underholdning</description>' +
    '<link>http://www.vg.no/feed/rss</link><lastBuildDate>Sun, 25 Oct 2026 18:08:29 GMT</lastBuildDate>' +
    `${items.join('')}</channel></rss>`
  )
}

// Aalesund with some fields changed.
function parse(fields: Fields): Article | null {
  return parseFeed(feed(item({ ...AALESUND, ...fields })))[0] ?? null
}

function read(fields: Fields = {}): Article {
  const article = parse(fields)
  if (article === null) throw new Error(`${JSON.stringify(fields)} did not parse`)
  return article
}

function at(ms: number): string {
  return ago(POSTED + ms, POSTED)
}

// VG beneath fetchLatest: the feed answers `answer` (an Error is a fetch that
// rejects), any other URL 404, and `asked` records every request.
function vg(answer: Answer | Error): { fetch: Fetch; asked: string[] } {
  const asked: string[] = []
  const fetch: Fetch = async url => {
    asked.push(url)
    if (url !== FEED_URL) return { ok: false, status: 404, text: 'Not Found' }
    if (answer instanceof Error) throw answer
    return answer
  }
  return { fetch, asked }
}

function ok(text: string): Answer {
  return { ok: true, status: 200, text }
}

describe('parseFeed', () => {
  test('keeps the articles and leaves out the clip and the partner items', async () => {
    expect(parseFeed(feed(...REAL.map(item)))).toEqual([
      {
        id: '77aWL9',
        rank: 1,
        title: 'Aalesund raknet med ti mann',
        href: 'https://www.vg.no/sport/i/77aWL9/aalesund-raknet-med-ti-mann',
        section: 'Sport',
        time: Date.UTC(2026, 9, 25, 18, 1, 11),
      },
      {
        id: 'jv5Rpb',
        rank: 2,
        title: 'Oversvømmelse: E6 stengt mellom Lillehammer og Biri',
        href: 'https://www.vg.no/nyheter/i/jv5Rpb/oversvoemmelse-e6-stengt-mellom-lillehammer-og-biri',
        section: 'Nyheter',
        time: Date.UTC(2026, 9, 25, 17, 39, 8),
      },
      {
        id: 'Qgv1E4',
        rank: 3,
        title: 'BBC: Meghan Markle advarte faren i brev',
        href: 'https://www.vg.no/rampelys/i/Qgv1E4/meghan-markle-advarte-faren-i-brev',
        section: 'Rampelys',
        time: Date.UTC(2026, 9, 25, 17, 1, 40),
      },
    ])
  })

  test('leaves out a clip for want of a lead and a partner item for its link alone', async () => {
    expect(parseFeed(feed(item({ ...CLIP, description: 'Se målet.' })))).toHaveLength(1)
    const sectioned = { ...E24, link: 'https://www.vg.no/nyheter/i/d7AyMJ/mener-nho-la-opp-til-selvmaal-for-20-aar-siden' }
    expect(parseFeed(feed(item(sectioned)))[0]?.section).toBe('E24')
    expect(parseFeed(feed(item({ ...MINMOTE, link: 'https://www.vg.no/rampelys/i/X9mKEE/kris-jenner' })))).toHaveLength(1)
  })

  test('needs a lead with something in it', async () => {
    const NO_LEAD: [string, string | null | undefined][] = [
      ['none', undefined],
      ['self-closing', null],
      ['empty', ''],
      ['blank', ' \t\n '],
      ['empty CDATA', '<![CDATA[]]>'],
      ['blank CDATA', '<![CDATA[ \n ]]>'],
      ['encoded blanks', '&#32;&#9;&#x0a;'],
      ['controls', '\u0007\u001b\u202e'],
    ]
    for (const [what, description] of NO_LEAD) expect(parse({ description }), what).toBeNull()
    expect(parse({ description: 'x' })).not.toBeNull()
  })

  test('leaves out what the spinner could not show', async () => {
    const GONE: [string, Fields][] = [
      ['no title', { title: undefined }],
      ['an empty title', { title: '' }],
      ['a self-closing title', { title: null }],
      ['a blank title', { title: ' \t\n ' }],
      ['a title of controls', { title: '\u001b\u0007\u202e' }],
      ['a title of encoded controls', { title: '&#x1b;&#7;&#x202E;' }],
      ['no pubDate', { pubDate: undefined }],
      ['an empty pubDate', { pubDate: '' }],
      ['a self-closing pubDate', { pubDate: null }],
      ['a pubDate that is no date', { pubDate: 'not a date' }],
      ['no link', { link: undefined }],
      ['an empty link', { link: '' }],
      ['a link only in vg:waplink', { link: undefined, 'vg:waplink': AALESUND.link }],
    ]
    for (const [what, fields] of GONE) expect(parse(fields), what).toBeNull()
  })

  test('reads the pubDate as Unix milliseconds in any time zone', async () => {
    expect(read().time).toBe(POSTED)
    expect(read({ pubDate: 'Sun, 25 Oct 2026 20:01:11 +0200' }).time).toBe(POSTED)
    expect(read({ pubDate: ' Sun, 25 Oct 2026 18:01:11 GMT\n' }).time).toBe(POSTED)
  })

  test('falls back to the section in the link, capitalised', async () => {
    const NO_CATEGORY: [string, string | null | undefined][] = [
      ['none', undefined],
      ['self-closing', null],
      ['empty', ''],
      ['blank', ' \n '],
      ['controls', '\u202e\u0007'],
    ]
    for (const [what, category] of NO_CATEGORY) expect(read({ category }).section, what).toBe('Sport')
    expect(read({ ...E6, category: undefined }).section).toBe('Nyheter')
    expect(read({ ...MEGHAN, category: '' }).section).toBe('Rampelys')
  })

  test('counts ranks and TOP_COUNT among the articles, not the clips between them', async () => {
    const items = Array.from({ length: 2 * (TOP_COUNT + 5) }, (_, i) =>
      item({
        ...(i % 2 === 0 ? AALESUND : CLIP),
        title: `Sak ${i + 1}`,
        link: `https://www.vg.no/sport/i/sak${i + 1}/sak`,
      }),
    )
    const articles = parseFeed(feed(...items))
    expect(articles).toHaveLength(TOP_COUNT)
    expect(articles.map(article => article.rank)).toEqual(Array.from({ length: TOP_COUNT }, (_, i) => i + 1))
    expect(articles.map(article => article.id)).toEqual(Array.from({ length: TOP_COUNT }, (_, i) => `sak${2 * i + 1}`))
    expect(articles.map(label)[11]).toBe('12. Sak 23')
  })

  test('keeps the first of two items with one id', async () => {
    const again = { ...AALESUND, title: 'Aalesund raknet igjen', link: 'https://www.vg.no/nyheter/i/77aWL9/igjen' }
    const articles = parseFeed(feed(item(AALESUND), item(again), item(E6)))
    expect(articles.map(article => [article.rank, article.id, article.title])).toEqual([
      [1, '77aWL9', 'Aalesund raknet med ti mann'],
      [2, 'jv5Rpb', 'Oversvømmelse: E6 stengt mellom Lillehammer og Biri'],
    ])
    // An item left out holds no id: the article after it still shows.
    const clip = { ...CLIP, link: AALESUND.link }
    expect(parseFeed(feed(item(clip), item(AALESUND))).map(article => article.title)).toEqual(['Aalesund raknet med ti mann'])
  })

  test('reads nothing from a body that is not the feed', async () => {
    const BODIES = ['', 'not XML', '<html><body>Siden finnes ikke</body></html>', '{"items":[]}', feed()]
    for (const body of BODIES) expect(parseFeed(body), body.slice(0, 40)).toEqual([])
  })
})

describe('decoding', () => {
  test('decodes the five entities and character references, once', async () => {
    expect(read({ title: 'Kvinne &amp; mann &lt;3 &gt; &quot;sitat&quot; &apos;x&apos;' }).title).toBe(`Kvinne & mann <3 > "sitat" 'x'`)
    expect(read({ title: 'Bl&#229;b&#xE6;r og bl&#xe5;b&#230;r &#x1D11E;' }).title).toBe('Blåbær og blåbær \u{1d11e}')
    expect(read({ title: '&amp;lt;b&amp;gt; &amp;amp;' }).title).toBe('&lt;b&gt; &amp;')
    // Not one of XML's five: left as written.
    expect(read({ title: 'R&amp;B &nbsp; &copy;' }).title).toBe('R&B &nbsp; &copy;')
  })

  test('drops a reference to no character rather than failing', async () => {
    expect(read({ title: 'A&#x110000;B&#xD800;C&#xdfff;D&#99999999999999999999;E' }).title).toBe('ABCDE')
  })

  test('unwraps CDATA without decoding what it holds', async () => {
    expect(read({ title: '<![CDATA[Kvinne & mann <3]]>' }).title).toBe('Kvinne & mann <3')
    expect(read({ title: '<![CDATA[R&amp;B]]>' }).title).toBe('R&amp;B')
    expect(read({ title: 'Før <![CDATA[<i>og</i>]]> &amp; etter' }).title).toBe('Før <i>og</i> & etter')
    expect(read({ category: '<![CDATA[Nyheter]]>' }).section).toBe('Nyheter')
    expect(read({ description: '<![CDATA[<p>Aalesund ble redusert til ti mann.</p>]]>' }).id).toBe('77aWL9')
    expect(read({ link: `<![CDATA[${AALESUND.link}]]>` }).href).toBe(AALESUND.link ?? '')
  })

  test('ends no element and no item at a closing tag inside CDATA', async () => {
    expect(read({ title: '<![CDATA[Slutt</title> her]]>' }).title).toBe('Slutt</title> her')
    const planted = '<![CDATA[</item><item><title>Falsk</title><link>https://www.vg.no/sport/i/falsk/falsk</link><description>Falsk</description>]]>'
    const articles = parseFeed(feed(item({ ...AALESUND, description: planted }), item(E6)))
    expect(articles.map(article => article.id)).toEqual(['77aWL9', 'jv5Rpb'])
  })

  test('decodes a link before reading it', async () => {
    expect(read({ link: 'https://www.vg.no/sport/i/77aWL9/aalesund?a=1&amp;b=2' }).href).toBe('https://www.vg.no/sport/i/77aWL9/aalesund?a=1&b=2')
    expect(read({ link: 'https://www.vg.no/sport/i/77aWL9/aalesund&#x3f;a=1' }).href).toBe('https://www.vg.no/sport/i/77aWL9/aalesund?a=1')
  })

  test('reads an element with attributes, or empty and self-closing with a space', async () => {
    expect(read({ title: undefined, 'title type="text"': 'Aalesund' }).title).toBe('Aalesund')
    expect(read({ category: undefined, 'category domain="https://www.vg.no/nyheter"': 'Nyheter' }).section).toBe('Nyheter')
    expect(read({ category: undefined, 'category domain="https://www.vg.no/"': null }).section).toBe('Sport')
    const spaced = feed(item({ ...AALESUND, description: undefined }).replace('<link>', '<description /><link>'))
    expect(parseFeed(spaced)).toEqual([])
    expect(parseFeed(feed(item(AALESUND).replace('<category>Sport</category>', '<category />')))[0]?.section).toBe('Sport')
    // A closing tag may end in whitespace.
    expect(parseFeed(feed(item(AALESUND).replace('</title>', '</title\n>')))[0]?.title).toBe('Aalesund raknet med ti mann')
    expect(parseFeed(feed(item(AALESUND).replace('</item>', '</item\n>'), item(E6))).map(article => article.id)).toEqual(['77aWL9', 'jv5Rpb'])
    // The first element of a name counts, even when it is empty and a full one
    // follows.
    expect(parseFeed(feed(item(AALESUND).replace('<category>', '<category/><category>')))[0]?.section).toBe('Sport')
    expect(parseFeed(feed(item(AALESUND).replace('<description>', '<description/><description>')))).toEqual([])
  })

  test('reads <link>, not a <vg:waplink> ahead of it', async () => {
    const waplinkFirst = item({ title: AALESUND.title, 'vg:waplink': 'https://www.vg.no/i/77aWL9', ...AALESUND })
    expect(waplinkFirst.indexOf('<vg:waplink>')).toBeLessThan(waplinkFirst.indexOf('<link>'))
    expect(parseFeed(feed(waplinkFirst))[0]?.href).toBe(AALESUND.link ?? '')
  })

  // A scan that went back to every opener for its closer took about a second
  // on 120 KB of these and four on 240 KB, and the 8 s timeout cannot stop a
  // parse. Small enough that such a scan fails here rather than hangs.
  test('reads a hostile body in linear time', async () => {
    const BODIES = ['<item ', '<item>', '<![CDATA[', '<link ']
    for (const unit of BODIES) {
      const body = unit === '<link ' ? `<item>${unit.repeat(20_000)}</item>` : unit.repeat(20_000)
      const started = Date.now()
      expect(parseFeed(body), unit).toEqual([])
      expect(Date.now() - started, unit).toBeLessThan(250)
    }
  })
})

describe('sanitizing', () => {
  test('drops an escape sequence that would end the hyperlink', async () => {
    const article = read({ title: 'Aalesund\u001b]8;;https://evil\u0007 raknet', category: 'Sp\u001b[31mort' })
    expect(article.title).toBe('Aalesund]8;;https://evil raknet')
    expect(article.section).toBe('Sp[31mort')
    expect(read({ title: 'Aalesund&#x1b;]8;;https://evil&#7; raknet' }).title).toBe('Aalesund]8;;https://evil raknet')
    expect(read({ title: 'Aalesund\u009b31m raknet\u0085 med\u007f' }).title).toBe('Aalesund31m raknet med')
  })

  test('drops bidi overrides and isolates', async () => {
    const article = read({ title: 'Aalesund \u202eraknet\u202c \u2066 med\u2069', category: '\u2067Sport\u2069' })
    expect(article.title).toBe('Aalesund raknet med')
    expect(article.section).toBe('Sport')
    expect(read({ title: '&#x202E;Aalesund&#8236;', category: '&#x2066;Sport&#x2069;' })).toMatchObject({ title: 'Aalesund', section: 'Sport' })
  })

  test('keeps a tab or newline as one space and trims', async () => {
    expect(read({ title: '\n  Aalesund\traknet\r\n\nmed  ' }).title).toBe('Aalesund raknet med')
    expect(read({ title: 'Aalesund &#10; raknet&#x9;med' }).title).toBe('Aalesund raknet med')
    expect(read({ category: ' Rampe\nlys ' }).section).toBe('Rampe lys')
    // NEL breaks a line too, though \s leaves it out.
    expect(read({ title: 'Aalesund\u0085raknet' }).title).toBe('Aalesund raknet')
    expect(read({ title: 'Aalesund&#x85;raknet' }).title).toBe('Aalesund raknet')
  })

  test('drops or spaces every character of each unsafe range, ends included, written or encoded', async () => {
    const RANGES: [number, number][] = [[0x00, 0x1f], [0x7f, 0x9f], [0x202a, 0x202e], [0x2066, 0x2069]]
    for (const [first, last] of RANGES) {
      for (let code = first; code <= last; code++) {
        const char = String.fromCharCode(code)
        const ref = `&#x${code.toString(16)};`
        const what = `U+${code.toString(16).padStart(4, '0')}`
        expect(['Aalesund raknet', 'Aalesundraknet'], what).toContain(read({ title: `Aalesund${char}raknet` }).title)
        expect(['Aalesund raknet', 'Aalesundraknet'], what).toContain(read({ title: `Aalesund${ref}raknet` }).title)
        expect(['Sp ort', 'Sport'], what).toContain(read({ category: `Sp${char}ort` }).section)
        expect(['Sp ort', 'Sport'], what).toContain(read({ category: `Sp${ref}ort` }).section)
      }
    }
  })
})

describe('href', () => {
  test('links only an https article on www.vg.no under a section', async () => {
    const REFUSED = [
      'http://www.vg.no/sport/i/77aWL9/aalesund-raknet-med-ti-mann',
      'https://vg.no/sport/i/77aWL9/aalesund-raknet-med-ti-mann',
      'https://www.vg.no.evil.example/sport/i/77aWL9/aalesund-raknet-med-ti-mann',
      'https://evil.example/sport/i/77aWL9/aalesund-raknet-med-ti-mann',
      'https://www.vg.no@evil.example/sport/i/77aWL9/aalesund-raknet-med-ti-mann',
      'https://evil.example%2Flogin@www.vg.no/sport/i/77aWL9/aalesund-raknet-med-ti-mann',
      'https://user:pass@www.vg.no/sport/i/77aWL9/aalesund-raknet-med-ti-mann',
      'https://www.vg.no:8443/sport/i/77aWL9/aalesund-raknet-med-ti-mann',
      'https://e24.no/i/d7AyMJ/mener-nho-la-opp-til-selvmaal-for-20-aar-siden',
      // The partner items, E24's and MinMote's, under no section.
      'https://www.vg.no/i/d7AyMJ/mener-nho-la-opp-til-selvmaal-for-20-aar-siden',
      'https://www.vg.no/i/X9mKEE/kris-jenner-hyllet-elizabeth-taylor-med-ikonisk-kappe-i-roma',
      'https://www.vg.no/',
      'https://www.vg.no/sport',
      'https://www.vg.no/sport/77aWL9/aalesund-raknet-med-ti-mann',
      'https://www.vg.no/sport/i/77aWL9',
      'https://www.vg.no/sport/i/77aWL9/',
      'https://www.vg.no/sport/i//aalesund-raknet-med-ti-mann',
      'https://www.vg.no/sport/i/77aWL9/aalesund-raknet-med-ti-mann/mer',
      'https://www.vg.no/sport/x/i/77aWL9/aalesund-raknet-med-ti-mann',
      'javascript:alert(1)',
      'javascript://www.vg.no/sport/i/77aWL9/a%0aalert(1)',
      'data:text/html,&lt;script&gt;alert(1)&lt;/script&gt;',
      'file:///sport/i/77aWL9/aalesund-raknet-med-ti-mann',
      'ftp://www.vg.no/sport/i/77aWL9/aalesund-raknet-med-ti-mann',
      '/sport/i/77aWL9/aalesund-raknet-med-ti-mann',
      'www.vg.no/sport/i/77aWL9/aalesund-raknet-med-ti-mann',
      'not a url',
      `https://www.vg.no/sport/i/77aWL9/${'a'.repeat(2048)}`,
    ]
    for (const link of REFUSED) expect(parse({ link }), link.slice(0, 60)).toBeNull()
    const ACCEPTED: [string, string][] = [
      ['HTTPS://WWW.VG.NO/sport/i/77aWL9/aalesund-raknet-med-ti-mann', 'https://www.vg.no/sport/i/77aWL9/aalesund-raknet-med-ti-mann'],
      ['https://www.vg.no:443/sport/i/77aWL9/aalesund-raknet-med-ti-mann', 'https://www.vg.no/sport/i/77aWL9/aalesund-raknet-med-ti-mann'],
      ['https://www.vg.no/sport/i/77aWL9/aalesund?utm_source=rss#top', 'https://www.vg.no/sport/i/77aWL9/aalesund?utm_source=rss#top'],
      [' https://www.vg.no/sport/i/77aWL9/aalesund\n', 'https://www.vg.no/sport/i/77aWL9/aalesund'],
    ]
    for (const [link, href] of ACCEPTED) expect(read({ link }).href, link).toBe(href)
  })

  test('takes the id and the section from the path', async () => {
    const article = read({ link: 'https://www.vg.no/forbruker/i/Ab3xZ9/en-sak', category: undefined })
    expect(article).toMatchObject({ id: 'Ab3xZ9', section: 'Forbruker', href: 'https://www.vg.no/forbruker/i/Ab3xZ9/en-sak' })
  })

  test('links an article of exactly 2048 characters and not one more', async () => {
    const base = 'https://www.vg.no/sport/i/77aWL9/'
    const longest = read({ link: `${base}${'a'.repeat(2048 - base.length)}` })
    expect(longest.href).toHaveLength(2048)
    expect(parse({ link: `${base}${'a'.repeat(2049 - base.length)}` })).toBeNull()
    // Measured once percent-encoded: 224 bidi overrides are 258 characters as
    // sent, but 2050 as linked.
    expect(parse({ link: `${base}a${'\u202e'.repeat(224)}` })).toBeNull()
    expect(read({ link: `${base}a${'\u202e'.repeat(223)}` }).href).toHaveLength(2041)
  })

  test('encodes the characters that would end the hyperlink', async () => {
    for (const link of [
      'https://www.vg.no/sport/i/77aWL9/a\u001b]8;;x\u0007b\u202e',
      'https://www.vg.no/sport/i/77aWL9/a&#x1b;]8;;x&#7;b&#x202e;',
    ]) {
      const article = read({ link })
      expect(article.href, link).not.toMatch(UNSAFE)
      expect(article.href, link).toStartWith('https://www.vg.no/sport/i/77aWL9/a%1B')
      expect(article.id, link).toBe('77aWL9')
    }
  })
})

describe('fetchLatest', () => {
  test('reads the feed VG offers, as often as its ttl allows', async () => {
    expect(FEED_URL).toBe('https://www.vg.no/rss/feed/?limit=100')
    expect(REFRESH_MS).toBe(10 * MINUTE)
    expect(TOP_COUNT).toBe(20)
  })

  test('asks for the feed once and reads its articles', async () => {
    const { fetch, asked } = vg(ok(feed(...REAL.map(item))))
    const articles = await fetchLatest(fetch)
    expect(articles.map(article => article.id)).toEqual(['77aWL9', 'jv5Rpb', 'Qgv1E4'])
    expect(asked).toEqual([FEED_URL])
  })

  test('says what the feed answered when it fails', async () => {
    const { fetch, asked } = vg({ ok: false, status: 503, text: feed(...REAL.map(item)) })
    await expect(fetchLatest(fetch)).rejects.toThrow('the VG feed answered 503')
    expect(asked).toEqual([FEED_URL])
  })

  test('passes on why the request for the feed failed', async () => {
    const { fetch, asked } = vg(new Error('connection refused'))
    await expect(fetchLatest(fetch)).rejects.toThrow('connection refused')
    expect(asked).toEqual([FEED_URL])
  })

  test('fails when the feed holds no articles', async () => {
    const BODIES = [feed(item(CLIP), item(MINMOTE), item(E24)), feed(), '', '<html><body>Siden finnes ikke</body></html>']
    for (const body of BODIES) await expect(fetchLatest(vg(ok(body)).fetch)).rejects.toThrow('the VG feed held no articles')
  })
})

describe('words', () => {
  test('ago in whole minutes, hours and days, as VG words it', async () => {
    expect(at(0)).toBe('for 1 minutt siden')
    expect(at(59 * 1000)).toBe('for 1 minutt siden')
    expect(at(MINUTE)).toBe('for 1 minutt siden')
    expect(at(2 * MINUTE - 1)).toBe('for 1 minutt siden')
    expect(at(2 * MINUTE)).toBe('for 2 minutter siden')
    expect(at(23 * MINUTE)).toBe('for 23 minutter siden')
    expect(at(59 * MINUTE + 59 * 1000)).toBe('for 59 minutter siden')
    expect(at(HOUR)).toBe('for 1 time siden')
    expect(at(2 * HOUR - 1)).toBe('for 1 time siden')
    expect(at(2 * HOUR)).toBe('for 2 timer siden')
    expect(at(5 * HOUR)).toBe('for 5 timer siden')
    expect(at(23 * HOUR + 59 * MINUTE)).toBe('for 23 timer siden')
    expect(at(DAY)).toBe('for 1 dag siden')
    expect(at(2 * DAY - 1)).toBe('for 1 dag siden')
    expect(at(3 * DAY)).toBe('for 3 dager siden')
    expect(at(400 * DAY)).toBe('for 400 dager siden')
    // The clock here behind VG's.
    expect(at(-5 * MINUTE)).toBe('for 1 minutt siden')
  })

  test('byline: the section, a middle dot, the age', async () => {
    const e6 = read(E6)
    const BYLINES: [number, string][] = [
      [0, 'Nyheter · for 1 minutt siden'],
      [23 * MINUTE, 'Nyheter · for 23 minutter siden'],
      [HOUR, 'Nyheter · for 1 time siden'],
      [5 * HOUR, 'Nyheter · for 5 timer siden'],
      [DAY, 'Nyheter · for 1 dag siden'],
      [3 * DAY, 'Nyheter · for 3 dager siden'],
    ]
    for (const [later, line] of BYLINES) expect(byline(e6, e6.time + later)).toBe(line)
    expect(byline(e6, e6.time).charCodeAt('Nyheter '.length)).toBe(0x00b7)
    expect(byline(read(), POSTED + 23 * MINUTE)).toBe('Sport · for 23 minutter siden')
  })

  test('label: the rank, then the title', async () => {
    expect(label(read())).toBe('1. Aalesund raknet med ti mann')
    expect(label({ ...read(E6), rank: 12 })).toBe('12. Oversvømmelse: E6 stengt mellom Lillehammer og Biri')
  })
})

describe('the real feed', () => {
  test('reads between 1 and TOP_COUNT articles, every one on www.vg.no', async () => {
    const articles = parseFeed(FEED)
    expect(articles.length).toBeGreaterThanOrEqual(1)
    expect(articles.length).toBeLessThanOrEqual(TOP_COUNT)
    for (const article of articles) {
      const url = new URL(article.href)
      expect(url.protocol, article.href).toBe('https:')
      expect(url.host, article.href).toBe('www.vg.no')
      expect(article.title, article.href).not.toMatch(UNSAFE)
      expect(article.title, article.href).not.toBe('')
      expect(article.section, article.href).not.toMatch(UNSAFE)
      expect(article.section, article.href).not.toBe('')
      expect(Number.isFinite(article.time), article.href).toBe(true)
    }
    expect(articles.map(article => article.rank)).toEqual(articles.map((_, i) => i + 1))
    expect(new Set(articles.map(article => article.id)).size).toBe(articles.length)
  })

  test('keeps the 19 articles VG listed on 25 October 2026, newest first', async () => {
    const articles = parseFeed(FEED)
    expect(articles.map(article => article.id)).toEqual([
      '77aWL9', 'Vgn0kV', '9kaPnM', '1oaEkG', 'jv5Rpb', 'Qgv1E4', 'n9MKjQ', 'WgPw6g', '77ardV', 'd7AykJ',
      '4OaMOg', 'vloBm5', 'w3oaro', 'd7APxq', 'PgQMmp', 'AbaARq', 'kvonr6', 'p1ayv1', 'Vgnne1',
    ])
    expect([...new Set(articles.map(article => article.section))].sort()).toEqual(['Nyheter', 'Rampelys', 'Sport'])
    for (const [i, article] of articles.entries()) {
      expect(article.time, article.id).toBeLessThanOrEqual(articles[i - 1]?.time ?? article.time)
    }
    expect(articles[0]).toEqual(read())
  })

  test('holds the items this suite is built on, as written here', async () => {
    for (const fields of REAL) expect(FEED, fields.title ?? '').toContain(item(fields).slice(0, -'</item>'.length))
  })
})
