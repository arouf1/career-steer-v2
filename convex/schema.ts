import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    tokenIdentifier: v.string(),
    email: v.string(),
    name: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
  }).index("by_tokenIdentifier", ["tokenIdentifier"]),

  profiles: defineTable({
    userId: v.id("users"),
    sourceFormat: v.union(v.literal("pdf"), v.literal("docx")),
    rawText: v.string(),
    parsedAt: v.number(),
    reviewed: v.boolean(),
    rateLimit: v.object({
      countInWindow: v.number(),
      windowStartedAt: v.number(),
    }),
    name: v.optional(v.union(v.string(), v.null())),
    headline: v.optional(v.union(v.string(), v.null())),
    summary: v.optional(v.union(v.string(), v.null())),
    location: v.optional(v.union(v.string(), v.null())),
    experience: v.array(v.object({
      title: v.string(),
      company: v.string(),
      startDate: v.optional(v.string()),
      endDate: v.optional(v.string()),
      description: v.optional(v.string()),
    })),
    education: v.array(v.object({
      school: v.string(),
      degree: v.optional(v.string()),
      field: v.optional(v.string()),
      startDate: v.optional(v.string()),
      endDate: v.optional(v.string()),
    })),
    skills: v.array(v.string()),
  }).index("by_userId", ["userId"]),

  profile_enrichments: defineTable({
    profileId: v.id("profiles"),
    userId: v.id("users"),
    status: v.union(
      v.literal("pending"),
      v.literal("ready"),
      v.literal("stale"),
      v.literal("failed"),
    ),

    careerStage: v.optional(v.union(
      v.literal("early-career"),
      v.literal("mid-career"),
      v.literal("senior-IC"),
      v.literal("manager"),
      v.literal("director"),
      v.literal("exec"),
      v.literal("transitioning"),
    )),
    careerArchetype: v.optional(v.union(
      v.literal("founder"),
      v.literal("builder"),
      v.literal("scaler"),
      v.literal("fixer"),
      v.literal("integrator"),
      v.literal("specialist"),
      v.literal("generalist"),
    )),
    narrativeSummary: v.optional(v.string()),
    motivations: v.optional(v.array(v.object({
      kind: v.union(
        v.literal("impact"),
        v.literal("growth"),
        v.literal("craft"),
        v.literal("autonomy"),
        v.literal("financial"),
        v.literal("mission"),
        v.literal("mastery"),
      ),
      evidenceQuote: v.string(),
    }))),
    workStyleSignals: v.optional(v.object({
      collaboration: v.union(v.literal("ic"), v.literal("hybrid"), v.literal("team-lead")),
      pace: v.union(v.literal("deliberate"), v.literal("fast")),
      scope: v.union(v.literal("depth"), v.literal("breadth")),
    })),
    pivots: v.optional(v.array(v.object({
      year: v.optional(v.number()),
      kind: v.union(v.literal("role"), v.literal("function"), v.literal("industry")),
      deltaDescription: v.string(),
    }))),

    enrichedExperience: v.array(v.object({
      isoStart: v.optional(v.string()),
      isoEnd: v.optional(v.string()),
      isCurrent: v.boolean(),
      tenureMonths: v.optional(v.number()),
      functionalArea: v.union(
        v.literal("engineering"),
        v.literal("product"),
        v.literal("design"),
        v.literal("data"),
        v.literal("sales"),
        v.literal("marketing"),
        v.literal("ops"),
        v.literal("finance"),
        v.literal("legal"),
        v.literal("hr"),
        v.literal("research"),
        v.literal("exec"),
        v.literal("other"),
      ),
      subFunction: v.optional(v.string()),
      seniorityLevel: v.object({
        track: v.union(v.literal("ic"), v.literal("manager"), v.literal("exec")),
        band: v.number(),
      }),
      industry: v.optional(v.string()),
      companySizeSignal: v.union(
        v.literal("solo"),
        v.literal("startup-seed"),
        v.literal("startup-growth"),
        v.literal("scale-up"),
        v.literal("enterprise"),
        v.literal("unknown"),
      ),
      roleArchetype: v.optional(v.union(
        v.literal("founder"),
        v.literal("builder"),
        v.literal("scaler"),
        v.literal("fixer"),
        v.literal("integrator"),
        v.literal("specialist"),
        v.literal("generalist"),
      )),
      quantifiedAchievements: v.array(v.object({
        verb: v.string(),
        metric: v.optional(v.string()),
        delta: v.optional(v.string()),
        scope: v.optional(v.string()),
        evidenceQuote: v.string(),
      })),
      scopeSignals: v.object({
        teamSizeLed: v.optional(v.number()),
        budgetSignal: v.optional(v.string()),
        geography: v.optional(v.array(v.string())),
      }),
      toolsUsed: v.array(v.string()),
      domainExpertise: v.array(v.string()),
    })),

    enrichedSkills: v.array(v.object({
      raw: v.string(),
      canonical: v.string(),
      category: v.union(
        v.literal("technical"),
        v.literal("leadership"),
        v.literal("domain"),
        v.literal("soft"),
        v.literal("language"),
        v.literal("tool"),
      ),
      yearsOfExperience: v.optional(v.number()),
      lastUsedYear: v.optional(v.number()),
      proficiencySignal: v.union(
        v.literal("exposure"),
        v.literal("working"),
        v.literal("proficient"),
        v.literal("expert"),
      ),
    })),

    totalYearsExperience: v.optional(v.number()),
    careerVelocity: v.optional(v.union(
      v.literal("slow"),
      v.literal("steady"),
      v.literal("fast"),
      v.literal("very-fast"),
    )),
    tenureStats: v.optional(v.object({
      avgMonths: v.number(),
      longestMonths: v.number(),
      shortestMonths: v.number(),
    })),
    careerGaps: v.optional(v.array(v.object({
      startIso: v.optional(v.string()),
      endIso: v.optional(v.string()),
      durationMonths: v.number(),
      inferredReason: v.optional(v.string()),
    }))),
    geographicMobility: v.optional(v.object({
      cities: v.array(v.string()),
      countries: v.array(v.string()),
      remoteSignal: v.union(
        v.literal("onsite"),
        v.literal("hybrid"),
        v.literal("remote-friendly"),
        v.literal("remote-only"),
        v.literal("unknown"),
      ),
    })),
    languagesSpoken: v.optional(v.array(v.string())),

    enrichedEducation: v.array(v.object({
      isoStart: v.optional(v.string()),
      isoEnd: v.optional(v.string()),
      degreeLevel: v.union(
        v.literal("none"),
        v.literal("certificate"),
        v.literal("associate"),
        v.literal("bachelor"),
        v.literal("master"),
        v.literal("mba"),
        v.literal("phd"),
        v.literal("other"),
      ),
      fieldNormalized: v.optional(v.string()),
      institutionType: v.union(
        v.literal("university"),
        v.literal("bootcamp"),
        v.literal("online-platform"),
        v.literal("k12"),
        v.literal("other"),
      ),
    })),

    confidenceFlags: v.array(v.string()),
    model: v.string(),
    enrichedAt: v.number(),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    failureReason: v.optional(v.string()),
  })
    .index("by_profileId", ["profileId"])
    .index("by_userId", ["userId"]),

  profile_embeddings: defineTable({
    profileId: v.id("profiles"),
    userId: v.id("users"),
    wholeVector: v.array(v.float64()),
    arcVector: v.array(v.float64()),
    currentStateVector: v.array(v.float64()),
    domainVector: v.array(v.float64()),
    // Text content used to compute arcVector. Used as the rerank query for
    // the discover canvas's aspirational slot picker. Optional so existing
    // rows stay valid until re-embedded.
    arcSourceText: v.optional(v.string()),
    dimensions: v.number(),
    model: v.string(),
    generatedAt: v.number(),
  })
    .index("by_profileId", ["profileId"])
    .index("by_userId", ["userId"])
    .vectorIndex("by_whole", {
      vectorField: "wholeVector",
      dimensions: 1536,
      filterFields: ["userId"],
    })
    .vectorIndex("by_arc", {
      vectorField: "arcVector",
      dimensions: 1536,
      filterFields: ["userId"],
    })
    .vectorIndex("by_currentState", {
      vectorField: "currentStateVector",
      dimensions: 1536,
      filterFields: ["userId"],
    })
    .vectorIndex("by_domain", {
      vectorField: "domainVector",
      dimensions: 1536,
      filterFields: ["userId"],
    }),

  career_paths: defineTable({
    profileId: v.id("profiles"),
    userId: v.id("users"),
    kind: v.union(
      v.literal("linear"),
      v.literal("adjacent"),
      v.literal("transformational"),
    ),
    targetRoleTitle: v.string(),
    targetFunctionalArea: v.string(),
    targetIndustry: v.optional(v.string()),
    targetLevel: v.string(),
    syntheticJd: v.string(),
    rationale: v.string(),
    requiredSkills: v.array(v.string()),
    skillGaps: v.array(v.object({
      skill: v.string(),
      severity: v.union(
        v.literal("low"),
        v.literal("medium"),
        v.literal("high"),
      ),
    })),
    effortMonths: v.number(),
    confidence: v.number(),
    fitScore: v.number(),
    rerankedAt: v.optional(v.number()),
    generatedAt: v.number(),
  })
    .index("by_profileId_and_kind", ["profileId", "kind"])
    .index("by_userId", ["userId"]),

  career_guides: defineTable({
    slug: v.string(),
    title: v.string(),
    titleNormalized: v.string(),
    contentStatus: v.union(
      v.literal("generating"),
      v.literal("complete"),
      v.literal("failed"),
    ),
    content: v.optional(
      v.object({
        overview: v.string(),
        typicalSkills: v.array(v.string()),
        typicalSkillsDetail: v.optional(
          v.array(
            v.object({
              name: v.string(),
              rationale: v.string(),
              tier: v.union(v.literal("must"), v.literal("nice")),
            }),
          ),
        ),
        dayToDay: v.string(),
        riskFactors: v.array(v.string()),
        whyConsider: v.string(),
        // SEO meta produced inline with content. Optional so legacy guides
        // (pre-meta) still validate; backfilled by triggerMetaBackfill.
        meta: v.optional(
          v.object({
            title: v.string(),
            description: v.string(),
            keywords: v.array(v.string()),
            socialAlt: v.string(),
          }),
        ),
        regional: v.object({
          us: v.object({
            salary: v.object({
              entry: v.string(),
              mid: v.string(),
              senior: v.string(),
              note: v.optional(v.string()),
            }),
            careerOutlook: v.string(),
            learningPath: v.array(v.string()),
            relatedRoles: v.array(v.string()),
          }),
          uk: v.object({
            salary: v.object({
              entry: v.string(),
              mid: v.string(),
              senior: v.string(),
              note: v.optional(v.string()),
            }),
            careerOutlook: v.string(),
            learningPath: v.array(v.string()),
            relatedRoles: v.array(v.string()),
          }),
        }),
      }),
    ),
    illustrationStorageId: v.optional(v.id("_storage")),
    illustrationStatus: v.union(
      v.literal("generating"),
      v.literal("complete"),
      v.literal("failed"),
    ),
    // Per-section illustrations that complement the hero. Keys are slot
    // ids: "day-to-day", "outlook", "learning-path", "risks". Each renders
    // at the top of its corresponding article section. Optional so legacy
    // guides remain valid; failing slots stay in the record with status
    // "failed" so the UI knows not to retry-render.
    slotIllustrations: v.optional(
      v.record(
        v.string(),
        v.object({
          storageId: v.optional(v.id("_storage")),
          status: v.union(
            v.literal("generating"),
            v.literal("complete"),
            v.literal("failed"),
          ),
        }),
      ),
    ),
    // "Go Deeper" follow-up questions per section. Keys mirror GoDeeper
    // sectionIds: "overview", "day-to-day", "outlook-us", "outlook-uk",
    // "learning-path-us", "learning-path-uk", "considerations". Each value
    // is a short list of curiosity-driven questions a reader might click.
    // Optional: legacy guides have no followUps and the UI hides the block.
    followUps: v.optional(v.record(v.string(), v.array(v.string()))),
    followUpsStatus: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("generating"),
        v.literal("complete"),
        v.literal("failed"),
      ),
    ),
    // Per-field citation map. Field paths like "regional.us.salary",
    // "typicalSkills", "riskFactors". Only enriched fields appear here.
    citations: v.optional(
      v.record(
        v.string(),
        v.array(
          v.object({
            url: v.string(),
            title: v.string(),
            publisher: v.optional(v.string()),
            fetchedAt: v.number(),
          }),
        ),
      ),
    ),
    // Live state for the sidebar fact-check status card.
    enrichment: v.optional(
      v.object({
        status: v.union(
          v.literal("pending"),
          v.literal("running"),
          v.literal("complete"),
          v.literal("failed"),
          v.literal("deferred"),
        ),
        progress: v.object({ total: v.number(), done: v.number() }),
        lastEnrichedAt: v.optional(v.number()),
        error: v.optional(v.string()),
        attempts: v.number(),
        costCents: v.number(),
      }),
    ),
    // Auto-generated host + guest podcast that talks through the guide's
    // themes. Two-stage pipeline: scripting (LLM dialogue) → synthesizing
    // (Gemini TTS multi-speaker). All fields optional so existing rows
    // remain valid before backfill.
    podcast: v.optional(
      v.object({
        status: v.union(
          v.literal("pending"),
          v.literal("scripting"),
          v.literal("synthesizing"),
          v.literal("complete"),
          v.literal("failed"),
        ),
        audioStorageId: v.optional(v.id("_storage")),
        durationSeconds: v.optional(v.number()),
        // True once the bundled Career Cast jingle has been prepended to the
        // stored audio. Set by synthesize (always true now) and the
        // prependJingleToExisting backfill. Optional so legacy rows remain
        // valid — the backfill targets rows where this is undefined/false.
        hasJingle: v.optional(v.boolean()),
        // Hook-y per-episode title generated by the script LLM. Legacy rows
        // (pre-this-field) leave it undefined; the UI falls back to a
        // template based on the guide title.
        episodeTitle: v.optional(v.string()),
        hostVoice: v.string(),
        guestVoice: v.optional(v.string()),
        guestName: v.optional(v.string()),
        guestRole: v.optional(v.string()),
        guestGender: v.optional(
          v.union(v.literal("female"), v.literal("male")),
        ),
        transcript: v.optional(
          v.array(
            v.object({
              speaker: v.union(v.literal("host"), v.literal("guest")),
              text: v.string(),
            }),
          ),
        ),
        error: v.optional(v.string()),
        attempts: v.number(),
        generatedAt: v.optional(v.number()),
      }),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
    // Content-generation retry bookkeeping. Counts every failure (incl. the
    // initial attempt); reset to 0 on successful publish. Cron + page-load
    // triggers honour CONTENT_MAX_ATTEMPTS unless `force` bypass is used.
    contentAttempts: v.optional(v.number()),
    contentLastFailureAt: v.optional(v.number()),
    contentLastError: v.optional(v.string()),
  })
    .index("by_slug", ["slug"])
    .index("by_title_normalized", ["titleNormalized"])
    .index("by_content_status", ["contentStatus"])
    .index("by_created", ["createdAt"])
    .searchIndex("search_title", { searchField: "title" }),

  // Per-guide facet embeddings. Mirrors `profile_embeddings` so a user's
  // facet vector can be matched directly against a guide's facet vector
  // (currentState↔currentState for "guides for who I am now", arc↔arc for
  // "where I could go", domain↔domain for "skill-overlapping roles"). The
  // wholeVector also powers guide↔guide related-guides on the article page.
  // Generated once when contentStatus flips to "complete" and refreshed
  // when enrichment materially changes the guide.
  career_guide_embeddings: defineTable({
    guideId: v.id("career_guides"),
    wholeVector: v.array(v.float64()),
    arcVector: v.array(v.float64()),
    currentStateVector: v.array(v.float64()),
    domainVector: v.array(v.float64()),
    dimensions: v.number(),
    model: v.string(),
    generatedAt: v.number(),
  })
    .index("by_guideId", ["guideId"])
    .vectorIndex("by_whole", {
      vectorField: "wholeVector",
      dimensions: 1536,
    })
    .vectorIndex("by_arc", {
      vectorField: "arcVector",
      dimensions: 1536,
    })
    .vectorIndex("by_currentState", {
      vectorField: "currentStateVector",
      dimensions: 1536,
    })
    .vectorIndex("by_domain", {
      vectorField: "domainVector",
      dimensions: 1536,
    }),

  // "Go Deeper" branches: per-section follow-up questions a reader clicks
  // to expand a passage with new prose (and optionally fresh Exa-grounded
  // citations). Branches are deduped per (guideId, questionNormalized) so
  // the same question never re-runs.
  career_guide_branches: defineTable({
    guideId: v.id("career_guides"),
    sectionId: v.string(),
    question: v.string(),
    questionNormalized: v.string(),
    status: v.union(
      v.literal("generating"),
      v.literal("researching"),
      v.literal("complete"),
      v.literal("failed"),
    ),
    // "exa" for fact-heavy sections (outlook, learning paths, risks) —
    // we run an Exa grounded query first. "inherited" reuses the parent
    // guide's section prose + citations without new retrieval.
    groundingMode: v.union(v.literal("exa"), v.literal("inherited")),
    answer: v.optional(
      v.object({
        title: v.string(),
        body: v.string(),
      }),
    ),
    citations: v.optional(
      v.array(
        v.object({
          url: v.string(),
          title: v.string(),
          publisher: v.optional(v.string()),
          fetchedAt: v.number(),
        }),
      ),
    ),
    error: v.optional(v.string()),
    flagged: v.optional(v.boolean()),
    createdAt: v.number(),
  })
    .index("by_guide_question", ["guideId", "questionNormalized"])
    .index("by_guide_section", ["guideId", "sectionId"])
    .index("by_guide_status_created", ["guideId", "status", "createdAt"]),

  // Per-(user, guide) personalization. Generated lazily when an authed user
  // with a ready profile views a guide. The fit narrative + 3-bucket skills
  // assessment land on the guide page above the generic article. Stamp fields
  // let the trigger detect when the user's profile/enrichment has moved on
  // since this row was generated, in which case we regenerate.
  career_guide_personalizations: defineTable({
    userId: v.id("users"),
    guideId: v.id("career_guides"),
    status: v.union(
      v.literal("generating"),
      v.literal("complete"),
      v.literal("failed"),
    ),
    content: v.optional(
      v.object({
        whyYoureAFit: v.string(),
        skillsAssessment: v.object({
          strengths: v.array(v.string()),
          transferable: v.array(v.string()),
          gaps: v.array(v.string()),
          summary: v.string(),
        }),
        // Per-user regional content. Generated only when the user's country
        // is neither US nor UK (those reuse the existing public regional
        // blocks). Null/undefined when not generated. The country code is
        // the discriminator — currencySymbol drives the salary band.
        regional: v.optional(
          v.union(
            v.null(),
            v.object({
              countryCode: v.string(),
              countryName: v.string(),
              currencySymbol: v.string(),
              salary: v.object({
                entry: v.string(),
                mid: v.string(),
                senior: v.string(),
                note: v.optional(v.union(v.string(), v.null())),
              }),
              careerOutlook: v.string(),
              learningPath: v.array(v.string()),
              relatedRoles: v.array(v.string()),
              // Citations from Exa fan-out used to ground salary, outlook,
              // and learning-path content. Empty when no Exa fan-out ran
              // (legacy rows + future US/UK paths).
              citations: v.optional(
                v.array(
                  v.object({
                    url: v.string(),
                    title: v.string(),
                    publisher: v.optional(v.string()),
                    fetchedAt: v.number(),
                  }),
                ),
              ),
            }),
          ),
        ),
      }),
    ),
    // Snapshot of profile_enrichments.enrichedAt at generation time. The
    // trigger compares this against the live enrichment row; a newer
    // enrichedAt forces a regenerate.
    enrichmentEnrichedAtStamp: v.optional(v.number()),
    locationAtGeneration: v.optional(v.string()),
    startedAt: v.optional(v.number()),
    generatedAt: v.optional(v.number()),
    attempts: v.number(),
    // Monotonic counter bumped by every `trigger` mutation that schedules a
    // new generate. The action carries the token through and `_writeResult`
    // refuses to write unless the token matches the row's current value.
    // This guarantees that when multiple generates race, only the latest
    // one's output lands — no flash/disappear/reappear of stale content.
    generationToken: v.optional(v.number()),
    lastError: v.optional(v.string()),
  })
    .index("by_user_and_guide", ["userId", "guideId"])
    .index("by_userId", ["userId"]),

  career_validations: defineTable({
    careerNormalized: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("valid"),
      v.literal("invalid"),
    ),
    normalizedTitle: v.optional(v.string()),
    slug: v.optional(v.string()),
    reason: v.optional(v.string()),
    clientIp: v.string(),
    createdAt: v.number(),
  })
    .index("by_career_normalized", ["careerNormalized"])
    .index("by_clientIp", ["clientIp"]),

  rate_limits: defineTable({
    key: v.string(),
    count: v.number(),
    windowStartMs: v.number(),
  }).index("by_key", ["key"]),

  // Geographic locations (countries, provinces, cities, neighborhoods, etc.)
  // sourced from a Google Ads geo-target dump. Imported once via
  // `npx convex import --table locations`. The future public locations API
  // will filter to targetType === "City" for profile location autocomplete.
  locations: defineTable({
    externalId: v.string(),
    googleId: v.number(),
    googleParentId: v.optional(v.number()),
    name: v.string(),
    canonicalName: v.string(),
    countryCode: v.string(),
    targetType: v.union(
      v.literal("Airport"),
      v.literal("Autonomous Community"),
      v.literal("Barrio"),
      v.literal("Borough"),
      v.literal("Canton"),
      v.literal("City"),
      v.literal("City Region"),
      v.literal("Congressional District"),
      v.literal("Country"),
      v.literal("County"),
      v.literal("DMA Region"),
      v.literal("Department"),
      v.literal("District"),
      v.literal("Governorate"),
      v.literal("Municipality"),
      v.literal("Municipality District"),
      v.literal("National Park"),
      v.literal("Neighborhood"),
      v.literal("Okrug"),
      v.literal("Postal Code"),
      v.literal("Prefecture"),
      v.literal("Province"),
      v.literal("Quarter"),
      v.literal("Region"),
      v.literal("State"),
      v.literal("Sub-District"),
      v.literal("Sub-Ward"),
      v.literal("TV Region"),
      v.literal("Territory"),
      v.literal("Union Territory"),
      v.literal("University"),
    ),
    reach: v.number(),
    gps: v.object({ lat: v.number(), lon: v.number() }),
    // Lowercased `name`, used by the typeahead search to do prefix range
    // queries via `by_target_nameLower`. Convex full-text search ranks by
    // BM25 only and has no popularity signal, so for ambiguous 3-char
    // prefixes (Par, Ber, Mad) it doesn't surface the canonical big city.
    // The range index lets us pull every prefix-matching row cheaply, then
    // sort by `reach` desc in code.
    nameLower: v.optional(v.string()),
  })
    .index("by_external_id", ["externalId"])
    .index("by_google_id", ["googleId"])
    .index("by_country_target", ["countryCode", "targetType"])
    .index("by_target_reach", ["targetType", "reach"])
    .index("by_target_nameLower", ["targetType", "nameLower"])
    .searchIndex("search_name", {
      searchField: "name",
      filterFields: ["targetType", "countryCode"],
    }),

  // ── People search & outreach (per career guide, per user) ─────────────
  // Populated when a logged-in reader of /career-guides/[slug] clicks
  // "Find people in this field". Search action queries Exa for LinkedIn
  // profiles, parses them with a fast model, optionally reranks against the
  // user's profile summary, and stores the row here. Dedup is per-user by
  // linkedinUrl so re-running on a different guide that surfaces the same
  // person does not create duplicates.
  key_people: defineTable({
    guideId: v.id("career_guides"),
    userId: v.id("users"),
    name: v.string(),
    headline: v.string(),
    linkedinUrl: v.string(),
    imageUrl: v.optional(v.string()),
    profileSummary: v.string(),
    currentRole: v.string(),
    currentCompany: v.string(),
    relevanceReason: v.string(),
    searchQuery: v.string(),
    costCents: v.number(),
    createdAt: v.number(),
  })
    .index("by_guide_user_created", ["guideId", "userId", "createdAt"])
    .index("by_user_url", ["userId", "linkedinUrl"]),

  // Tracks an in-flight search per (guide, user) so the UI can render a
  // skeleton without polling the action scheduler. The trigger mutation
  // inserts a row with status="running"; the action flips it to "complete"
  // or "failed" at the end.
  key_people_runs: defineTable({
    guideId: v.id("career_guides"),
    userId: v.id("users"),
    status: v.union(
      v.literal("running"),
      v.literal("complete"),
      v.literal("failed"),
    ),
    error: v.optional(v.string()),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
  }).index("by_guide_user", ["guideId", "userId"]),

  // Each row tracks one outreach draft generation. The Convex Agent
  // component owns the streamed message chunks (subscribed to via
  // `useStreamingUIMessages` on the `threadId`); this row carries the
  // status, the persisted final text (so revisits can render the draft
  // without re-streaming), and the metadata needed to dedupe by
  // (personId, userId, type).
  outreach_streams: defineTable({
    threadId: v.string(),
    userId: v.id("users"),
    personId: v.id("key_people"),
    outreachType: v.string(),
    customIntent: v.optional(v.string()),
    status: v.union(
      v.literal("streaming"),
      v.literal("done"),
      v.literal("error"),
    ),
    error: v.optional(v.string()),
    finalMessage: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_threadId", ["threadId"])
    .index("by_person_user_created", ["personId", "userId", "createdAt"]),

  discover_canvases: defineTable({
    userId: v.id("users"),
    profileId: v.id("profiles"),
    profileEmbeddingId: v.id("profile_embeddings"),
    generatedAt: v.number(),
    status: v.union(
      v.literal("generating"),
      v.literal("ready"),
      v.literal("failed"),
    ),
    lanes: v.array(
      v.object({
        kind: v.union(
          v.literal("linear"),
          v.literal("adjacent"),
          v.literal("transformational"),
        ),
        cards: v.array(
          v.object({
            guideId: v.id("career_guides"),
            slotKind: v.union(
              v.literal("strong"),
              v.literal("bridge"),
              v.literal("aspirational"),
              v.literal("extra"),
            ),
            arcScore: v.number(),
            currentStateScore: v.number(),
            domainScore: v.number(),
            wholeScore: v.number(),
            whyMatchReason: v.string(),
          }),
        ),
      }),
    ),
    failureReason: v.optional(v.string()),
    attempts: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_status", ["status"]),

  discover_snapshot_guides: defineTable({
    snapshotId: v.id("discover_canvases"),
    userId: v.id("users"),
    guideId: v.id("career_guides"),
  })
    .index("by_guideId", ["guideId"])
    .index("by_snapshotId", ["snapshotId"]),

  discover_reactions: defineTable({
    userId: v.id("users"),
    guideId: v.id("career_guides"),
    reaction: v.union(v.literal("saved"), v.literal("dismissed")),
    reactedAt: v.number(),
  })
    .index("by_user_and_guide", ["userId", "guideId"])
    .index("by_user_and_reaction", ["userId", "reaction"]),

  discover_match_reasons: defineTable({
    userId: v.id("users"),
    guideId: v.id("career_guides"),
    profileEmbeddingId: v.id("profile_embeddings"),
    reason: v.string(),
    generatedAt: v.number(),
  })
    .index("by_user_and_guide", ["userId", "guideId"]),
});
