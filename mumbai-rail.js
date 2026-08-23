/**
 * mumbai-rail.js — journey planner + fare engine over mumbai_suburban_rail.json
 *
 * Zero dependencies. Works in Node (ESM) and in the browser.
 *
 *   import { MumbaiRail } from './mumbai-rail.js';
 *   const rail = await MumbaiRail.load('./mumbai_suburban_rail.json');
 *   rail.quote('BUD', 'CSMT', { ticketType: 'season_monthly' });
 */

export class MumbaiRail {
  constructor(data) {
    this.data = data;
    this.stations = new Map();   // code -> station record
    this.adj = new Map();        // code -> [{ to, km, lines }]
    this.#buildIndex();
    this.#buildGraph();
  }

  static async load(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to load network data: ${res.status}`);
    return new MumbaiRail(await res.json());
  }

  static fromJSON(data) { return new MumbaiRail(data); }

  // ---------------------------------------------------------------- indexing
  #buildIndex() {
    for (const line of this.data.lines) {
      for (const s of line.stations) {
        if (!s.code) continue;                 // metro/monorail have no IR code
        let rec = this.stations.get(s.code);
        if (!rec) {
          rec = {
            code: s.code,
            name: s.name,
            aliases: s.aliases ?? [s.name],
            isJunction: !!s.is_junction,
            cidco: !!s.cidco_surcharge,
            lines: [],
            times: {},                          // lineId -> minutes from origin
          };
          this.stations.set(s.code, rec);
        }
        if (!rec.lines.includes(line.id)) rec.lines.push(line.id);
        if (s.minutes_from_origin != null) rec.times[line.id] = s.minutes_from_origin;
      }
    }
  }

  #buildGraph() {
    for (const e of this.data.edges) {
      if (e.km == null) continue;               // Vasai–Roha has no distances yet
      this.#link(e.from, e.to, e.km, e.lines);
      this.#link(e.to, e.from, e.km, e.lines);
    }
  }

  #link(a, b, km, lines) {
    if (!this.adj.has(a)) this.adj.set(a, []);
    this.adj.get(a).push({ to: b, km, lines });
  }

  // ---------------------------------------------------------------- lookup
  /** Autocomplete. Matches code, name and every alias. Prefix hits rank first. */
  search(query, limit = 8) {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out = [];
    for (const st of this.stations.values()) {
      const hay = [st.code, st.name, ...st.aliases].map(x => x.toLowerCase());
      let score = null;
      if (hay.some(h => h === q)) score = 0;
      else if (hay.some(h => h.startsWith(q))) score = 1;
      else if (hay.some(h => h.includes(q))) score = 2;
      if (score !== null) out.push({ ...st, score });
    }
    return out.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name))
              .slice(0, limit);
  }

  get(code) { return this.stations.get(code); }

  stationsOnLine(lineId) {
    return this.data.lines.find(l => l.id === lineId)?.stations ?? [];
  }

  // ---------------------------------------------------------------- routing
  /** Dijkstra weighted by kilometres. Returns { km, path } or null. */
  route(from, to) {
    if (!this.stations.has(from)) throw new Error(`Unknown station: ${from}`);
    if (!this.stations.has(to))   throw new Error(`Unknown station: ${to}`);
    if (from === to) return { km: 0, path: [{ code: from, lines: null }] };

    const dist = new Map([[from, 0]]);
    const prev = new Map();
    const done = new Set();
    // Small network (~170 nodes) so a linear scan beats a heap in practice.
    const queue = new Set([from]);

    while (queue.size) {
      let node = null, best = Infinity;
      for (const c of queue) {
        const d = dist.get(c) ?? Infinity;
        if (d < best) { best = d; node = c; }
      }
      queue.delete(node);
      if (node === to) break;
      done.add(node);

      for (const edge of this.adj.get(node) ?? []) {
        if (done.has(edge.to)) continue;
        const alt = best + edge.km;
        if (alt < (dist.get(edge.to) ?? Infinity)) {
          dist.set(edge.to, alt);
          prev.set(edge.to, { code: node, lines: edge.lines });
          queue.add(edge.to);
        }
      }
    }

    if (!dist.has(to)) return null;

    const path = [];
    let cur = to;
    while (cur !== from) {
      const p = prev.get(cur);
      path.unshift({ code: cur, lines: p.lines });
      cur = p.code;
    }
    path.unshift({ code: from, lines: null });
    return { km: Math.round(dist.get(to) * 10) / 10, path };
  }

  /** The "via" string printed on an IR ticket. Junctions, or a known override. */
  via(from, to, path) {
    const OVERRIDES = { 'BUD>CSMT': 'KYN-TNA-CLA-DR-SNRD' };
    if (OVERRIDES[`${from}>${to}`]) return OVERRIDES[`${from}>${to}`];
    if (OVERRIDES[`${to}>${from}`])
      return OVERRIDES[`${to}>${from}`].split('-').reverse().join('-');
    return path.slice(1, -1)
               .filter(p => this.stations.get(p.code)?.isJunction)
               .map(p => p.code).join('-');
  }

  /** Where the rider actually changes trains. */
  interchanges(path) {
    const out = [];
    let current = null, prevCode = path[0]?.code ?? null;
    for (const step of path) {
      if (!step.lines) { prevCode = step.code; continue; }
      const next = new Set(step.lines);
      if (!current) { current = next; prevCode = step.code; continue; }
      const overlap = [...current].filter(l => next.has(l));
      if (overlap.length) { current = new Set(overlap); }
      else {
        // The change happens at the LAST shared station, not the first new one.
        const st = this.stations.get(prevCode);
        out.push({ at: prevCode, name: st.name,
                   fromLine: [...current].sort()[0], toLine: [...next].sort()[0] });
        current = next;
      }
      prevCode = step.code;
    }
    return out;
  }

  /** Rough duration from the map's time boxes. Null when the map is silent. */
  duration(path) {
    const first = this.stations.get(path[0].code);
    const last  = this.stations.get(path[path.length - 1].code);
    for (const lineId of Object.keys(first.times)) {
      if (last.times[lineId] != null) {
        return Math.abs(last.times[lineId] - first.times[lineId]);
      }
    }
    // Fall back to a shared line where only one endpoint has a time.
    const a = first.times[Object.keys(first.times)[0]];
    const b = last.times[Object.keys(last.times)[0]];
    return (a != null && b != null) ? Math.abs(b - a) : null;
  }

  // ---------------------------------------------------------------- fares
  slabFor(km) {
    const up = Number.isInteger(km) ? km : Math.ceil(km);   // always round UP
    return this.data.fare_rules.slabs.find(s => up >= s.from_km && up <= s.to_km) ?? null;
  }

  static addMonths(iso, months) {
    const d = new Date(iso + 'T00:00:00Z');
    const day = d.getUTCDate();
    d.setUTCMonth(d.getUTCMonth() + months);
    if (d.getUTCDate() < day) d.setUTCDate(0);              // clamp 31 Jan -> 28 Feb
    d.setUTCDate(d.getUTCDate() - 1);                        // "minus one day"
    return d.toISOString().slice(0, 10);
  }

  validity(startISO, ticketType) {
    const months = { season_monthly: 1, season_quarterly: 3,
                     season_half_yearly: 6, season_yearly: 12 }[ticketType];
    return months ? MumbaiRail.addMonths(startISO, months) : null;
  }

  /**
   * The whole answer for one query.
   * opts: { ticketType, cls, startDate }
   */
  quote(from, to, opts = {}) {
    const { ticketType = 'single', cls = 'SECOND', startDate = null } = opts;
    const r = this.route(from, to);
    if (!r) return { error: 'NO_ROUTE', from, to };

    const slab = this.slabFor(r.km);
    const rules = this.data.fare_rules;
    const tt = rules.ticket_types[ticketType];
    if (!tt) throw new Error(`Unknown ticket type: ${ticketType}`);

    const key = cls.toLowerCase();
    let fare = null, basis = null;

    if (ticketType === 'single' || ticketType === 'return') {
      const base = slab?.[`single_${key}`];
      if (base != null) {
        fare = base * tt.multiplier_of_single;
        basis = `${tt.multiplier_of_single} x single, slab ${slab.from_km}-${slab.to_km} km`;
      }
    } else if (ticketType === 'season_monthly') {
      fare = slab?.[`mst_${key}`] ?? null;
      if (fare != null) basis = `published MST table, slab ${slab.from_km}-${slab.to_km} km`;
    } else {
      const mst = slab?.[`mst_${key}`];
      if (mst != null) {
        fare = Math.round(mst * tt.multiplier_of_mst / 5) * 5;
        basis = `${tt.multiplier_of_mst} x MST, rounded to nearest Rs.5`;
      }
    }

    const A = this.stations.get(from), B = this.stations.get(to);
    const result = {
      from: { code: A.code, name: A.name },
      to:   { code: B.code, name: B.name },
      chargeableKm: r.km,
      fareSlabKm: slab ? `${slab.from_km}-${slab.to_km}` : null,
      via: this.via(from, to, r.path),
      stops: r.path.length - 2,
      path: r.path.map(p => p.code),
      interchanges: this.interchanges(r.path),
      approxMinutes: this.duration(r.path),
      ticketType, class: cls,
      fareInr: fare,
      fareBasis: basis,
      fareAvailable: fare != null,
      cidcoSurcharge: A.cidco || B.cidco,
    };

    if (startDate && ticketType.startsWith('season')) {
      result.validFrom = startDate;
      result.validTill = this.validity(startDate, ticketType);
    }
    return result;
  }

  /** Every ticket option for one pair — for a fare-comparison screen. */
  quoteAll(from, to, cls = 'SECOND', startDate = null) {
    return Object.keys(this.data.fare_rules.ticket_types)
      .map(t => this.quote(from, to, { ticketType: t, cls, startDate }));
  }
}
