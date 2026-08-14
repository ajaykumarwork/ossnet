# OSSNet

**Chart the network behind every commit.**

OSSNet is a small web app for discovering open-source collaborators. Instead of
searching a flat directory of developers, you explore the *connections* between
them: who knows whom, what technologies they share, which repositories bridge
two communities, and how many hops separate any two people. It's built on
**CognoDB** (a managed graph database speaking openCypher over Bolt) as the
data layer.

> Built for the Wexa AI CognoDB take-home assignment. Use case, data model,
> and code are original to this submission.

---

## Why a graph database?

The core question this app answers is *"who is connected to whom, and how"* —
that's a relationship-first question, not a row-first one.

- **The interesting queries are multi-hop.** "Recommend collaborators" means:
  developer → repositories they've contributed to → technologies those repos
  use → other developers skilled in those technologies → excluding people
  already connected → ranked by mutual connections. That's a 4-relationship
  traversal with an exclusion and an aggregation. In SQL it's a chain of
  self-joins across four tables plus a `NOT EXISTS` subquery, and it gets
  slower as the join chain grows. In Cypher it's one pattern match, and the
  cost is proportional to the actual paths in the graph, not the size of the
  tables being joined.
- **Shortest path between two people is a first-class operation.** "How is
  Dev A connected to Dev B through the network?" is a variable-length,
  unbounded-depth path search. SQL has no native primitive for this — you'd
  reach for a recursive CTE with manual cycle detection and no built-in
  shortest-path guarantee. Cypher has `shortestPath()` built in.
- **The schema itself is naturally a graph, not a table.** Developers,
  repositories, technologies, and organizations relate to each other in many
  overlapping ways (skill, contribution, ownership, membership, acquaintance).
  Modeling that in a relational schema means a join table per relationship
  type and query plans that get harder to reason about as more relationship
  types are added. In a graph, adding a new kind of relationship is just
  adding a new edge type — no schema migration, no new join table.
- **Traversal depth is a query-time decision, not a schema-time one.** Want
  2-hop recommendations today and 3-hop tomorrow? That's a `*1..2` vs
  `*1..3` change in the query, not a new index or a redesigned table.

None of this is impossible in a relational database — it's just significantly
more code, more indexes, and slower at scale, for a domain that is
relationships by definition.

---

## Data model

```
                       ┌──────────────┐
        ┌─────────────▶│ Organization │
        │ MEMBER_OF     └──────┬───────┘
        │                      │ OWNS
┌───────┴────┐    CONTRIBUTED_TO    ┌──────────────┐
│  Developer  │──────────────────────▶│  Repository  │
└───────┬────┘   {commits, role}     └──────┬───────┘
        │                                    │
        │ SKILLED_IN                         │ BUILT_WITH
        │ {level}                            │
        ▼                                    ▼
   ┌───────────┐                      ┌───────────┐
   │Technology │◀─────────────────────┤Technology │  (same node type,
   └───────────┘                      └───────────┘   two edges into it)

   Developer ──KNOWS {since}──▶ Developer   (peer-to-peer network)
```

**Nodes**

| Label | Key properties |
|---|---|
| `Developer` | `id`, `name`, `title`, `location`, `joinedYear`, `bio` |
| `Technology` | `name` |
| `Repository` | `id`, `name`, `description`, `stars`, `createdYear` |
| `Organization` | `id`, `name`, `focus` |

**Relationships**

| Relationship | Direction | Properties | Meaning |
|---|---|---|---|
| `SKILLED_IN` | `Developer → Technology` | `level` | Developer's proficiency |
| `CONTRIBUTED_TO` | `Developer → Repository` | `commits`, `role` | Contribution to a repo |
| `BUILT_WITH` | `Repository → Technology` | — | Repo's tech stack |
| `OWNS` | `Organization → Repository` | — | Repo ownership |
| `MEMBER_OF` | `Developer → Organization` | — | Org membership |
| `KNOWS` | `Developer → Developer` | `since` | Peer connection (queried as undirected) |

This is documented in code too — see `scripts/seed-data.js` for the generator
and `server/lib/queries.js` for every query that reads this shape.

---

## The main queries, explained

All queries live in [`server/lib/queries.js`](server/lib/queries.js) and are
called only through the official Neo4j driver with parameters — never
string-concatenated Cypher.

1. **`recommendCollaborators`** *(the multi-hop traversal)* — starts at a
   developer, walks `CONTRIBUTED_TO → BUILT_WITH → SKILLED_IN` (3 hops) to
   find other developers who share a technology through a repo, excludes
   people already `KNOWS`-connected, and ranks the rest by shared-technology
   count and mutual-connection count. Powers the "Recommended collaborators"
   panel on a developer's profile.
2. **`shortestConnectionPath`** *(the relational-unfriendly one)* — uses
   `shortestPath((a)-[:KNOWS*..6]-(b))`, a variable-length, unbounded pattern
   match with no fixed join depth. Powers the "Connection finder" in the
   sidebar.
3. **`bridgeDevelopers`** — finds developers skilled in two named
   technologies at once, useful for finding who can translate between two
   otherwise-separate tech communities.
4. **`getDeveloperProfile`** — one query, four `OPTIONAL MATCH` clauses,
   returns a developer's skills, repos, orgs, and connections in a single
   round trip instead of four separate joined queries.
5. **`egoNetwork`** — the data behind the constellation map: everyone and
   everything one hop from a developer, shaped for the SVG visualization.

---

## Project structure

```
ossnet/
├── server/
│   ├── index.js           # Express app, health check, error handling
│   ├── lib/
│   │   ├── db.js           # CognoDB driver, connection + query helpers
│   │   └── queries.js      # Every Cypher query, documented
│   └── routes/
│       ├── developers.js   # /api/developers/*
│       └── graph.js        # /api/graph/* (path, bridges, stats)
├── scripts/
│   ├── seed-data.js        # Deterministic synthetic dataset generator
│   └── seed.js             # Loads the dataset into CognoDB (idempotent)
├── public/                 # Vanilla HTML/CSS/JS frontend (no build step)
│   ├── index.html
│   ├── css/style.css
│   └── js/app.js
├── .env.example
└── README.md
```

---

## Setup

### 1. Create your CognoDB Cloud instance

1. Sign up at [console.cognodb.com/signup](https://console.cognodb.com/signup) (no card required).
2. From the console, create a free **c0** instance and pick a region.
3. Copy the connection URI (`bolt+s://<instance-id>.databases.cognodb.cloud`)
   and the generated password for user `cognodb` — the password is shown
   **once**, so save it immediately.

### 2. Configure the app

```bash
git clone <this-repo-url>
cd ossnet
cp .env.example .env
```

Edit `.env`:

```
COGNODB_URI=bolt+s://<instance-id>.databases.cognodb.cloud
COGNODB_USER=cognodb
COGNODB_PASSWORD=<your-generated-password>
PORT=3000
```

### 3. Install, seed, and run

```bash
npm install
npm run seed     # loads ~60 developers, 30 repos, 18 technologies, 8 orgs
npm start        # http://localhost:3000
```

`npm run seed` is safe to re-run — it clears and reloads the OSSNet data
using `MERGE`, so it won't create duplicates.

If CognoDB is unreachable (wrong credentials, instance sleeping, etc.), the
app still boots and the UI shows a clear "can't reach CognoDB" state instead
of hanging or crashing — see `server/lib/db.js` and the error handling in
`server/index.js`.

### 4. Try it

- Search for a technology in the sidebar (e.g. **Rust**) to see who works in it.
- Click a developer to see their profile, ego network, skills, repos, and
  recommended collaborators.
- Use **Connection finder** in the sidebar with two developer ids (e.g.
  `dev_1` and `dev_20`, printed at the end of the seed script) to see the
  shortest path between them.

---

## Deployment

The app is a single Node/Express process serving both the API and the static
frontend, so it deploys to any free Node host (Render, Railway, Fly.io,
Cyclic, etc.) — set the same three `COGNODB_*` environment variables there
that you set locally, plus `PORT` if the platform requires it.

**Live demo:** _add your hosted URL here before submitting_
**Screen recording:** _add your recording link here before submitting_

---

## Screenshots

_Add screenshots of the landing state, a developer profile with its
constellation map, and the connection finder here before submitting —
`docs/` is set up for them._

---

## Notes on the dataset

The seed data (`scripts/seed-data.js`) is **synthetic** — invented names,
invented repositories, real technology names (React, Rust, Kubernetes, etc.)
used generically. It's deterministic (seeded PRNG) so the graph is the same
shape every time you run `npm run seed`, which keeps demo screenshots and
the shortest-path examples reproducible.
