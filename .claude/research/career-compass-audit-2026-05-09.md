# Career Compass — Algorithm Audit Report

**Subject:** End-to-end audit of the Career Compass / Discover algorithm against Aqil Rouf's actual snapshot in the Convex dev backend.

**Verdict (one-liner):** The algorithm is **implemented correctly** and is **doing what its spec says it does**. The output looks weak for Aqil for three reasons that are *not* algorithm bugs: a **catalog content gap**, a **profile-seeding gap**, and a **threshold/judge calibration mismatch** between what the algorithm admits to "Earlier chapters" and what users intuitively expect that lane to mean.

---

## 1. What I audited

| Subject | File:line / source |
|---|---|
| Cosine similarity math | `convex/lib/discoverScoring.ts:4-21` |
| Stage-rank table | `convex/lib/discoverScoring.ts:46-54` |
| Lane gate thresholds | `convex/lib/discoverThresholds.ts:6-90` |
| Lane bucketing logic | `convex/discover.ts:741-859` |
| LLM judge demotion | `convex/discover.ts:861-912` |
| Slot picking (strong/bridge/aspirational) | `convex/discover.ts:519-611` |
| Snapshot persistence | `convex/discover.ts:1406-1496` |
| Aqil's profile + enrichment | Convex `profiles` / `profile_enrichments` tables |
| Aqil's snapshot | Convex `discover_canvases` (`m173mm4yt3n94n8g738vse2wkh861v6d`) |
| Catalog | All 140 rows of `career_guides` resolved via `internal.discover._readGuideStages` |

---

## 2. Aqil's profile (the input)

- **Headline:** Senior Product Manager at NovaTech Solutions
- **Experience:** Associate PM (2016–18) → PM (2018–21) → Senior PM (2021–present); 8 years total
- **Industries traversed:** Fintech → Mobile Commerce → SaaS Analytics
- **Skills:** Product Strategy, Agile, User Research, Data Analysis, Stakeholder Mgmt, Market Research, PLM
- **Education:** MSc Business & Tech (Imperial), BSc Computer Science (Bristol)
- **Enrichment:** `careerStage = senior-IC`, `careerArchetype = builder`, `careerVelocity = steady`
- **`seedingGuideSlugs = ["product-manager"]`** ← **only 1 of his 3 PM roles**

---

## 3. Aqil's snapshot (the output)

| Lane | Cards | Slot breakdown |
|---|---|---|
| **Linear** ("Next steps") | **0** | (empty) |
| **Adjacent** ("Sideways moves") | **2** | strong:2 — *missing bridge, aspirational, extras* |
| **Earlier** ("Foundational Footprints") | 20 | strong:3, bridge:2, aspirational:1, extra:14 |
| **Transformational** ("Different chapter") | 20 | strong:3, bridge:2, aspirational:1, extra:14 |

**Linear (empty):** —

**Adjacent (2 strong only):**
| Slot | Title | Stage | arc | cur | dom | whole |
|---|---|---|---|---|---|---|
| strong | Operations Manager | manager | 0.764 | 0.731 | 0.786 | 0.735 |
| strong | Principal ML Engineer | senior-IC | 0.764 | 0.710 | 0.774 | 0.723 |

**Earlier (full 20 cards):**
| Slot | Title | Stage | dom | whole |
|---|---|---|---|---|
| strong | Product Manager *(forced via seedingGuideSlugs)* | mid-career | 0.864 | 0.816 |
| strong | Product Marketing Manager | mid-career | 0.842 | 0.775 |
| strong | Sales Engineer | mid-career | 0.794 | 0.709 |
| bridge | QA Automation Engineer | mid-career | 0.764 | 0.693 |
| bridge | Growth Hacker | mid-career | 0.807 | 0.738 |
| aspir. | Partnership Manager | mid-career | 0.790 | 0.737 |
| extras (14) | Brand Mgr · Growth Marketing Mgr · Software Eng · Account Mgr · BD Mgr · Full-Stack Eng · Account Exec · SRE · Financial Analyst · DevOps Eng · Data Eng · Cloud Eng · AI Eng · Enterprise Sales Rep | all mid-career | 0.75–0.80 | 0.69–0.75 |

**Transformational** is a 20-card grab-bag of cross-domain mid-career and manager roles (Construction PM, Content Marketing, Procurement Mgr, SEO Mgr, Software Architect, Investment Banker, Civil Engineer, Actuary, Executive Director, etc.). Mostly correct as "different chapter".

---

## 4. Algorithm correctness — per-step verification

### 4.1 Cosine math ✅
`cosineSim(a, b)` at `discoverScoring.ts:4-21` is textbook correct. Dimension-mismatch guard is present. Clamped to `[0, 1]` to handle Float64 noise. Identical to V1's implementation.

### 4.2 Candidate pool (Step 3) ✅
`generateSnapshot` reads ALL guide embeddings, scores them on 4 facets, sorts by `wholeSim`, takes top 200 (`CANDIDATE_POOL_K`), drops anything with `arcSim < 0.5` (`ARC_SIM_FLOOR`). For Aqil's catalog of 140 guides, all 140 are in the pool. ARC floor admits all of them too (his profile is professionally generic enough that arc similarity stays above 0.5 against every guide).

### 4.3 Stage classification (Step 5) ✅ — implemented exactly as spec'd
`compareStages(userStage, guideStage)` at `discoverScoring.ts:67-78`:
- `senior-IC` (rank 2) vs `mid-career` (rank 1) → `earlier` ✓
- `senior-IC` (2) vs `manager` (2) → `sideways` ✓ (intentional design — manager and senior-IC are equal scope)
- `senior-IC` (2) vs `senior-IC` (2) → `sideways` ✓
- `senior-IC` (2) vs `director` (3) → `forward` ✓

Per-lane gates at `discover.ts:837-858`:
- `linear`: `cmp === "forward" && wholeSim ≥ 0.72` ✓
- `adjacent`: `cmp === "sideways" && wholeSim ≥ 0.72` ✓
- `earlier`: `cmp === "earlier" && wholeSim ≥ 0.68 && domainSim ≥ 0.72` ✓
- else → `transformational`

I cross-checked every card in Aqil's snapshot against these gates and all 42 are consistent.

### 4.4 LLM judge (Step 5b) ✅ — actively working
Three Gemini-Flash calls run in parallel, one per lane. Verdict + confidence; demote OR low-confidence → transformational; medium confidence → kept with `judgePenalty=1` (sorts to extras).

For Aqil, the judge demoted **16 candidates** that had cleared the embedding gates:
- 12 demoted from `earlier` (e.g. SEO Manager, Construction PM, Civil Engineer, Investment Banker, Actuary, Influencer, Privacy Officer, Research Scientist) → all genuinely cross-domain, judge correct.
- 4 demoted from `adjacent` (Procurement Manager, Clinical Trial Manager, Regulatory Affairs Manager, Logistics Manager) → all genuinely cross-domain, judge correct.

Conservative fallback (default to `keep + high` on LLM omission) is sensible.

### 4.5 Slot picking ✅
- `pickStrong`: top 3 by `arcSim` (with `judgePenalty` as primary key)
- `pickBridge`: top 2 by `domainSim` then `arcSim`, excluding strong picks
- `pickAspirational`: Cohere rerank (`cohere/rerank-4-pro`) over top-30 remaining vs user's `arcSourceText`; deterministic fallback `max(arcSim - currentStateSim)`
- `extras`: top 14 by `arcSim`

All four picker behaviors are visible in Aqil's snapshot ordering.

### 4.6 Persistence ✅
`_writeSnapshot` writes the full lane structure with status `ready` + junction rows in `discover_snapshot_guides`. Snapshot row matches expected shape.

**Conclusion:** the algorithm matches its spec at every step. No correctness bugs.

---

## 5. Issues found (severity-ranked)

### **P0 — Catalog content gap (the biggest single issue)**

The catalog has 140 guides distributed by stage as:

| Stage | Count | Examples |
|---|---|---|
| `mid-career` | **98** | Software Eng, PM, Sales Eng, Brand Mgr, etc. |
| `manager` | 12 | Operations Mgr, Procurement Mgr, Logistics Mgr, etc. |
| `director` | 10 | **Academic Dean, Creative Dir, Dir of Admissions, Dir of Operations, Dir of Sales Ops, Fundraising Dir, Public Works Dir, Sales Dir, School Principal, Supply Chain Dir** — *zero in Product/Tech* |
| `exec` | 3 | **CFO, Executive Director (charity), General Counsel** — *zero in Product/Tech* |
| `senior-IC` | 5 | Arbitrator, Data Architect, Principal ML Eng, Professor, Software Architect |
| `early-career` | 8 | Investment Banker, Paralegal, Graphic Designer, etc. |
| `(missing)` | 4 | **Android Developer, Head of Machine Learning, Marketing Operations Mgr, NLP Data Scientist** |

**Implications for Aqil (and any senior-IC PM-flavoured user):**
- **Linear is empty by construction**, not by bug. The catalog has *zero* director or exec guides in Product, Engineering, Design, Data, or any tech-leadership track. There is literally no "Director of Product", "VP Product", "CPO", "Head of Product", "Director of Engineering", "VP Engineering", "CTO" guide. The only forward-stage guides are `Academic Dean`, `Creative Director`, `Director of Admissions`, etc. — none would survive the `wholeSim ≥ 0.72` gate against a SaaS PM profile, so none get admitted.
- **Adjacent is sparse** because of only 17 senior-IC + manager guides total and only `Operations Manager` + `Principal ML Engineer` are close enough to PM/SaaS to clear `wholeSim ≥ 0.72`. The other 15 (Arbitrator, Professor, Accounts Payable Mgr, Clinical Trial Mgr, Compensation Mgr, Treasury Mgr, Warehouse Mgr, etc.) are too cross-domain.
- **Earlier is dominated by mid-career pivots** (engineering, sales, marketing) because that's 70% of the catalog by volume. Even with the `domainSim ≥ 0.72` floor and the LLM judge, plenty squeeze through.

**Severity: P0.** This isn't fixable by changing the algorithm. It needs catalog expansion: senior-IC / manager / director / exec guides in Product, Engineering, Design, Data, Marketing-leadership, and adjacent SaaS verticals. Without those, the algorithm has nothing to recommend in Linear regardless of what thresholds you set.

### **P0 — Lane label vs content mismatch in "Earlier chapters"**

The `earlier` lane is labeled "Foundational Footprints" / "Earlier chapters". For Aqil that should mean "what you were before being a Senior PM" → APM, PM, Product Analyst, Junior PM, maybe Product Designer.

What he actually sees there: 18 of 20 cards are *mid-career lateral pivots* in unrelated functions (Software Engineer, Cloud Engineer, AI Engineer, SRE, Sales Engineer, Account Manager, Account Exec, Enterprise Sales Rep, Brand Manager, Growth Marketing Manager, BDM, Financial Analyst, etc.).

The judge is permissive here on purpose — the prompt apparently asks "could this have been a credible earlier-stage path for this background?" and these all pass that loose test (Aqil has a CS BSc, so engineering "could have" been an earlier path).

But the *label* implies past-self, not "alternate-history past-self". Two ways to fix:

1. **Tighten the judge for `earlier`** — explicitly require the candidate role to be in the user's current functional area (look at `profile_enrichments.enrichedExperience[*].functionalArea`, here `"product"`).
2. **Raise `LANE_DOMAIN_SIM_FLOOR.earlier` from 0.72 → ~0.78.** Today's setting was calibrated against a Head-of-ML test case (`discoverThresholds.ts:64-71`) where `0.72` cleanly split same-domain from cross-domain. For a PM, the same threshold doesn't work as cleanly because PM job text overlaps semantically with sales/marketing/eng across 0.72–0.80.
3. **Or** rename the lane to "Foundational paths" and embrace the broader semantics in copy.

**Severity: P0** for trust — users will read "Earlier chapters" as "things I have done" and find 90% of it false.

### **P1 — `seedingGuideSlugs` only captured 1 of Aqil's 3 PM roles**

`profiles.seedingGuideSlugs = ["product-manager"]`. His resume includes Associate Product Manager, Product Manager, Senior Product Manager. Two are missing:
- `senior-product-manager` → doesn't exist as a guide either (catalog gap)
- `associate-product-manager` → doesn't exist as a guide either (catalog gap)

This means the override branch (`discover.ts:832-835`) only force-routes "Product Manager" to Earlier. The other two roles either don't get seeded (because the seeding code couldn't match them to any guide) or the matching logic only takes one. Worth confirming in `convex/profileGuideSeeding.ts` whether this is "no matching guide" or "we only take one".

**Severity: P1.** Minor in isolation, but it compounds Issue #2 — if more PM-track guides existed, more of his real history could be force-routed correctly.

### **P1 — 4 guides have missing `typicalCareerStage`**

Untyped guides: `Android Developer`, `Head of Machine Learning`, `Marketing Operations Manager`, `Natural Language Processing Data Scientist`. They get classified as `cmp=unknown` and dropped to `transformational` (which is the safe default per `discover.ts:765-767`).

For Aqil specifically, **`Head of Machine Learning` should have been classified `forward` and admitted to Linear** if it had a stage of `director` or `exec`. Currently it falls through to transformational. The Marketing Ops Mgr would likely be `manager` → adjacent. NLP Data Scientist would likely be `mid-career` → earlier.

**Severity: P1** as a one-off data fix; but as a process gap (no validator preventing publish without `typicalCareerStage`) it could keep recurring.

### **P2 — Dead code in `discoverScoring.ts` / `discoverThresholds.ts`**

- `assignLane(currentStateSim)` (`discoverScoring.ts:24-28`) implements an **older 3-lane** classifier on `currentStateSim` (linear ≥ 0.75, adjacent ≥ 0.6, else transformational). It's only referenced by its own test file — the production pipeline uses the stage-based 4-lane logic in `discover.ts:837-858`.
- `LANE_THRESHOLDS = { LINEAR_MIN: 0.75, ADJACENT_MIN: 0.6 }` (`discoverThresholds.ts:6-12`) is similarly orphaned.

**Severity: P2.** Confusing for anyone reading the algorithm — they'll see two competing classifiers. Safe to delete (along with `discoverScoring.test.ts:33-46`).

### **P3 — Stage-rank conflations are intentional but worth flagging**

`STAGE_RANK` (`discoverScoring.ts:46-54`) deliberately conflates:
- `manager === senior-IC` (both rank 2)
- `transitioning === mid-career` (both rank 1)

This means for Aqil (`senior-IC`), `Operations Manager` (manager-stage) lands in **adjacent** as a "sideways move". That's defensible (manager and senior-IC are equivalent-scope), but a Senior PM seeing "Operations Manager" as their primary sideways move *next to* "Principal ML Engineer" may not feel like equally weighted alternatives. Worth product-deciding rather than engineering-deciding.

**Severity: P3.** Working as designed; flagging only because it explains some of the snapshot oddity.

---

## 6. Spot-checks I did

- ✅ Verified Aqil's `seedingGuideSlugs` override took effect: "Product Manager" lands in `earlier/strong` with the highest scores in that lane, confirming the override branch (`discover.ts:832-835`) skipped the gates and the judge.
- ✅ Verified lane budgets were respected: every lane that had >6 admissions has exactly 3 strong + 2 bridge + 1 aspirational + up-to-14 extras.
- ✅ Verified the judge is non-trivially active: 16 of 42 cards in the snapshot were demoted to `transformational` from their natural lane (justified — all are genuinely cross-domain).
- ✅ Verified scores in the snapshot are in the right ranges (cosine ∈ [0, 1], all between 0.65–0.82) — no obvious math bugs.
- ✅ Verified slot ordering: within each lane, `strong` cards are highest `arcSim`, `bridge` cards are highest `domainSim`, `extras` are sorted by `arcSim` descending.
- ✅ No `discover_reactions` rows for Aqil → snapshot is uninfluenced by saves/dismisses.
- ✅ All 140 catalog guides made it into the candidate pool (none filtered by `arcSim < 0.5`).

---

## 7. Bottom-line answer to the question

**"Is the algorithm working as intended?" → Yes.** Every step matches the documented spec, the math is correct, the judge is actively filtering noise, the override branch fires correctly, and the slot pickers respect their budgets and sort keys.

**"Is the output good for Aqil?" → No, but for non-algorithm reasons:**

1. **Linear is empty** because the catalog contains zero director/exec guides in Product/Tech leadership — not because of a gate or judge issue. The algorithm has nothing to put there.
2. **Adjacent is thin** because the catalog has only 17 senior-IC/manager guides total and only 2 of them are in PM-domain.
3. **Earlier is noisy** because 70% of the catalog is mid-career, the judge is permissive on the "could have been a credible earlier path" question, and the `domainSim 0.72` floor was calibrated for a Head-of-ML test case that's stricter than a PM profile demands.
4. **Transformational works as expected** — it's correctly absorbing the cross-domain demotions.

**Where to invest, in priority order:**
1. **Catalog expansion** (P0, biggest leverage): add ~15–20 senior-IC + manager + director + exec guides in Product, Engineering, Design, Data, and Marketing leadership. This single change unblocks Linear and densifies Adjacent for the entire user base.
2. **Tighten `earlier` lane** (P0 for trust): pick one of (a) raise `LANE_DOMAIN_SIM_FLOOR.earlier` to ~0.78, (b) tighten the judge prompt to require functional-area match, (c) rename/reframe the lane to embrace broader semantics. Recommend (b).
3. **Backfill 4 guides missing `typicalCareerStage`**, especially `Head of Machine Learning`. Add a publish-time validator so this can't recur.
4. **Audit the seeding pipeline** — figure out why only "product-manager" was seeded for Aqil; should likely be all 3 PM levels.
5. **Delete dead code** (`assignLane` + `LANE_THRESHOLDS`) — minor cleanup.

No implementation included — this is a read-only audit.
