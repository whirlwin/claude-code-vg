# claude-code-vg

A Claude Code mod that puts the newest VG articles in the spinner. While
Claude works, a small red VG tile takes the spinner's place, beside one of the
newest articles on vg.no (up to 20): rank and title on the first line, and
under it the section and age as VG words them, such as
`Nyheter · for 23 minutter siden`.

A new article every six seconds, newest first and round again. The rotation
only moves while it is on screen, so the next turn picks up where the last one
stopped. Each time the article changes, the letters roll up out of the tile
and back in from below, like a ticker; halfway through an article a band
sweeps across it.

![The tile's roll and sweep, frame by frame](docs/preview.png)

The title links to the article on vg.no. It is a terminal hyperlink (OSC 8):
in iTerm2, Ghostty, kitty or WezTerm, cmd-click or ctrl-click it to open it. A
terminal without them draws the URL after the text instead, and the line is
cut to fit.

## Install

```
/plugin install vg --marketplace whirlwin/claude-code-vg
```

Answer `y` to add the marketplace, then pick a scope.

The three themes, Halloween, Hacker News and VG, are also listed together at
[themes.whirlwin.io](https://themes.whirlwin.io), where this mod installs as
`vg@whirlwin-themes`:

```
/plugin marketplace add https://themes.whirlwin.io/marketplace.json
/plugin install vg@whirlwin-themes
```

Install it from one marketplace or the other, not both.

## Update

`/plugin update` installs from the local clone of the marketplace and does
not fetch it first, so refresh the clone before updating:

```
claude plugin marketplace update claude-code-vg
claude plugin update vg@claude-code-vg
```

Installed from themes.whirlwin.io, it is `whirlwin-themes` in place of
`claude-code-vg` in both. Then run `/reload-plugins` in an open session, or
restart Claude Code.

## Use

| Command | What it does |
| --- | --- |
| `/vg` | hide the articles, or bring them back; says why they could not be fetched, if they could not |
| `/vg next` | skip straight to the next article |

## With other mods

Only one mod can draw its own spinner, and the
[halloween](https://github.com/whirlwin/claude-code-halloween) and
[hackernews](https://github.com/whirlwin/claude-code-hackernews) mods draw
theirs too. With one of them installed, which one shows depends on the order
the engine runs their hooks in, which it does not promise for installed
plugins. `/vg` hides this one for the session;
`claude plugin disable vg@claude-code-vg` (or `vg@whirlwin-themes`) keeps it
off.

The [spotify](https://github.com/whirlwin/claude-code-spotify) mod puts the
song after the spinner's word. In the terminal the article takes the place
of that word, so the song does not show while an article does; in the desktop
app the song follows the article.

## How it works

The articles come from VG's public RSS feed,
`https://www.vg.no/rss/feed/?limit=100`, newest first, in one request through
the engine's `$.http.fetch`. Most of its hundred items are goal clips, so the
mod keeps only real articles: an item that links under a section,
`/<section>/i/<id>/<slug>`, and has a lead paragraph. That leaves out the goal
clips, which have no lead, and the partner items from E24 and MinMote, which
link under no section. It keeps up to 20, ranked from 1 in the feed's order,
so an item left out leaves no gap.

The mod fetches while a turn runs, at most every ten minutes (the feed's own
`ttl`); between turns only `/vg` fetches, and only when it has no list yet. A
fetch that fails, or gets no answer within eight seconds, keeps the last list
on screen; with no list yet, it tries again after 30 seconds, and the spinner
shows its own word until one arrives. The first list starts the rotation at
rank 1.

Everything the feed holds is treated as untrusted, since a title is drawn
inside a terminal hyperlink: entities and CDATA are decoded, control and
bidirectional override characters are removed from titles and sections, and
an item whose link is not `https` on `www.vg.no` is left out.

It reads the RSS feed rather than the front page because VG's terms do not
allow scraping vg.no, so it shows the newest articles rather than the order
VG's editors give the front page.

The tile is a `Raster` of quadrant block glyphs, two colors to a cell,
repainted with `$.ui.blit` on a 150 ms clock rather than redrawing the whole
tree. Drawing a tree in the spinner's place drops what the engine draws after
the word (elapsed time, tokens, effort), so the mod shows its own elapsed time.
The token count is not shown. While the engine shows a message of its own in
the spinner, the message replaces the article. In the desktop app only the
word changes, to the article's rank and title.

## Develop

```
claude --plugin-dir .
claude plugin validate .
claude plugin test .
node docs/preview.mjs docs/preview.png
```

The preview script needs Node 22.18 or later, to import `hooks/logo.ts`
without a compile step.

The plugin is named `vg` rather than after the repository because Claude Code
reserves plugin names starting with `claude-`. It is not affiliated with VG or
Schibsted.
