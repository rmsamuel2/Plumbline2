/* ============================================================================
 * Plumbline — TRUE monoid-based engine (window.PlumblineMonoid)
 * ----------------------------------------------------------------------------
 * The prior engine works on the transition FUNCTION δ over states (bisimulation,
 * SP partitions, SCC + ranking). This module instead materialises the algebra
 * the workflow really defines — its TRANSITION MONOID — and recasts each of the
 * six tools as a genuine monoid operation whose law the Lemma kernel proves.
 *
 * Transition monoid M(A):
 *   For an input word w, the letters act on the (partial, deterministic) state
 *   set Q as a partial transformation δ_w : Q ⇀ Q. M(A) = { δ_w : w ∈ Σ* } under
 *   composition, with identity δ_ε = id_Q. The map η : Σ* → M(A), w ↦ δ_w, is a
 *   surjective MONOID HOMOMORPHISM (η(uv) = η(u)·η(v)); M is built by closing the
 *   generators { δ_a : a ∈ Σ } ∪ {id} under (diagrammatic) composition.
 *
 * Convention: elements compose left-to-right so η respects concatenation.
 *   (f · g)(q) = g(f(q))     — "apply f, then g".     id · f = f · id = f.
 *
 * The six tools, stated on the monoid (each an obligation the kernel discharges):
 *   1. Transition morphism   η : Σ* ↠ M(A)      the mult table IS composition
 *   2. Zoom out              φ : M(A) ↠ M(A/π)  π is an M-congruence (quotient hom)
 *   3. Spot duplicates       ψ : M(A) ↠ M_syn   Nerode/syntactic quotient
 *   4. Move the decision     h : M₁ ≅ M₂         monoid isomorphism (accepting-set-preserving)
 *   5. Run in parallel       M ↪ M/π₁ × M/π₂     two congruences, trivial meet (subdirect)
 *   6. Find the loops        M is APERIODIC       no nontrivial subgroup (Schützenberger);
 *                                                  a group element is the counterexample
 *
 * Nothing here is trusted on faith: checkMonoid() REBUILDS M(A) from the workflow
 * and re-verifies every witness against it — certificate, or counterexample.
 * ==========================================================================*/
window.PlumblineMonoid = (function () {
  "use strict";

  var CAP = 4096;   // guard: max |M(A)| before we decline (state-explosion)

  /* ---- IR helpers (self-contained; same IR the rest of the engine uses) --- */
  function Qof(wf) { return wf.states.map(function (s) { return s.id; }).slice().sort(); }
  function deltaMap(wf) {
    var m = {}; wf.transitions.forEach(function (t) { m[t.from + "" + t.on] = t.to; });
    return m;
  }
  function termSig(wf, id) {
    var s = wf.states.find(function (x) { return x.id === id; });
    return s && s.accept ? "A" : s && s.reject ? "R" : "N";
  }

  /* ---- element = partial transformation of Q, as a canonical string+map --- */
  // rep: array parallel to Q, rep[i] = image index in Q, or -1 (undefined).
  function idRep(Q) { return Q.map(function (_, i) { return i; }); }
  function genRep(wf, a, Q, pos, d) {
    return Q.map(function (q) {
      var to = d[q + "" + a];
      return to === undefined ? -1 : (pos[to] === undefined ? -1 : pos[to]);
    });
  }
  function composeRep(f, g) {                 // (f·g)(q) = g(f(q))
    return f.map(function (fi) { return fi < 0 ? -1 : g[fi]; });
  }
  function keyOf(rep) { return rep.join(","); }

  /* ---- build the transition monoid M(A) ---------------------------------- */
  function transitionMonoid(wf) {
    var Q = Qof(wf), pos = {}; Q.forEach(function (q, i) { pos[q] = i; });
    var d = deltaMap(wf);
    var elems = [], index = {};
    function intern(rep) {
      var k = keyOf(rep);
      if (index[k] !== undefined) return index[k];
      var i = elems.length; elems.push({ rep: rep, key: k }); index[k] = i; return i;
    }
    var idI = intern(idRep(Q));
    var gens = {};
    wf.alphabet.forEach(function (a) { gens[a] = intern(genRep(wf, a, Q, pos, d)); });

    // right-closure from id under the generators reaches every δ_w
    var frontier = elems.slice(), capped = false;
    while (frontier.length && !capped) {
      var next = [];
      for (var f = 0; f < frontier.length; f++) {
        for (var ai = 0; ai < wf.alphabet.length; ai++) {
          var prod = composeRep(frontier[f].rep, elems[gens[wf.alphabet[ai]]].rep);
          var before = elems.length, i = intern(prod);
          if (i === before) { next.push(elems[i]); if (elems.length > CAP) { capped = true; break; } }
        }
        if (capped) break;
      }
      frontier = next;
    }

    // multiplication table (dense; |M|² — fine under the cap)
    var n = elems.length, mul = new Array(n);
    for (var i = 0; i < n; i++) {
      mul[i] = new Array(n);
      for (var j = 0; j < n; j++) mul[i][j] = index[keyOf(composeRep(elems[i].rep, elems[j].rep))];
    }
    return {
      Q: Q, pos: pos, size: n, capped: capped, elems: elems, index: index,
      id: idI, gens: gens, mul: mul,
      apply: function (i, q) { var r = elems[i].rep[pos[q]]; return r < 0 ? undefined : Q[r]; },
      word: function (w) {                 // η(w): fold the letters left-to-right
        var e = idI; for (var k = 0; k < w.length; k++) e = mul[e][gens[w[k]]]; return e;
      },
      isPerm: function (i) { var r = elems[i].rep, seen = {}; // total + injective ⇒ permutation
        for (var x = 0; x < r.length; x++) { if (r[x] < 0 || seen[r[x]]) return false; seen[r[x]] = 1; } return true; }
    };
  }

  /* ---- powers & aperiodicity (Schützenberger: star-free ⇔ group-free) ---- */
  // The finite sequence m, m², m³, … is eventually periodic. m is aperiodic
  // iff that period is 1 (∃n: mⁿ = mⁿ⁺¹). A period > 1 is a nontrivial cyclic
  // subgroup — a genuine "counter" / permutation loop: the counterexample.
  function periodOf(M, m) {
    var seen = {}, cur = m, k = 1;
    while (true) {
      if (seen[cur] !== undefined) return { start: seen[cur], period: k - seen[cur] };
      seen[cur] = k; cur = M.mul[cur][m]; k++;
      if (k > M.size + 2) return { start: 1, period: 1 };  // safety
    }
  }
  function aperiodicity(M) {
    for (var m = 0; m < M.size; m++) {
      if (m === M.id) continue;
      var p = periodOf(M, m);
      if (p.period > 1) return { aperiodic: false, elem: m, period: p.period, enters: p.start };
    }
    return { aperiodic: true };
  }

  /* ---- congruences (M-invariant partitions) ------------------------------ */
  // A partition of Q is an M-congruence iff every generator respects it (then
  // every product does too). The smallest congruence containing a pair {s,t}
  // is its closure under δ — the Hartmanis–Stearns principal congruence.
  function ufMake(Q) { var p = {}; Q.forEach(function (q) { p[q] = q; }); return p; }
  function ufFind(p, x) { while (p[x] !== x) { p[x] = p[p[x]]; x = p[x]; } return x; }
  function ufUnion(p, a, b) { var ra = ufFind(p, a), rb = ufFind(p, b); if (ra !== rb) p[ra] = rb; return ra !== rb; }
  function blocksOf(Q, p) { var b = {}; Q.forEach(function (q) { b[q] = ufFind(p, q); }); return b; }

  function principalCongruence(wf, Q, s, t) {         // smallest congruence with s≡t
    var d = deltaMap(wf), p = ufMake(Q); ufUnion(p, s, t);
    var changed = true;
    while (changed) {
      changed = false;
      for (var i = 0; i < Q.length; i++) for (var j = i + 1; j < Q.length; j++) {
        if (ufFind(p, Q[i]) !== ufFind(p, Q[j])) continue;
        for (var a = 0; a < wf.alphabet.length; a++) {
          var x = d[Q[i] + "" + wf.alphabet[a]], y = d[Q[j] + "" + wf.alphabet[a]];
          if (x !== undefined && y !== undefined && ufFind(p, x) !== ufFind(p, y)) {
            if (ufUnion(p, x, y)) changed = true;
          }
        }
      }
    }
    return blocksOf(Q, p);
  }
  function isCongruence(wf, Q, blockOf) {             // every generator respects the partition
    var d = deltaMap(wf);
    for (var i = 0; i < Q.length; i++) for (var j = 0; j < Q.length; j++) {
      if (blockOf[Q[i]] !== blockOf[Q[j]]) continue;
      for (var a = 0; a < wf.alphabet.length; a++) {
        var x = d[Q[i] + "" + wf.alphabet[a]], y = d[Q[j] + "" + wf.alphabet[a]];
        if (x !== undefined && y !== undefined && blockOf[x] !== blockOf[y])
          return { ok: false, on: wf.alphabet[a], s: Q[i], t: Q[j] };
      }
    }
    return { ok: true };
  }
  function nBlocks(blockOf) { var s = {}; for (var k in blockOf) s[blockOf[k]] = 1; return Object.keys(s).length; }

  /* ---- Nerode / syntactic quotient --------------------------------------- */
  // Coarsest congruence refining the terminal signature = language equivalence
  // on states. Its quotient is the minimal automaton; M of that = syntactic monoid.
  function nerode(wf) {
    var Q = Qof(wf), d = deltaMap(wf);
    var cls = {}; Q.forEach(function (q) { cls[q] = termSig(wf, q); });
    while (true) {
      var sig = {};
      Q.forEach(function (q) {
        var succ = wf.alphabet.map(function (a) {
          var to = d[q + "" + a]; return a + ":" + (to === undefined ? "_" : cls[to]);
        }).join(",");
        sig[q] = cls[q] + "|" + succ;
      });
      // relabel
      var map = {}, nxt = {}, n = 0;
      Q.forEach(function (q) { if (map[sig[q]] === undefined) map[sig[q]] = "c" + (n++); nxt[q] = map[sig[q]]; });
      var same = Q.every(function (q) { return cls[q] === nxt[q] || true; }) &&
        canon(cls) === canon(nxt);
      cls = nxt; if (same) return cls;
    }
    function canon(c) { return Q.map(function (q) { return q + "=" + c[q]; }).join(";"); }
  }
  function quotientAutomaton(wf, blockOf) {
    var reps = {}, states = [];
    Object.keys(blockOf).forEach(function (q) {
      var b = blockOf[q];
      if (!reps[b]) { reps[b] = q; states.push({ id: b, accept: !!(wf.states.find(function (s) { return s.id === q; }) || {}).accept,
        reject: !!(wf.states.find(function (s) { return s.id === q; }) || {}).reject, role: "step" }); }
    });
    var seen = {}, trans = [], d = deltaMap(wf);
    wf.states.forEach(function (s) {
      wf.alphabet.forEach(function (a) {
        var to = d[s.id + "" + a]; if (to === undefined) return;
        var k = blockOf[s.id] + "" + a;
        if (!seen[k]) { seen[k] = 1; trans.push({ from: blockOf[s.id], on: a, to: blockOf[to] }); }
      });
    });
    return { states: states, alphabet: wf.alphabet.slice(), transitions: trans,
      initial: blockOf[wf.initial], meta: wf.meta };
  }
  function syntacticMonoid(wf) {
    var cls = nerode(wf), min = quotientAutomaton(wf, cls);
    return { classOf: cls, minimal: min, monoid: transitionMonoid(min) };
  }

  /* ---- monoid isomorphism search (for redesign) -------------------------- */
  // Fix images of M₁'s generators in M₂; a homomorphism is then determined on
  // every element (as the product of generator images). Verify well-defined,
  // bijective, identity- and accepting-set-preserving.
  function acceptingSet(wf, M) {           // P ⊆ M : elements landing the initial state in an accept state
    var P = {}, init = wf.initial;
    for (var m = 0; m < M.size; m++) { var q = M.apply(m, init); if (q !== undefined && termSig(wf, q) === "A") P[m] = 1; }
    return P;
  }
  function findIso(A, MA, B, MB) {
    if (MA.size !== MB.size) return null;
    var genLettersA = A.alphabet, genLettersB = B.alphabet;
    if (genLettersA.length !== genLettersB.length) {
      // allow different alphabets only if same #generators as monoid elements
    }
    var PA = acceptingSet(A, MA), PB = acceptingSet(B, MB);
    if (Object.keys(PA).length !== Object.keys(PB).length) return null;

    // words that name each element of MA (BFS over generators)
    var nameA = new Array(MA.size); nameA[MA.id] = [];
    var qA = [MA.id];
    while (qA.length) { var e = qA.shift();
      for (var gi = 0; gi < genLettersA.length; gi++) { var g = MA.gens[genLettersA[gi]], p = MA.mul[e][g];
        if (nameA[p] === undefined) { nameA[p] = nameA[e].concat(gi); qA.push(p); } } }

    var candidates = [];
    for (var g2 = 0; g2 < genLettersB.length; g2++) candidates.push(MB.gens[genLettersB[g2]]);
    // also permit generic elements as images (search space small under the cap)
    var pool = []; for (var m2 = 0; m2 < MB.size; m2++) pool.push(m2);

    var kGen = genLettersA.length, imageOfGen = new Array(kGen), result = null;
    function evalWord(name) { var e = MB.id; for (var i = 0; i < name.length; i++) e = MB.mul[e][imageOfGen[name[i]]]; return e; }
    function backtrack(gi) {
      if (result) return;
      if (gi === kGen) {
        var h = new Array(MA.size), used = {};
        for (var m = 0; m < MA.size; m++) { if (nameA[m] === undefined) return; var im = evalWord(nameA[m]);
          if (h[m] !== undefined && h[m] !== im) return; h[m] = im; }
        for (var m2 = 0; m2 < MA.size; m2++) { if (used[h[m2]]) return; used[h[m2]] = 1; }   // bijective
        if (h[MA.id] !== MB.id) return;
        for (var mm = 0; mm < MA.size; mm++) for (var nn = 0; nn < MA.size; nn++)             // homomorphism
          if (h[MA.mul[mm][nn]] !== MB.mul[h[mm]][h[nn]]) return;
        for (var k in PA) if (!PB[h[k]]) return;                                              // accepting set
        result = h; return;
      }
      for (var c = 0; c < pool.length && !result; c++) { imageOfGen[gi] = pool[c]; backtrack(gi + 1); }
    }
    backtrack(0);
    return result;   // array h: MA-index -> MB-index, or null
  }

  /* ======================================================================
   * The Lemma kernel for monoid obligations. Rebuilds M(A) from wf and
   * re-verifies the supplied witness — certificate or counterexample.
   * ====================================================================*/
  function cert(ob) { return { ok: true, certificate: { obligation: ob, checkedBy: "lemma-monoid@1.0.0" } }; }
  function refute(ob, detail, trace) { return { ok: false, counterexample: { obligation: ob, detail: detail, trace: trace || [] } }; }

  function checkMonoid(wf, ob, w) {
    var M = transitionMonoid(wf);
    if (M.capped) return refute(ob, "transition monoid exceeded " + CAP + " elements; bounded and skipped");
    switch (ob.kind) {

      case "transition_morphism": {          // the multiplication table IS composition ⇒ η is a homomorphism
        for (var i = 0; i < M.size; i++) for (var j = 0; j < M.size; j++) {
          var comp = composeRep(M.elems[i].rep, M.elems[j].rep);
          if (M.index[keyOf(comp)] !== M.mul[i][j]) return refute(ob, "product " + i + "·" + j + " is not function composition");
        }
        for (var g = 0; g < M.size; g++) if (M.mul[M.id][g] !== g || M.mul[g][M.id] !== g)
          return refute(ob, "identity law fails at " + g);
        return cert({ kind: ob.kind, size: M.size, generators: Object.keys(M.gens).length });
      }

      case "monoid_aperiodic": {             // find the loops
        var ap = aperiodicity(M);
        if (ap.aperiodic) return cert({ kind: ob.kind, aperiodic: true, size: M.size });
        // counterexample: a group element — trace its orbit on a moved state
        var rep = M.elems[ap.elem].rep, moved = -1;
        for (var x = 0; x < rep.length; x++) if (rep[x] >= 0 && rep[x] !== x) { moved = x; break; }
        var orbit = [], cur = moved;
        for (var s = 0; s < ap.period && cur >= 0; s++) { orbit.push(M.Q[cur]); cur = rep[cur]; }
        return refute(ob, "nontrivial subgroup: an element of period " + ap.period +
          " permutes states with no progress measure", orbit);
      }

      case "monoid_congruence": {            // zoom out: π is M-invariant ⇒ quotient homomorphism φ
        if (!w || w.kind !== "congruence") return refute(ob, "expected a congruence witness");
        var chk = isCongruence(wf, M.Q, w.blockOf);
        if (!chk.ok) return refute(ob, "stage escapes: " + chk.s + " and " + chk.t + " agree but split on '" + chk.on + "'", [chk.on]);
        // full invariance for ALL of M (⇒ φ:M↠M/π is well-defined and a homomorphism)
        for (var m = 0; m < M.size; m++) for (var qi = 0; qi < M.Q.length; qi++) for (var qj = qi + 1; qj < M.Q.length; qj++) {
          if (w.blockOf[M.Q[qi]] !== w.blockOf[M.Q[qj]]) continue;
          var iq = M.apply(m, M.Q[qi]), jq = M.apply(m, M.Q[qj]);
          if (iq !== undefined && jq !== undefined && w.blockOf[iq] !== w.blockOf[jq])
            return refute(ob, "element " + m + " breaks invariance");
        }
        return cert({ kind: ob.kind, blocks: nBlocks(w.blockOf), quotientHom: true });
      }

      case "syntactic_quotient": {           // spot duplicates: Nerode congruence + ψ:M↠M_syn
        if (!w || w.kind !== "nerode") return refute(ob, "expected a nerode witness");
        var congr = isCongruence(wf, M.Q, w.classOf);
        if (!congr.ok) return refute(ob, "claimed Nerode classes are not a congruence");
        // it must also refine the terminal signature
        for (var qi2 = 0; qi2 < M.Q.length; qi2++) for (var qj2 = qi2 + 1; qj2 < M.Q.length; qj2++)
          if (w.classOf[M.Q[qi2]] === w.classOf[M.Q[qj2]] && termSig(wf, M.Q[qi2]) !== termSig(wf, M.Q[qj2]))
            return refute(ob, "merged states differ in accept/reject: " + M.Q[qi2] + ", " + M.Q[qj2]);
        return cert({ kind: ob.kind, classes: nBlocks(w.classOf), states: M.Q.length });
      }

      case "subdirect_product": {            // run in parallel: two congruences, trivial meet
        if (!w || w.kind !== "subdirect") return refute(ob, "expected a subdirect witness");
        var c1 = isCongruence(wf, M.Q, w.pi1), c2 = isCongruence(wf, M.Q, w.pi2);
        if (!c1.ok) return refute(ob, "π₁ is not a congruence");
        if (!c2.ok) return refute(ob, "π₂ is not a congruence");
        if (nBlocks(w.pi1) < 2 || nBlocks(w.pi1) >= M.Q.length) return refute(ob, "π₁ is trivial");
        if (nBlocks(w.pi2) < 2 || nBlocks(w.pi2) >= M.Q.length) return refute(ob, "π₂ is trivial");
        for (var a = 0; a < M.Q.length; a++) for (var b = a + 1; b < M.Q.length; b++)
          if (w.pi1[M.Q[a]] === w.pi1[M.Q[b]] && w.pi2[M.Q[a]] === w.pi2[M.Q[b]])
            return refute(ob, "meet is not trivial: " + M.Q[a] + " and " + M.Q[b] + " share both blocks");
        return cert({ kind: ob.kind, embeds: "M ↪ M/π₁ × M/π₂", blocks1: nBlocks(w.pi1), blocks2: nBlocks(w.pi2) });
      }

      case "monoid_iso": {                   // move the decision / redesign
        if (!w || w.kind !== "iso") return refute(ob, "expected an iso witness", w && w.trace);
        var h = w.h, B = w.b;
        var MA = transitionMonoid(wf), MB = transitionMonoid(B);
        if (MA.capped || MB.capped) return refute(ob, "a monoid exceeded the cap");
        if (h.length !== MA.size || MA.size !== MB.size) return refute(ob, "sizes differ", w.trace);
        var used = {};
        for (var m3 = 0; m3 < MA.size; m3++) { if (h[m3] == null || used[h[m3]]) return refute(ob, "not a bijection"); used[h[m3]] = 1; }
        if (h[MA.id] !== MB.id) return refute(ob, "identity not preserved");
        for (var mm2 = 0; mm2 < MA.size; mm2++) for (var nn2 = 0; nn2 < MA.size; nn2++)
          if (h[MA.mul[mm2][nn2]] !== MB.mul[h[mm2]][h[nn2]]) return refute(ob, "homomorphism law fails");
        var PA2 = acceptingSet(wf, MA), PB2 = acceptingSet(B, MB);
        for (var k2 in PA2) if (!PB2[h[k2]]) return refute(ob, "accepting behaviour not preserved");
        return cert({ kind: ob.kind, iso: true, size: MA.size });
      }

      default: return refute(ob, "unknown monoid obligation");
    }
  }

  /* ======================================================================
   * analyse(wf): run the six tools, each certified by checkMonoid.
   * ====================================================================*/
  function verdictFinding(wf, tool, title, detail, ob, w) {
    var v = checkMonoid(wf, ob, w);
    return { tool: tool, title: title, detail: detail, verdict: v,
      provenance: v.ok ? "monoid-certified" : "refuted" };
  }

  function analyse(wf) {
    var out = [], M = transitionMonoid(wf);
    if (M.capped) {
      return [{ tool: "transition_monoid", title: "Monoid too large", provenance: "skipped",
        detail: "The transition monoid exceeds " + CAP + " elements; bounded and skipped.",
        verdict: { ok: false, counterexample: { detail: "state explosion" } } }];
    }
    var Q = M.Q;

    // 1. Transition morphism η : Σ* ↠ M(A)
    out.push(verdictFinding(wf, "transition_monoid",
      "Transition monoid: " + M.size + " elements on " + Q.length + " states",
      "η : Σ* → M(A) is a monoid homomorphism (the multiplication table is exactly function composition).",
      { kind: "transition_morphism" }, null));

    // 2. Zoom out — role partition as an M-congruence (quotient homomorphism)
    var ORDER = ["step", "quality", "hold", "decision", "rework", "terminal"];
    var roleBlock = {}; wf.states.forEach(function (s) { roleBlock[s.id] = "r" + Math.max(0, ORDER.indexOf(s.role)); });
    out.push(verdictFinding(wf, "zoom_out",
      "Roll up into " + nBlocks(roleBlock) + " stages",
      "π (by role) must be an M-congruence; then φ : M(A) ↠ M(A/π) is a surjective monoid homomorphism.",
      { kind: "monoid_congruence" }, { kind: "congruence", blockOf: roleBlock }));

    // 3. Spot duplicates — the Nerode / syntactic quotient
    var cls = nerode(wf), dup = {};
    Object.keys(cls).forEach(function (q) { (dup[cls[q]] = dup[cls[q]] || []).push(q); });
    var dupGroups = Object.keys(dup).filter(function (c) { return dup[c].length > 1; });
    out.push(verdictFinding(wf, "spot_duplicates",
      dupGroups.length ? "Merge " + dupGroups.map(function (c) { return dup[c].length; }).join("+") + " duplicate statuses"
                       : "No duplicate statuses (already reduced)",
      "ψ : M(A) ↠ M_syn is the syntactic quotient; states in one Nerode class are behaviourally identical.",
      { kind: "syntactic_quotient" }, { kind: "nerode", classOf: cls }));

    // 4. Run in parallel — search two nontrivial congruences with trivial meet
    var congs = [], seenC = {};
    for (var i = 0; i < Q.length; i++) for (var j = i + 1; j < Q.length; j++) {
      var pc = principalCongruence(wf, Q, Q[i], Q[j]), nb = nBlocks(pc);
      if (nb < 2 || nb >= Q.length) continue;
      var sig = Q.map(function (q) { return pc[q]; }).join(",");
      if (!seenC[sig]) { seenC[sig] = 1; congs.push(pc); }
    }
    var parallel = null;
    for (var p1 = 0; p1 < congs.length && !parallel; p1++)
      for (var p2 = p1 + 1; p2 < congs.length && !parallel; p2++) {
        var trivial = true;
        for (var a = 0; a < Q.length && trivial; a++) for (var b = a + 1; b < Q.length; b++)
          if (congs[p1][Q[a]] === congs[p1][Q[b]] && congs[p2][Q[a]] === congs[p2][Q[b]]) { trivial = false; break; }
        if (trivial) parallel = { pi1: congs[p1], pi2: congs[p2] };
      }
    if (parallel) out.push(verdictFinding(wf, "run_in_parallel",
      "Parallel decomposition M ↪ M/π₁ × M/π₂",
      "Two orthogonal congruences (trivial meet) give a subdirect embedding — independent streams.",
      { kind: "subdirect_product" }, { kind: "subdirect", pi1: parallel.pi1, pi2: parallel.pi2 }));
    else out.push({ tool: "run_in_parallel", title: "No non-trivial parallel decomposition", provenance: "n/a",
      detail: "No two orthogonal congruences with trivial meet; the machine is subdirectly irreducible on this axis.",
      verdict: { ok: false, counterexample: { detail: "no orthogonal congruence pair" } } });

    // 6. Find the loops — aperiodicity (no nontrivial subgroup)
    out.push(verdictFinding(wf, "find_loops",
      "Aperiodicity (no counter / permutation loop)",
      "M(A) is aperiodic iff it contains no nontrivial subgroup (Schützenberger: L is star-free). A group element is a real loop.",
      { kind: "monoid_aperiodic" }, null));

    return out;
  }

  // 5. Move the decision / redesign — monoid isomorphism of two designs
  function redesign(a, b) {
    var MA = transitionMonoid(a), MB = transitionMonoid(b);
    var title, ob = { kind: "monoid_iso" }, w = { kind: "iso", b: b };
    if (MA.capped || MB.capped) { w.h = []; title = "Monoid too large to compare"; }
    else {
      var h = findIso(a, MA, b, MB);
      if (h) { w.h = h; title = "Redesign preserves behaviour (M₁ ≅ M₂)"; }
      else { w.h = []; title = "Redesign moved a decision (no monoid isomorphism)"; }
    }
    var v = checkMonoid(a, ob, w);
    return { tool: "check_redesign", title: title,
      detail: "Two designs are behaviourally equal iff their syntactic monoids are isomorphic (accepting set preserved).",
      verdict: v, provenance: v.ok ? "monoid-certified" : "refuted" };
  }

  return {
    version: "plumbline-monoid@1.0.0",
    transitionMonoid: transitionMonoid,
    syntacticMonoid: syntacticMonoid,
    aperiodicity: function (wf) { return aperiodicity(transitionMonoid(wf)); },
    principalCongruence: principalCongruence,
    isCongruence: isCongruence,
    certify: checkMonoid,
    analyze: analyse,
    redesign: redesign
  };
})();
