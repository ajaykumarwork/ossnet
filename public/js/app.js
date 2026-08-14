const content = document.getElementById("content");
const techList = document.getElementById("tech-list");
const toast = document.getElementById("toast");

function showToast(message) {
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => (toast.hidden = true), 4500);
}

async function api(path) {
  const res = await fetch(`/api${path}`);
  if (res.status === 503) {
    const body = await res.json().catch(() => ({}));
    throw Object.assign(new Error(body.message || "Database unavailable."), { unavailable: true });
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.json();
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ------------------------------------------------------------------ *
 * Landing state
 * ------------------------------------------------------------------ */

async function renderLanding() {
  content.innerHTML = `
    <div class="landing">
      <h1>Chart the network behind <em>every</em> commit.</h1>
      <p class="lead">
        OSSNet maps developers, the technologies they know, and the repositories
        they've built — as a graph. Search for someone, or pick a technology on
        the left to see who's working in it.
      </p>
      <div id="stats" class="stat-row"><span class="hint">Loading network stats…</span></div>
    </div>
  `;
  try {
    const stats = await api("/graph/stats");
    document.getElementById("stats").innerHTML = [
      ["developers", stats.developers],
      ["repositories", stats.repositories],
      ["technologies", stats.technologies],
      ["organizations", stats.organizations],
      ["connections", stats.connections],
    ]
      .map(([label, num]) => `<div class="stat"><div class="num">${num}</div><div class="label">${label}</div></div>`)
      .join("");
  } catch (err) {
    renderDbError(err, document.getElementById("stats"));
  }
}

function renderDbError(err, target = content) {
  target.innerHTML = `
    <div class="state-message error">
      <strong>Can't reach CognoDB.</strong><br/>
      ${esc(err.message)}<br/><br/>
      Check that your CognoDB Cloud instance is running and that <code>.env</code>
      has the correct URI, user, and password, then refresh.
    </div>
  `;
}

/* ------------------------------------------------------------------ *
 * Technology sidebar
 * ------------------------------------------------------------------ */

async function loadTechList() {
  try {
    const data = await api("/developers");
    if (data.mode !== "technologies") return;
    techList.innerHTML = data.technologies
      .map(
        (t) => `<li class="chip"><button data-tech="${esc(t.name)}">${esc(t.name)}</button> <span class="count">${t.developerCount}</span></li>`
      )
      .join("");
    techList.querySelectorAll("button[data-tech]").forEach((btn) => {
      btn.addEventListener("click", () => renderTechResults(btn.dataset.tech));
    });
  } catch (err) {
    techList.innerHTML = `<li class="hint">Unavailable</li>`;
  }
}

async function renderTechResults(techName) {
  content.innerHTML = `<div class="state-message">Loading developers skilled in <strong>${esc(techName)}</strong>…</div>`;
  try {
    const data = await api(`/developers/tech/${encodeURIComponent(techName)}`);
    if (!data.developers.length) {
      content.innerHTML = `<div class="state-message">No one is tagged with <strong>${esc(techName)}</strong> yet.</div>`;
      return;
    }
    content.innerHTML = `
      <h2 style="font-family: var(--font-display); font-weight:500; margin-bottom: 16px;">
        ${data.developers.length} developer${data.developers.length === 1 ? "" : "s"} skilled in “${esc(techName)}”
      </h2>
      <div class="panel">
        ${data.developers
          .map(
            (d) => `
          <div class="list-item">
            <div>
              <div class="name">${esc(d.name)}</div>
              <div class="sub">${esc(d.title)} · ${esc(d.location)} · ${esc(d.level)}</div>
            </div>
            <button class="link" data-id="${esc(d.id)}">View profile →</button>
          </div>`
          )
          .join("")}
      </div>
    `;
    content.querySelectorAll("button.link[data-id]").forEach((btn) => {
      btn.addEventListener("click", () => renderProfile(btn.dataset.id));
    });
  } catch (err) {
    renderDbError(err);
  }
}

/* ------------------------------------------------------------------ *
 * Search
 * ------------------------------------------------------------------ */

document.getElementById("search-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const term = document.getElementById("search-input").value.trim();
  if (!term) return renderLanding();
  runSearch(term);
});

async function runSearch(term) {
  content.innerHTML = `<div class="state-message">Searching for <strong>${esc(term)}</strong>…</div>`;
  try {
    const data = await api(`/developers?q=${encodeURIComponent(term)}`);
    renderSearchResults(term, data);
  } catch (err) {
    renderDbError(err);
  }
}

function renderSearchResults(term, data) {
  const devs = data.developers || [];
  if (devs.length === 0) {
    content.innerHTML = `
      <div class="state-message">
        No developers matched <strong>${esc(term)}</strong>. Try a technology name,
        a role like "Platform Engineer", or part of a name.
      </div>`;
    return;
  }
  content.innerHTML = `
    <h2 style="font-family: var(--font-display); font-weight:500; margin-bottom: 16px;">
      ${devs.length} result${devs.length === 1 ? "" : "s"} for “${esc(term)}”
    </h2>
    <div class="panel">
      ${devs
        .map(
          (d) => `
        <div class="list-item">
          <div>
            <div class="name">${esc(d.name)}</div>
            <div class="sub">${esc(d.title)} · ${esc(d.location)}</div>
            <div class="tag-row" style="margin-top:6px;">${(d.skills || []).map((s) => `<span class="tag">${esc(s)}</span>`).join("")}</div>
          </div>
          <button class="link" data-id="${esc(d.id)}">View profile →</button>
        </div>`
        )
        .join("")}
    </div>
  `;
  content.querySelectorAll("button.link[data-id]").forEach((btn) => {
    btn.addEventListener("click", () => renderProfile(btn.dataset.id));
  });
}

/* ------------------------------------------------------------------ *
 * Developer profile + constellation map + recommendations
 * ------------------------------------------------------------------ */

async function renderProfile(id) {
  content.innerHTML = `<div class="state-message">Loading profile…</div>`;
  try {
    const [profile, network, recs] = await Promise.all([
      api(`/developers/${encodeURIComponent(id)}`),
      api(`/developers/${encodeURIComponent(id)}/network`),
      api(`/developers/${encodeURIComponent(id)}/recommendations`),
    ]);
    paintProfile(profile, network, recs.recommendations || []);
  } catch (err) {
    renderDbError(err);
  }
}

function levelClass(level) {
  if (level === "expert") return "tag level-expert";
  if (level === "proficient") return "tag level-proficient";
  return "tag";
}

function paintProfile(p, network, recs) {
  content.innerHTML = `
    <div class="profile-header">
      <div>
        <h1>${esc(p.name)}</h1>
        <div class="meta">${esc(p.title)} · ${esc(p.location)} · on the network since ${esc(p.joinedYear)}</div>
        <div class="id">${esc(p.id)}</div>
        <div class="bio">${esc(p.bio)}</div>
      </div>
    </div>

    <div class="grid">
      <div>
        <div class="panel">
          <h2>Ego network <span class="eyebrow">1-hop</span></h2>
          <div class="map-wrap" id="map-target"></div>
        </div>

        <div class="panel">
          <h2>Recommended collaborators <span class="eyebrow">shared tech, not yet connected</span></h2>
          ${
            recs.length
              ? recs
                  .map(
                    (r) => `
              <div class="rec-card">
                <div class="row">
                  <span class="name" data-id="${esc(r.id)}">${esc(r.name)}</span>
                  <span class="score">${r.sharedTechCount} shared · ${r.mutualConnections} mutual</span>
                </div>
                <div class="tag-row">${r.sharedTechnologies.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>
              </div>`
                  )
                  .join("")
              : `<p class="hint">No unconnected developers share a technology with them yet.</p>`
          }
        </div>
      </div>

      <div>
        <div class="panel">
          <h2>Skills</h2>
          <div class="tag-row">
            ${p.skills.map((s) => `<span class="${levelClass(s.level)}">${esc(s.name)} · ${esc(s.level)}</span>`).join("") || '<p class="hint">No skills recorded.</p>'}
          </div>
        </div>

        <div class="panel">
          <h2>Repositories <span class="eyebrow">${p.repos.length}</span></h2>
          ${
            p.repos.length
              ? p.repos
                  .map(
                    (r) => `
              <div class="list-item">
                <div>
                  <div class="name">${esc(r.name)}</div>
                  <div class="sub">${esc(r.role)} · ${r.commits} commits · ★ ${r.stars}</div>
                </div>
              </div>`
                  )
                  .join("")
              : `<p class="hint">No repositories recorded.</p>`
          }
        </div>

        <div class="panel">
          <h2>Direct connections <span class="eyebrow">${p.connections.length}</span></h2>
          ${
            p.connections.length
              ? p.connections
                  .map(
                    (c) => `
              <div class="list-item">
                <div>
                  <div class="name">${esc(c.name)}</div>
                  <div class="sub">since ${esc(c.since)}</div>
                </div>
                <button class="link" data-id="${esc(c.id)}">View →</button>
              </div>`
                  )
                  .join("")
              : `<p class="hint">No direct connections yet.</p>`
          }
        </div>
      </div>
    </div>
  `;

  content.querySelectorAll("[data-id]").forEach((el) => {
    el.style.cursor = "pointer";
    el.addEventListener("click", () => renderProfile(el.dataset.id));
  });

  drawConstellation(document.getElementById("map-target"), network);
}

/* ------------------------------------------------------------------ *
 * Constellation map — a static radial SVG layout, no charting library
 * needed: center node = the searched developer, one ring per relation
 * kind (peers / repos / technologies).
 * ------------------------------------------------------------------ */

function drawConstellation(container, { nodes, edges }) {
  const W = 640, H = 420, cx = W / 2, cy = H / 2;
  const center = nodes.find((n) => n.center);
  const others = nodes.filter((n) => !n.center);

  const kindOrder = { Developer: 0, Repository: 1, Technology: 2 };
  const kindColor = { Developer: "var(--rose)", Repository: "var(--teal)", Developer_center: "var(--gold)" };
  others.sort((a, b) => (kindOrder[a.kind] ?? 9) - (kindOrder[b.kind] ?? 9));

  const positions = new Map();
  positions.set(center.id, { x: cx, y: cy });

  const radius = Math.min(W, H) / 2 - 60;
  others.forEach((n, i) => {
    const angle = (i / Math.max(others.length, 1)) * 2 * Math.PI - Math.PI / 2;
    positions.set(n.id, { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) });
  });

  const edgeSvg = edges
    .map((e) => {
      const a = positions.get(e.source), b = positions.get(e.target);
      if (!a || !b) return "";
      return `<line class="map-edge" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" />`;
    })
    .join("");

  const nodeSvg = [center, ...others]
    .map((n) => {
      const pos = positions.get(n.id);
      if (!pos) return "";
      const isCenter = n.center;
      const color = isCenter ? "var(--gold)" : n.kind === "Repository" ? "var(--teal)" : n.kind === "Technology" ? "var(--rose)" : "var(--text-muted)";
      const r = isCenter ? 8 : 5;
      const labelDy = pos.y > cy ? 16 : -10;
      return `
        <g class="map-node ${isCenter ? "center" : ""}" data-id="${esc(n.id)}" data-kind="${esc(n.kind)}">
          <circle cx="${pos.x}" cy="${pos.y}" r="${r}" fill="${color}" />
          <text x="${pos.x}" y="${pos.y + labelDy}" text-anchor="middle">${esc(n.name || n.id)}</text>
        </g>`;
    })
    .join("");

  container.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Ego network diagram">
      ${edgeSvg}
      ${nodeSvg}
    </svg>
  `;

  container.querySelectorAll(".map-node[data-kind='Developer']").forEach((g) => {
    g.style.cursor = "pointer";
    g.addEventListener("click", () => {
      if (!g.classList.contains("center")) renderProfile(g.dataset.id);
    });
  });
}

/* ------------------------------------------------------------------ *
 * Connection finder (shortest path)
 * ------------------------------------------------------------------ */

document.getElementById("path-btn").addEventListener("click", async () => {
  const from = document.getElementById("path-from").value.trim();
  const to = document.getElementById("path-to").value.trim();
  const target = document.getElementById("path-result");
  if (!from || !to) {
    target.innerHTML = `<p class="hint">Enter both developer ids.</p>`;
    return;
  }
  target.innerHTML = `<p class="hint">Searching…</p>`;
  try {
    const data = await api(`/graph/path?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    if (!data.found) {
      target.innerHTML = `<p class="hint">No path found within 6 hops.</p>`;
      return;
    }
    target.innerHTML = `
      <p class="hint">${data.hops} hop${data.hops === 1 ? "" : "s"} apart</p>
      <div class="path-chain">
        ${data.people.map((p, i) => `${i > 0 ? '<span class="arrow">→</span>' : ""}<span class="node" data-id="${esc(p.id)}">${esc(p.name)}</span>`).join("")}
      </div>
    `;
    target.querySelectorAll(".node[data-id]").forEach((el) => {
      el.style.cursor = "pointer";
      el.addEventListener("click", () => renderProfile(el.dataset.id));
    });
  } catch (err) {
    target.innerHTML = `<p class="hint" style="color: var(--rose);">${esc(err.message)}</p>`;
    showToast("Couldn't reach the database.");
  }
});

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

renderLanding();
loadTechList();
