// scripts/seed-data.js
//
// Generates a realistic-shaped (but synthetic) dataset: developers,
// technologies, repositories, organizations, and the relationships
// between them. Deterministic (seeded PRNG) so re-running seed.js
// produces the same graph, which makes screenshots/demo reproducible.

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(42);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const pickN = (arr, n) => {
  const copy = [...arr];
  const out = [];
  while (out.length < n && copy.length) {
    out.push(copy.splice(Math.floor(rand() * copy.length), 1)[0]);
  }
  return out;
};
const int = (min, max) => Math.floor(rand() * (max - min + 1)) + min;

const FIRST_NAMES = [
  "Asha", "Ben", "Chidi", "Dana", "Elif", "Farid", "Gita", "Hana", "Ines", "Jonas",
  "Kavya", "Liam", "Mira", "Noah", "Oksana", "Priya", "Quinn", "Rosa", "Sana", "Tomas",
  "Uma", "Viktor", "Wren", "Xin", "Yara", "Zane", "Amara", "Bao", "Cleo", "Dev",
  "Esi", "Finn", "Gus", "Hina", "Ivo", "Jia", "Kofi", "Lena", "Mateo", "Nadia",
];
const LAST_NAMES = [
  "Adeyemi", "Bergman", "Castillo", "Dubois", "Eriksson", "Farrow", "Gupta", "Haddad",
  "Ivanov", "Jansen", "Kobayashi", "Lindqvist", "Mensah", "Nakamura", "Okafor", "Petrov",
  "Quresh", "Rasmussen", "Silva", "Tanaka", "Ueda", "Vasquez", "Wren", "Xu", "Yilmaz", "Zeller",
];
const TITLES = [
  "Backend Engineer", "Frontend Engineer", "Platform Engineer", "DevOps Engineer",
  "Data Engineer", "ML Engineer", "Security Engineer", "Mobile Engineer",
  "Developer Advocate", "Engineering Manager", "Site Reliability Engineer", "Full-Stack Engineer",
];
const LOCATIONS = [
  "Berlin", "Bengaluru", "Toronto", "Nairobi", "Lisbon", "Singapore", "São Paulo",
  "Warsaw", "Austin", "Seoul", "Amsterdam", "Mexico City",
];

const TECHNOLOGIES = [
  "Rust", "Go", "TypeScript", "Python", "React", "Kubernetes", "GraphQL", "PostgreSQL",
  "WebAssembly", "Terraform", "Svelte", "gRPC", "Elixir", "Cypher", "Docker", "Kafka",
  "Next.js", "PyTorch",
];

const ORG_NAMES = [
  "Openbase Collective", "Ferrous Systems Guild", "Data Mesh Foundry", "Signalworks Labs",
  "Lattice Open Source", "Northwind Toolchain", "Substrate Community", "Harborlight Dev Co-op",
];

const REPO_ADJECTIVES = ["swift", "quiet", "amber", "north", "glass", "cinder", "delta", "coral", "iron", "vale"];
const REPO_NOUNS = ["router", "queue", "mesh", "atlas", "forge", "beacon", "ledger", "sketch", "pulse", "loom"];

function generate() {
  const developers = [];
  for (let i = 0; i < 60; i++) {
    const first = pick(FIRST_NAMES);
    const last = pick(LAST_NAMES);
    developers.push({
      id: `dev_${i + 1}`,
      name: `${first} ${last}`,
      title: pick(TITLES),
      location: pick(LOCATIONS),
      joinedYear: int(2015, 2024),
      bio: `${pick(TITLES)} interested in ${pick(TECHNOLOGIES)} and ${pick(TECHNOLOGIES)}.`,
    });
  }

  const technologies = TECHNOLOGIES.map((name) => ({ name }));

  const organizations = ORG_NAMES.map((name, i) => ({
    id: `org_${i + 1}`,
    name,
    focus: pick(TECHNOLOGIES),
  }));

  const repositories = [];
  for (let i = 0; i < 30; i++) {
    repositories.push({
      id: `repo_${i + 1}`,
      name: `${pick(REPO_ADJECTIVES)}-${pick(REPO_NOUNS)}`,
      description: `An open-source ${pick(["CLI", "library", "service", "toolkit", "framework"])} for ${pick(TECHNOLOGIES)} workflows.`,
      stars: int(12, 9800),
      createdYear: int(2016, 2025),
    });
  }

  // --- Relationships ---

  const skilledIn = []; // Developer -> Technology
  developers.forEach((d) => {
    const techs = pickN(TECHNOLOGIES, int(2, 5));
    techs.forEach((tech) => {
      skilledIn.push({ devId: d.id, tech, level: pick(["familiar", "proficient", "expert"]) });
    });
  });

  const builtWith = []; // Repository -> Technology
  repositories.forEach((r) => {
    const techs = pickN(TECHNOLOGIES, int(1, 3));
    techs.forEach((tech) => builtWith.push({ repoId: r.id, tech }));
  });

  const ownedBy = []; // Organization -> Repository
  repositories.forEach((r) => {
    if (rand() < 0.8) {
      ownedBy.push({ orgId: pick(organizations).id, repoId: r.id });
    }
  });

  const memberOf = []; // Developer -> Organization
  developers.forEach((d) => {
    if (rand() < 0.6) {
      memberOf.push({ devId: d.id, orgId: pick(organizations).id });
    }
  });

  const contributedTo = []; // Developer -> Repository
  repositories.forEach((r) => {
    // Repos built with tech X are more likely to attract developers skilled in X,
    // which is what makes the recommendation query meaningful later.
    const repoTechs = builtWith.filter((b) => b.repoId === r.id).map((b) => b.tech);
    const candidates = developers.filter((d) =>
      skilledIn.some((s) => s.devId === d.id && repoTechs.includes(s.tech))
    );
    const pool = candidates.length >= 2 ? candidates : developers;
    const contributors = pickN(pool, int(2, 6));
    contributors.forEach((d) => {
      contributedTo.push({
        devId: d.id,
        repoId: r.id,
        commits: int(1, 420),
        role: rand() < 0.15 ? "maintainer" : "contributor",
      });
    });
  });

  const knows = []; // Developer <-> Developer (stored one direction, queried undirected)
  const seenPairs = new Set();
  developers.forEach((d) => {
    const peers = pickN(
      developers.filter((p) => p.id !== d.id),
      int(1, 4)
    );
    peers.forEach((p) => {
      const key = [d.id, p.id].sort().join("|");
      if (!seenPairs.has(key)) {
        seenPairs.add(key);
        knows.push({ aId: d.id, bId: p.id, since: int(2016, 2025) });
      }
    });
  });

  return { developers, technologies, organizations, repositories, skilledIn, builtWith, ownedBy, memberOf, contributedTo, knows };
}

module.exports = { generate };
