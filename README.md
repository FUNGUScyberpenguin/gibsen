# GIBSEN Studio

Upload cyber threat intelligence, get a time-driven incident diagram.

GIBSEN Studio turns the intelligence you already have — a written report, a STIX
bundle, a MISP event, an analyst's spreadsheet — into a **GIBSEN diagram**: a
map of the artifacts, processes and behaviours of one incident, laid out across
technical planes and driven by time.

Everything runs in the browser. Nothing is uploaded anywhere, which matters when
the input is a live incident.

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # 143 unit tests
npm run build    # static site in dist/
```

---

## Attribution, and what this is

**GIBSEN** — *Graphical Information Base for Security Event Notation* — is a
visual language devised by **Pete Hay** of **Arbitr Security**, who ships it as
part of a commercial platform. The name nods to William Gibson's *Pattern
Recognition*.

This repository is an **independent, open implementation** of the ideas, not
Arbitr's product and not affiliated with it. It was reconstructed from public
descriptions of the methodology rather than from the source, so:

- The **icon set here is our own**. Arbitr's iconology is theirs; every glyph in
  `src/model/icons.ts` was drawn for this project and is trivially replaceable.
- The **four planes and the time-driven layout** follow the methodology as
  publicly described. Anything finer-grained is our interpretation.
- If you plan to publish diagrams from this tool, or to host it publicly, **talk
  to Pete first.** GIBSEN™ is his mark, and a conversation costs nothing next to
  a trademark dispute. He may also simply tell you which parts we got wrong,
  which would improve the tool.

Corrections to the vocabulary belong in `src/model/taxonomy.ts` and
`src/model/icons.ts` — those two files are deliberately the only places the
visual language is defined.

---

## The model

### Four planes, plus a rail

A diagram is divided top to bottom into the planes an incident crosses:

| Plane | What lives there |
| --- | --- |
| **Cloud** | Tenants, identity providers, SaaS, buckets, OAuth grants, cloud roles |
| **Network** | Domains, addresses, URLs, C2, DNS, mail, firewalls, VPN, shares |
| **Hosts** | Endpoints, servers, processes, files, registry, services, accounts, malware |
| **Operational Technology** | PLCs, HMIs, SCADA, historians, engineering workstations, safety systems |

Above them sits an **Adversary rail**, drawn dashed and muted. Actors,
campaigns, tooling and exploited weaknesses are not technical planes — they are
annotation — so the rail is visually marked as an extension of the original
four rather than a fifth peer.

### Time drives the layout

Columns are ordered time buckets. Artifacts with no timestamp get an
`Unsequenced` column at the left, so they stay visible instead of being dropped.

Columns are **equal width, not proportional to elapsed time**. An intrusion that
runs a 90-second exploit chain and then dwells for three weeks is unreadable to
scale, and the sequence is the point. The real interval between columns is
printed on the axis (`+ 2d 5h`), so nothing is concealed.

Bucket size is chosen automatically — the tool coarsens from seconds up to years
until the diagram fits a sensible column budget — and you can pin it from the
toolbar.

### Artifacts are records, not just boxes

Every node carries the material that makes a diagram into a report:

- **Technical detail** — arbitrary key/value fields (hashes, ports, command lines)
- **Forensic logs** — source, timestamp and the raw excerpt or query
- **Analyst commentary** — why this artifact matters to the story
- **Confidence** — `confirmed` / `probable` / `possible` / `suspected`, rendered
  as border weight so uncertainty is visible at a glance
- **Time basis** — `observed` / `inferred` / `unknown`; inferred times are marked
  `~` on the node and in the report
- **ATT&CK** tactic and technique IDs

Edges carry a verb (`beacons to`, `moves laterally to`, `exfiltrates to`, …),
its own confidence and its own commentary. Behaviour families are colour-coded,
and an edge that points **backwards in time** is drawn dashed — usually a sign
that something needs a second look.

---

## What it reads

Format is detected from content first and filename second, so a `.txt` holding
a STIX bundle still reaches the STIX parser.

### Narrative reports (`.txt`, `.md`, or pasted)

The parser that does the most work, and the one you will correct most.

- **Refangs** `hxxps://`, `[.]`, `(.)`, `[at]`, `[:]` before matching
- Extracts URLs, emails, IPs, domains, MD5/SHA-1/SHA-256, CVEs, ATT&CK IDs,
  registry keys, Windows paths and filenames — resolving overlaps by priority,
  so the domain inside a URL is not also emitted on its own
- **Reads paragraphs, not lines.** Hard-wrapped reports break sentences
  mid-clause; joining the wrap is what lets `the domain\ncontroller CORP-DC-01`
  be recognised at all
- The **paragraph carries the clock**, its **sentences carry the verbs**, so a
  timestamp at the top of a paragraph anchors everything in it while each
  behaviour is read from the clause that describes it
- Lifts assets named in prose (`workstation FIN-WS-014`, `historian PI-HIST-02`,
  `the HMI at 10.20.4.21`) and categorises them by role
- A sentence that names no artifact — *"This is attacker-controlled C2
  infrastructure."* — is treated as commentary on the rest of its paragraph
- Later mentions **sharpen** earlier ones: an address first read as an IP
  becomes a C2 server once a sentence says so, without forking into two nodes

Everything inferred is marked inferred. Nothing a regex found is ever recorded
above `probable`.

### STIX 2.x

Observables and the common SDOs, `indicator` pattern strings expanded into their
observables, `relationship` SROs mapped onto GIBSEN verbs, and `sighting`s used
to promote a node's confidence and first-seen time. `attack-pattern` objects are
folded into the artifacts that reference them — a technique is a property of a
behaviour, not a box on a plane.

### MISP

Bare events, `{"Event": …}` and `{"response": […]}` envelopes. Composite
attribute types (`filename|sha256`) are split, `to_ids` drives the
attacker-controlled flag, MISP categories map onto ATT&CK tactics, objects
become clusters anchored on their first attribute, and `ObjectReference` entries
link those clusters. Galaxy clusters become actors.

### CSV / TSV

Delimiter and header names are sniffed. One file can hold both artifact rows and
relationship rows.

| Role | Accepted column names |
| --- | --- |
| Label | `label`, `name`, `value`, `artifact`, `indicator`, `ioc`, `entity` |
| Category | `category`, `type`, `artifact_type`, `ioc_type`, `kind` |
| Plane | `plane`, `layer`, `tier` |
| Time | `time`, `timestamp`, `datetime`, `date`, `first_seen`, `when`, `occurred` |
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

Dropping several files on one incident merges them. Artifacts are deduped by
category and label; the **earliest** sighting anchors the timeline, the
**strongest** confidence wins, and commentary, techniques, log excerpts and
sources accumulate rather than overwrite. Edges are rewritten onto whichever
node survived, and an edge whose ends collapsed onto a single artifact is
dropped.

## Exports

| Format | Notes |
| --- | --- |
| **SVG** | Self-contained — no external fonts, CSS or images. Opens anywhere |
| **PNG** | 2× raster of the same SVG |
| **JSON** | The full incident, re-openable |
| **Markdown** | Timeline table, behaviours, per-artifact detail with logs and commentary, and a copy-pasteable indicator appendix |

The on-screen diagram and the exported file are produced by the same renderer,
so they cannot drift apart.

---

## Editing

Click any artifact to open the inspector: rename it, move it between planes,
correct its category, set or clear its timestamp, adjust confidence, tag ATT&CK
techniques, add technical fields and log excerpts, and write commentary.
**Link from here…** then clicking a second artifact draws a new behaviour.
`Delete` removes the selection, `Escape` clears it, `f` fits the diagram.

Parser guesses are meant to be corrected. The tool's job is to save you the
first 80% of the transcription, not to be right on its own.

---

## Layout of the code

```
src/
  model/       types, taxonomy, iconology, incident merge/validate, time
  ingest/      stix · misp · csv · text parsers, shared IOC + heuristic helpers
  layout/      time bucketing, plane bands, node placement, edge routing
  render/      SVG renderer and palettes
  export/      SVG/PNG/JSON download, Markdown report
  ui/          DOM helpers, inspector panel
  main.ts      app shell: state, uploads, zoom/pan, selection
samples/       the three sample documents (also used by the tests)
test/          143 unit tests
```

Adding an artifact category means editing `taxonomy.ts` and adding a glyph to
`icons.ts`. Every parser, the layout, the renderer and the inspector pick it up
without further changes.

## Deploying

`npm run build` emits a static site to `dist/` with relative asset paths, so it
works from a subdirectory, a project-scoped GitHub Pages URL, or a plain
`file://` open. `.github/workflows/pages.yml` deploys it on every push to the
default branch once Pages is enabled for the repository (Settings → Pages →
Source: GitHub Actions).

## Caveats

- **PDF is not read yet.** Copy the text out, or paste it. Adding `pdf.js` to the
  text parser is the obvious next step.
- The narrative parser is English-language and heuristic. It is tuned to be
  quiet rather than clever — it would rather miss an artifact than invent one —
  but it will still get things wrong.
- All sample data is fabricated. Addresses come from the RFC 5737 and RFC 1918
  documentation ranges; the domains and hostnames are invented.
