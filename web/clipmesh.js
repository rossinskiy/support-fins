/**
 * Cut a closed triangle mesh to an axis-aligned box and close the cuts with flat
 * caps, so a fin that reaches past the build plate is shortened at the plate's
 * edge and stays a closed solid. Pure mesh math, no DOM.
 *
 * `tris` is a flat list of vertices [x, y, z], three per triangle, wound
 * counter-clockwise seen from outside (the engine's convention). Returns the same
 * kind of list. Several separate closed solids in one list are fine: each cut
 * makes one loop per solid it crosses.
 */
const KEY = 1e4;
const key = (p) => `${Math.round(p[0] * KEY)},${Math.round(p[1] * KEY)},${Math.round(p[2] * KEY)}`;

/** Keep the side of the plane where p[axis] * sign >= lim * sign. */
function clipPlane(tris, axis, lim, sign) {
  const d = (p) => (p[axis] - lim) * sign;
  const out = [];
  const segs = [];   // cut edges, each [from, to], running along the kept polygon's winding
  for (let i = 0; i < tris.length; i += 3) {
    const v = [tris[i], tris[i + 1], tris[i + 2]];
    const ds = v.map(d);
    if (ds.every((x) => x >= 0)) { out.push(v[0], v[1], v[2]); continue; }
    if (ds.every((x) => x <= 0)) continue;
    const poly = [];
    let enter = null, exit = null;
    for (let k = 0; k < 3; k++) {
      const a = v[k], b = v[(k + 1) % 3], da = ds[k], db = ds[(k + 1) % 3];
      if (da >= 0) poly.push(a);
      if ((da > 0 && db < 0) || (da < 0 && db > 0)) {
        const f = da / (da - db);
        const q = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
        q[axis] = lim;
        poly.push(q);
        if (da > 0) exit = q; else enter = q;
      }
    }
    for (let k = 1; k + 1 < poly.length; k++) out.push(poly[0], poly[k], poly[k + 1]);
    if (enter && exit) segs.push([exit, enter]);   // polygon edge exit -> enter lies on the plane
  }
  return { out, segs };
}

/** Chain cut edges into closed loops (each a list of points). */
function loops(segs) {
  const from = new Map();
  for (const s of segs) {
    const k = key(s[0]);
    if (!from.has(k)) from.set(k, []);
    from.get(k).push(s);
  }
  const used = new Set();
  const res = [];
  for (const s0 of segs) {
    if (used.has(s0)) continue;
    const loop = [s0[0]];
    let s = s0;
    for (;;) {
      used.add(s);
      loop.push(s[1]);
      const next = (from.get(key(s[1])) ?? []).find((c) => !used.has(c));
      if (!next) break;
      s = next;
    }
    if (loop.length > 3 && key(loop[0]) === key(loop[loop.length - 1])) { loop.pop(); res.push(loop); }
  }
  return res;
}

/** Ear-clip a simple polygon lying in the plane normal to `axis`, giving triangles whose
 *  normal points along `outward` (+1 or -1 on that axis). */
function cap(loop, axis, outward) {
  const [a, b] = [0, 1, 2].filter((x) => x !== axis);
  const P = loop.map((p) => [p[a], p[b]]);
  let area = 0;
  for (let i = 0; i < P.length; i++) {
    const q = P[(i + 1) % P.length];
    area += P[i][0] * q[1] - q[0] * P[i][1];
  }
  const idx = loop.map((_, i) => i);
  if (area < 0) idx.reverse();             // counter-clockwise in (a, b)
  const cross = (o, p, q) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
  const inTri = (p, t0, t1, t2) => cross(t0, t1, p) >= 0 && cross(t1, t2, p) >= 0 && cross(t2, t0, p) >= 0;
  const tri2 = [];
  let guard = idx.length * idx.length + 10;
  while (idx.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const i0 = idx[(i + idx.length - 1) % idx.length], i1 = idx[i], i2 = idx[(i + 1) % idx.length];
      if (cross(P[i0], P[i1], P[i2]) <= 1e-12) continue;
      let ear = true;
      for (const j of idx) {
        if (j === i0 || j === i1 || j === i2) continue;
        if (inTri(P[j], P[i0], P[i1], P[i2])) { ear = false; break; }
      }
      if (!ear) continue;
      tri2.push(i0, i1, i2);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;   // a degenerate sliver: drop the rest rather than loop
  }
  if (idx.length === 3) tri2.push(idx[0], idx[1], idx[2]);
  // (a, b, axis) is right-handed for axes 0 and 2, left-handed for axis 1
  const flip = (axis === 1 ? -1 : 1) * outward < 0;
  const out = [];
  for (let k = 0; k < tri2.length; k += 3) {
    const t = [loop[tri2[k]], loop[tri2[k + 1]], loop[tri2[k + 2]]];
    out.push(...(flip ? [t[0], t[2], t[1]] : t));
  }
  return out;
}

/** Cut `tris` to [x0,x1] x [y0,y1]. Z is left alone. */
export function clipToBox(tris, { x0, x1, y0, y1 }) {
  let cur = tris;
  for (const [axis, lim, sign] of [[0, x0, 1], [0, x1, -1], [1, y0, 1], [1, y1, -1]]) {
    const { out, segs } = clipPlane(cur, axis, lim, sign);
    cur = out;
    // the removed side lies toward -sign, so the cap faces that way
    for (const l of loops(segs)) cur.push(...cap(l, axis, -sign));
  }
  return cur;
}
