# GIBSEN Studio

### ▶ **[Open the tool](https://funguscyberpenguin.github.io/gibsen/)**

[![CI](https://github.com/FUNGUScyberpenguin/gibsen/actions/workflows/ci.yml/badge.svg)](https://github.com/FUNGUScyberpenguin/gibsen/actions/workflows/ci.yml)

Upload cyber threat intelligence, get a time-driven incident diagram.

GIBSEN Studio turns the intelligence you already have — a written report, a STIX
bundle, a MISP event, an analyst's spreadsheet — into a **threat matrix**: a map
of the artifacts, processes and behaviours of one incident, with **time along
the X axis** and **artifact planes down the Y**.

Nothing to install and nothing to sign up for. **Everything runs in your
browser** — there is no server side to this tool, so an incident you drop on it
never leaves your machine. That is the point: it has to be safe to paste live
incident data into.

### Try it in thirty seconds

Open the link above and click one of the three samples in the left sidebar:

- **Narrative report** — a written intrusion summary. Watch prose become a
  sequenced diagram: timestamps, hostnames, indicators and the verbs joining them.
- **Analyst spreadsheet** — a hand-built artifact table, with artifacts that span
  time and triangles standing in for many-at-once.
- **Malware path** — one binary end to end: the lure, the shortcut, the signed
  binary everything depends on, what gets unpacked in memory, the shadow copies
  destroyed, the shares swept, and the exfil that happens *before* the encryption.
- **STIX 2.1 bundle** — observables, relationships, an indicator pattern and a
  sighting.

Click any artifact to open its record. Load all three to watch them merge into
one incident. Then **Export → Interactive page** for a single self-contained
`.html` you can send to somebody.

### Running it yourself

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # unit tests
npm run build    # static site in dist/
```

---

## Attribution, and what this is

The method is **Pete Hay's**, from his talk **"The Importance of Arts and Crafts
in ThreatOps"** at the **DEF CON 31 Packet Hacking Village** (2023), where he was
principal security strategist at SimSpace and founder of The Cyber Report. He
calls the construction a **threat matrix** and the Y axis **artifact planes**.

**GIBSEN** — *Graphical Information Base for Security Event Notation* — is the
name the same idea carries at **Arbitr Security**, where Pete is now CEO, as
part of a commercial platform. The talk itself never uses the name.

This repository is an **independent, open implementation**, not Arbitr's product
and not affiliated with it. Specifically:

- The **icon set here is our own**. Every glyph in `src/model/icons.ts` was drawn
  for this project.
- The **structure** — time on X, artifact planes on Y, triangles for many-at-once,
  long nodes for duration, the registry on the seam between memory and disk —
  follows the talk.
- Anything finer-grained is our interpretation, and the two plane sets below are
  our reading of two vintages of the same idea.

**Pete does not claim this as a standard, and neither do we.** He raises XKCD 927
in the talk himself — fourteen competing standards, so obviously what the world
needs is a fifteenth — and says outright that his goal is a tool for your
repertoire, to be broken out when it fits, not one true notation. He is equally
plain that you should subdivide the planes however suits you: there are, in his
words, no artifact plane police. The vocabulary here is confined to
`src/model/taxonomy.ts` and `src/model/icons.ts` so that disagreeing with it is
a small diff.

If you plan to host this publicly or publish diagrams from it, talk to Pete
first — GIBSEN™ is Arbitr's mark, and he may also tell you which parts we got
wrong.

---

## The model

### Why time, and not ATT&CK tactics

The talk's argument for the X axis: ATT&CK's tactic columns imply a rough
sequence but do not guarantee one, and nothing in a layer says technique A led
into technique B. Without that link you cannot build a detection or a response
around the chain. Sequencing by time restores it — and it is the axis most
incident diagrams simply leave undefined.

### Artifact planes

The Y axis clusters artifacts by **where you go looking for them**. Two sets ship,
switchable from the toolbar, and a diagram remembers which it uses.

**Artifact planes** (default) — the talk's own split:

| Plane | What lives there |
| --- | --- |
| Cloud | Tenants, identity, SaaS, buckets, OAuth grants |
| External network | Domains, addresses, URLs, mail, C2, certificates |
| Internal network | Hosts, endpoints, file servers, shares, perimeter kit |
| Host memory | Processes, services, drivers, credentials, user context |
| *Registry* | *Drawn on the seam — genuinely sometimes memory, sometimes disk* |
| Host file system | Files, scripts, executables, archives, tasks, logs |
| Operational technology | PLCs, HMIs, SCADA, historians, safety systems |

Hosts sit in the internal network rather than in a host plane, because the talk
lists hosts, endpoints and file servers among the *network* artifacts and
reserves the host planes for what is found *on* a box.

**Technical domains** — the coarser Cloud / Network / Hosts / OT split the Arbitr
platform later shipped, which suits intelligence crossing cloud and OT.

Above both sits an **Adversary rail**, drawn dashed and muted. Actors, campaigns,
tooling and CVEs are not places you go looking for artifacts, so it is marked as
this tool's addition rather than a peer of the real planes.

### Nodes are things, not events

A log tells you a process did something; five logs tell you it did five things.
The node is the **process**, and the behaviours hang off it as edges. That
coalescing is what keeps the diagram legible.

Every node carries the material that turns a picture into a report:

- **Technical detail** — arbitrary key/value fields (hashes, ports, command lines)
- **Forensic logs** — source, timestamp and the raw excerpt or query
- **Analyst commentary** — why this artifact matters, and where the research came from
- **Confidence** — `confirmed` / `probable` / `possible` / `suspected`, rendered as
  border weight so uncertainty is visible at a glance
- **Time basis** — `observed` / `inferred` / `unknown`; inferred times are marked `~`
- **ATT&CK** tactic and technique IDs

Detail lives on the node rather than on the canvas on purpose: zoom out for the
executive summary, zoom in for the function-level notes.

**The diagram is never compressed to save room.** Every distinct timestamp gets
its own column, so four steps of a delivery chain seconds apart stay four
columns rather than collapsing into one minute. A wide diagram costs nothing; a
diagram that has quietly stopped distinguishing 09:14:10 from 09:14:20 costs the
reader the thing they came for.

### The record modal

The box carries what an artifact *is*. Everything that makes it evidence — the
full value, the hashes, the command line, the log line it came out of, the
analyst's reasoning — opens in a modal over the diagram and then gets out of the
way again. That is what lets the boxes stay small enough to take in at a glance
without anything being lost.

- A box with more behind it carries a **`⋯` marker**. Click it, double-click the
  artifact, press <kbd>Enter</kbd> with it selected, or use **Full record** in
  the inspector
- The **title is the whole value**, wrapped, never elided, with a **Copy value**
  button beside it
- **Connections** are clickable: walk the chain artifact by artifact without
  losing your place
- <kbd>Esc</kbd> or a click on the dimmed backdrop closes it; **Edit in the
  inspector** hands the artifact back for editing

Labels only get shortened when they genuinely will not fit two lines, and then
the *middle* is dropped rather than the tail — `HKCU\…\CurrentVersion\Run\`
`KettleUpdate` still reads as the Run key it is, where `…s\CurrentVersion\Ru…`
reads as nothing at all. The `⋯` marker is drawn only on screen: on an exported
SVG or PNG it would point nowhere, so the flat exporters strip it.

### Artifacts that span time

Set an artifact's **Until** and it is drawn long, running across every column it
was live for. A staged archive written at 08:00, read at 09:00 and deleted at
14:00 is one long box with a rule to its far end, not three separate boxes.

Bands are packed by interval rather than stacked per column, so spanning nodes
share a lane whenever they do not overlap.

### Triangles for many-at-once

Rather than drawing one line per endpoint when a process touches hundreds, an
artifact can stand in for the set:

- **One reaching many** — a host sweeping a subnet, a process enumerating shares.
  Drawn as a triangle widening left to right.
- **Many reaching one** — a beacon calling the same C2 endpoint over and over.
  Drawn narrowing, apex on the single endpoint.

Both turn red when marked attacker-controlled.

### Points of congruence

The analytic payoff. Once the chain is laid out, the artifacts every later step
depends on become obvious — a campaign with four lures and three payloads that
all funnel through one signed binary reaching the internet has one real weak
point, not seven. Kick that leg out and the whole thing falls over.

The tool computes these as the **cut vertices** of the incident graph, ranks them
by how much of the intrusion each one is holding up, rings the top few on the
diagram, and lists them in the Markdown report with what each one severs. Toggle
the rings with **Choke points** in the toolbar.

### The malware path

Breaking out how a single specimen works is its own use of the diagram: how it
arrives — an attachment, a link, a redirect — what files are involved, what they
do in memory and across the wire, through to exfiltration and encryption.

The vocabulary covers what that walk actually needs, so the edges say what
happened rather than shrugging:

| | |
| --- | --- |
| Arrival | `contains` a shortcut, `delivers`, `downloads-from` |
| On disk | `writes` / `drops` the loader, the staged archive, the ransom note |
| In memory | `decrypts` the payload, `injects-into` a signed process, `creates` a mutex, `spawns-thread` |
| Across the wire | `beacons-to`, `discovers` / `enumerates` shares, `connects-to` |
| Impact | `inhibits-recovery` (shadow copies, backups), `encrypts`, `exfiltrates-to` |

Categories to match: `shellcode` for a stage that never touches disk, `thread`
for a worker, `mutex` for the single-instance guard, `shadow-copy` for what the
ransomware destroys, `ransom-note`, and `link-file` for the shortcut that starts
so many of these chains.

Verbs are matched loosely, so `drops`, `enumerates`, `deletes-shadow-copies`,
`unpacks-to` and `hollows` all land on the right relation. Anything genuinely
unrecognised **warns** rather than quietly becoming "related to" — losing the
verb is losing the only thing the edge was carrying.

### Behaviours

Edges carry a verb (`beacons to`, `moves laterally to`, `exfiltrates to`, …),
its own confidence and its own commentary. Behaviour families are colour-coded,
and an edge pointing **backwards in time** is drawn dashed — usually a sign that
something needs a second look.

---

## What it reads

Format is detected from content first and filename second, so a `.txt` holding
a STIX bundle still reaches the STIX parser.

### Narrative reports (`.txt`, `.md`, or pasted)

The parser that does the most work, and the one you will correct most.

- **Refangs** `hxxps://`, `[.]`, `(.)`, `[at]`, `[:]` before matching
- Extracts URLs, emails, IPs, domains, MD5/SHA-1/SHA-256, CVEs, ATT&CK IDs,
  registry keys, Windows paths and filenames — resolving overlaps by priority, so
  the domain inside a URL is not also emitted on its own, and `HKCU\Software` is
  not mistaken for a domain account
- **Reads paragraphs, not lines.** Hard-wrapped reports break sentences
  mid-clause; joining the wrap is what lets `the domain\ncontroller CORP-DC-01` be
  recognised at all
- The **paragraph carries the clock**, its **sentences carry the verbs**
- Lifts assets named in prose (`workstation FIN-WS-014`, `historian PI-HIST-02`,
  `the HMI at 10.20.4.21`) and categorises them by role
- A sentence naming no artifact — *"This is attacker-controlled C2
  infrastructure."* — is treated as commentary on the rest of its paragraph
- Later mentions **sharpen** earlier ones: an address first read as an IP becomes
  a C2 server once a sentence says so, without forking into two nodes

Everything inferred is marked inferred. Nothing a regex found is recorded above
`probable`.

### STIX 2.x

Observables and the common SDOs, `indicator` pattern strings expanded into their
observables, `relationship` SROs mapped onto verbs, and `sighting`s used to
promote a node's confidence and first-seen time. `attack-pattern` objects fold
into the artifacts that reference them — a technique is a property of a
behaviour, not a box on a plane.

### MISP

Bare events, `{"Event": …}` and `{"response": […]}` envelopes. Composite attribute
types (`filename|sha256`) are split, `to_ids` drives the attacker-controlled flag,
MISP categories map onto ATT&CK tactics, objects become clusters anchored on
their first attribute, and `ObjectReference` entries link those clusters. Galaxy
clusters become actors.

### CSV / TSV

Delimiter and header names are sniffed. One file can hold both artifact rows and
relationship rows.

| Role | Accepted column names |
| --- | --- |
| Label | `label`, `name`, `value`, `artifact`, `indicator`, `ioc`, `entity` |
| Category | `category`, `type`, `artifact_type`, `ioc_type`, `kind` |
| Plane | `plane`, `layer`, `tier` |
| Time | `time`, `timestamp`, `datetime`, `date`, `first_seen`, `when`, `occurred` |
| Until | `end`, `until`, `last_seen`, `end_time`, `through`, `ended` |
| Stands for many | `aggregate`, `many`, `stands_for`, `fan` — `fan-out` / `converge` |
| How many | `count`, `quantity`, `how_many` |
| Confidence | `confidence`, `certainty` — words, `high/med/low`, `0–1` or `0–100` |
| Tactic | `tactic`, `phase`, `stage`, `kill_chain` |
| Techniques | `technique`, `techniques`, `attack`, `mitre` |
| Commentary | `commentary`, `notes`, `note`, `analysis`, `comment`, `description` |
| Compromised | `compromised`, `malicious`, `attacker_controlled` |
| Edge source | `from`, `source`, `src`, `parent` |
| Edge target | `to`, `target`, `dst`, `destination` |
| Relation | `relation`, `relationship`, `action`, `verb` |

Unrecognised columns are **not discarded** — they become artifact details, which
is usually where the interesting per-shop context lives. An artifact referenced
only by a relationship row gets a placeholder node flagged for review.

### Saved incidents

`.gibsen.json` files re-open as a whole incident rather than merging. The format
is exactly the `Incident` type in `src/model/types.ts`, so it is hand-editable
and diffs cleanly in git.

---

## Merging

Dropping several files on one incident merges them. Artifacts dedupe by category
and label; the **earliest** sighting anchors the timeline, the **latest** end
extends the span, the **strongest** confidence wins, and commentary, techniques,
log excerpts and sources accumulate rather than overwrite. Edges are rewritten
onto whichever node survived, and an edge whose ends collapsed onto a single
artifact is dropped.

## Exports

| Format | Notes |
| --- | --- |
| **Interactive page** | One self-contained `.html` — pan, zoom, hover, open the record modal. Details below |
| **SVG** | Self-contained — no external fonts, CSS or images. Opens anywhere |
| **PNG** | 2× raster of the same SVG |
| **JSON** | The full incident, re-openable |
| **Markdown** | Timeline, behaviours, points of congruence, per-artifact detail with logs and commentary, and a copy-pasteable indicator appendix |

The on-screen diagram and the exported file are produced by the same renderer,
so they cannot drift apart.

### The interactive page

The format to hand to somebody else. A single `.html` file carrying the diagram,
the entire incident record and the script to explore it — **no server, no build
step, no network requests at all**. Attach it to a ticket, put it on a share, or
open it from `file://` on a machine with no internet.

- **Hover** an artifact for a summary: category, plane, when, confidence, tactic,
  and the first line of the analyst's commentary
- **Click** to open the record as a modal over the diagram — the full value with
  a copy button, technical fields, ATT&CK, log excerpts, commentary, and every
  behaviour touching it
- **Follow a connection** to walk the chain artifact by artifact
- **Search** dims everything that does not match; quick filters narrow to
  attacker-controlled artifacts, points of congruence, or the unsequenced ones
- **Deep links** — selecting an artifact puts it in the address bar, so you can
  send someone a link to the exact node you want them to look at
- Drag to pan, ctrl/⌘+scroll to zoom, `/` to search, `f` to fit, `Esc` to close

This is the zoom-out-for-the-summary, zoom-in-for-the-detail property the method
depends on: an executive reads the shape, an analyst opens the node.

Artifact text is escaped on the way in, so a hostile label or a log excerpt
containing `</script>` cannot break out of the page it is embedded in.

---

## Editing

Click any artifact to open the inspector: rename it, move it between planes,
correct its category, set its start and end times, adjust confidence, tag ATT&CK
techniques, make it stand in for many, add technical fields and log excerpts, and
write commentary. **Link from here…** then clicking a second artifact draws a new
behaviour. `Delete` removes the selection, `Enter` opens its record, `Escape`
closes the record or clears the selection, `f` fits the diagram.

Parser guesses are meant to be corrected. The tool's job is to save you the first
80% of the transcription, not to be right on its own.

---

## Layout of the code

```
src/
  model/       types, taxonomy, iconology, incident merge/validate, time
  ingest/      stix · misp · csv · text parsers, shared IOC + heuristic helpers
  layout/      time bucketing, plane bands, interval packing, edge routing
  analysis/    points of congruence
  render/      SVG renderer and palettes
  export/      SVG/PNG/JSON download, Markdown report, interactive page
  ui/          DOM helpers, inspector panel
  main.ts      app shell: state, uploads, zoom/pan, selection
samples/       the sample documents (also used by the tests)
test/          unit tests
```

Adding an artifact category means editing `taxonomy.ts` and adding a glyph to
`icons.ts`. Adding a plane set is a few lines in `PLANE_SETS`. Every parser, the
layout, the renderer and the inspector pick both up without further changes.

## Deploying

The tool is a static site — there is no server side to it — so GitHub Pages is
a complete deployment, not a demo of one.

`npm run build` emits `dist/` with **relative** asset paths, which is what lets
it work unchanged from a project-pages URL like
`https://<user>.github.io/gibsen/`, from a subdirectory on any web server, or
from a plain `file://` open.

This repository deploys to
**<https://funguscyberpenguin.github.io/gibsen/>** on every push to the default
branch, via `.github/workflows/pages.yml`. The workflow gates on the default
branch **by name at run time** rather than hardcoding `main`, so renaming the
branch will not silently switch deployments off.

**If you fork this, two settings once.** The workflow passes `enablement: true`
to `actions/configure-pages` so the first run provisions the Pages site itself,
but that call needs a `GITHUB_TOKEN` allowed to write. If a run fails with
*"Create Pages site failed … Resource not accessible by integration"*, set:

- *Settings → Actions → General → Workflow permissions* → **Read and write permissions**
- *Settings → Pages → Source* → **GitHub Actions**

Then re-run. After that every push deploys on its own.

To deploy somewhere else, `dist/` is the whole thing — copy it anywhere that
serves files.

**A note on hosting it publicly.** The tool keeps incident data in the browser
and uploads nothing, so a public instance is not a data-handling risk to its
users. The consideration is the other one in the attribution section above:
GIBSEN™ is Arbitr's mark, and a public instance is worth a word with Pete first.

## Not built yet

The talk's incident-response workflow is the obvious next piece: start from the
single alert, then work **left** to source and **right** to scope, with each step
a query you run and a node you fill in. Done properly the half-empty diagram
becomes the status board — a supervisor can see how far the investigation has
been scoped and hand the network half to somebody else. Today the tool builds a
diagram from intelligence you already have; it does not yet drive that
back-and-forth pivot.

Also outstanding: **PDF is not read** — copy the text out, or paste it. Adding
`pdf.js` to the text parser is the obvious fix.

## Caveats

- The narrative parser is English-language and heuristic. It is tuned to be quiet
  rather than clever — it would rather miss an artifact than invent one — but it
  will still get things wrong.
- All sample data is fabricated. Addresses come from the RFC 5737 and RFC 1918
  documentation ranges; the domains and hostnames are invented.
