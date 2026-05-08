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
    sourceFormat: v.union(
      v.literal("pdf"),
      v.literal("docx"),
      v.literal("linkedin"),
    ),
    rawText: v.string(),
    parsedAt: v.number(),
    reviewed: v.boolean(),
    rateLimit: v.object({
      countInWindow: v.number(),
      windowStartedAt: v.number(),
    }),
    // Set only for sourceFormat === "linkedin" — captures the URL that was
    // scraped so we can show provenance and (later) build a re-sync feature
    // without a schema migration.
    linkedinUrl: v.optional(v.string()),
    name: v.optional(v.union(v.string(), v.null())),
    headline: v.optional(v.union(v.string(), v.null())),
    summary: v.optional(v.union(v.string(), v.null())),
    location: v.optional(v.union(v.string(), v.null())),
    // Set when the user confirms their location in the post-intake step.
    // Undefined means the user hasn't completed step 2 yet — the profile
    // page renders LocationStep (gate) instead of the full ProfileView.
    // Required for trustworthy regional personalization downstream.
    locationConfirmedAt: v.optional(v.number()),
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

    // Set when seedGuidesFromProfile finishes for this profile. Combined
    // with guidesSeedChecksum, gates re-seeding on subsequent markReviewed
    // calls — same canonical-title set → no-op.
    guidesSeededAt: v.optional(v.number()),
    guidesSeedChecksum: v.optional(v.string()),
    // Slugs returned by _requestGenerationForSeeding for this profile's
    // most recent seeding pass. Used for audit + future Discover follow-up.
    seedingGuideSlugs: v.optional(v.array(v.string())),
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
        // Typical career stage this guide describes. Mirrors the
        // `profile_enrichments.careerStage` vocabulary (minus "transitioning"
        // — guides describe destinations, not transitions). Drives the
        // discover canvas's 4-lane bucketing: comparing user stage vs guide
        // stage assigns a candidate to next-step / sideways / earlier-chapter
        // lanes (anything missing falls through to "a different chapter").
        // Optional so legacy guides remain valid until backfilled by
        // `triggerCareerStageBackfill`.
        typicalCareerStage: v.optional(
          v.union(
            v.literal("early-career"),
            v.literal("mid-career"),
            v.literal("senior-IC"),
            v.literal("manager"),
            v.literal("director"),
            v.literal("exec"),
          ),
        ),
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
        // Career-aware persona traits derived from the guide's content before
        // the script is written. Drives the script prompt's "how this guest
        // sounds" block, the TTS speaker prompt's per-guest tone direction,
        // and the voice picker's weighted bias. Optional so legacy rows
        // (pre-this-field) and Stage A failures both remain valid; the
        // downstream prompts fall through to their generic defaults.
        personaTraits: v.optional(
          v.object({
            archetypeLabel: v.string(),
            functionalAreaInferred: v.string(),
            traitPrior: v.object({
              extraversion: v.number(),
              conscientiousness: v.number(),
              openness: v.number(),
              warmth: v.number(),
              formality: v.number(),
            }),
            speakingStyle: v.object({
              energy: v.union(
                v.literal("measured"),
                v.literal("animated"),
                v.literal("reserved"),
                v.literal("expressive"),
              ),
              vocabulary: v.union(
                v.literal("precise-technical"),
                v.literal("accessible-plain"),
                v.literal("industry-jargon"),
                v.literal("casual-conversational"),
              ),
              sentenceLength: v.union(
                v.literal("short"),
                v.literal("medium"),
                v.literal("flowing"),
              ),
              humorFrequency: v.union(
                v.literal("rare"),
                v.literal("occasional"),
                v.literal("frequent"),
              ),
              anecdoteStyle: v.union(
                v.literal("data-grounded"),
                v.literal("human-stories"),
                v.literal("process-oriented"),
                v.literal("metaphor-heavy"),
              ),
            }),
            toneDirection: v.string(),
          }),
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
        // Each bucket is { skill, why }-shaped. v.union with the legacy
        // string[] shape keeps pre-2026-05 rows readable; the trigger detects
        // legacy rows and forces a regen so the union can be tightened later.
        skillsAssessment: v.object({
          strengths: v.union(
            v.array(v.string()),
            v.array(v.object({ skill: v.string(), why: v.string() })),
          ),
          transferable: v.union(
            v.array(v.string()),
            v.array(v.object({ skill: v.string(), why: v.string() })),
          ),
          gaps: v.union(
            v.array(v.string()),
            v.array(v.object({ skill: v.string(), why: v.string() })),
          ),
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
  })
    .index("by_guide_user", ["guideId", "userId"])
    .index("by_userId", ["userId"]),

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
    .index("by_person_user_created", ["personId", "userId", "createdAt"])
    .index("by_userId", ["userId"]),

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
          v.literal("earlier"),
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

  // Cache for the LLM canonicalizer (convex/titleCanonicalization.ts).
  // Keyed by the deterministic prefilter output (expandTitleAbbreviations).
  // Same prefilter input → same row forever, so canonicalization is
  // deterministic-after-first-call and the LLM is consulted at most once
  // per unique prefiltered key across the entire user base.
  title_canonicalizations: defineTable({
    prefilteredKey: v.string(),
    sourceTitle: v.string(),
    canonicalTitle: v.string(),
    model: v.string(),
    confidence: v.number(),
    createdAt: v.number(),
  }).index("by_prefiltered_key", ["prefilteredKey"]),

  // Realtime AI voice "deep dive" calls. Each row is one user-driven call
  // session; the live transport is browser↔Gemini Live (WebSocket), so we
  // only persist the transcript + metadata, never raw audio. After
  // end-of-call, internal.voiceCallsNode.processCallAnalysis fills aiSummary
  // and the three embeddings asynchronously.
  //
  // Three surfaces share this table: per-guide deep-dive (modal on the
  // article page), per-canvas compass voice (ambient dock on /workspace/
  // career-compass), and per-posting job voice (modal on /jobs/listing/...).
  // `surface` discriminates; `guideId`, `canvasSnapshotId`, and
  // `jobPostingId` are mutually exclusive — exactly one is set per row.
  voice_calls: defineTable({
    userId: v.id("users"),
    // Discriminator. Optional only because legacy rows (created before the
    // compass surface shipped) lack it; readers should treat undefined as
    // "guide". A future narrow PR can flip this to required after a backfill.
    surface: v.optional(
      v.union(
        v.literal("guide"),
        v.literal("compass"),
        v.literal("job"),
        v.literal("interview_job"),
      ),
    ),
    // Set when surface === "guide". Optional so non-guide calls can omit it
    // while keeping the by_guide index narrow (other surfaces simply don't
    // index here).
    guideId: v.optional(v.id("career_guides")),
    // Set when surface === "compass". Stamps the exact `discover_canvases`
    // row the user was looking at when the call started, so the post-call
    // summary can reference "the canvas you saw on May 4". The canvas itself
    // may be regenerated later — this preserves the conversational anchor.
    canvasSnapshotId: v.optional(v.id("discover_canvases")),
    // Set when surface === "job". The posting itself is reasonably stable
    // (content rewrite is one-shot per posting) so this is a direct FK
    // rather than a snapshot id.
    jobPostingId: v.optional(v.id("job_postings")),
    // Client-generated UUID — opaque correlator for the live session, distinct
    // from Convex's _id so the client can reference the row before the round
    // trip resolves.
    sessionId: v.string(),
    title: v.string(),
    voiceProvider: v.literal("gemini"),
    // Gemini Live prebuilt voice name (e.g. "Aoede"). Stored so post-hoc
    // playback / debugging can reproduce timbre.
    voiceId: v.string(),
    // Resolved Live model ID at session-start time (Live family iterates fast;
    // capturing it lets us reason about behaviour drift across model
    // generations).
    model: v.string(),
    authMode: v.union(v.literal("ephemeral"), v.literal("apiKey")),
    status: v.union(
      v.literal("active"),
      v.literal("completed"),
      v.literal("interrupted"),
      v.literal("error"),
    ),
    messages: v.array(
      v.object({
        id: v.string(),
        role: v.union(v.literal("user"), v.literal("assistant")),
        content: v.string(),
        timestamp: v.number(),
        transcriptConfidence: v.optional(v.number()),
        groundingCitations: v.optional(
          v.array(v.object({
            url: v.string(),
            title: v.optional(v.string()),
          })),
        ),
      }),
    ),
    totalDurationSeconds: v.number(),
    // Structured post-call summary (shape lives in lib/ai/prompts/voiceAdviser
    // — DeepDiveSummarySchema). v.any() because it's read-only data and the
    // schema is owned by the prompt module rather than Convex.
    aiSummary: v.optional(v.any()),
    // Three semantic vectors over the call: full conversation, structured
    // summary, and joined key topics. 1536-dim Gemini embeddings via OpenRouter
    // — same model + dim as career_guide_embeddings so future Discover
    // integrations can reason across both.
    conversationEmbedding: v.optional(v.array(v.float64())),
    summaryEmbedding: v.optional(v.array(v.float64())),
    keyTopicsEmbedding: v.optional(v.array(v.float64())),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_created", ["userId", "createdAt"])
    .index("by_guide", ["guideId"])
    .index("by_jobPosting", ["jobPostingId"])
    .index("by_session", ["sessionId"])
    .index("by_status", ["status"]),

  // ── Job postings cache ─────────────────────────────────────────────────
  // Foundation tables for the SearchAPI Google Jobs cache. Sub-project 1
  // of the jobs-feature decomposition (see openapi-3-0-0-info-title-starry-
  // dragon plan). Independent of profiles / career-guides / matching;
  // optionally cross-references career_guides.slug via roleArchetypeSlug.

  // One row per canonical company. Identity = nameNormalized (legal-suffix
  // stripped, lowercased). New observations of the same company patch
  // lastSeenAt; the original nameRaw is preserved for display.
  companies: defineTable({
    nameRaw: v.string(),
    nameNormalized: v.string(),
    slug: v.string(),
    firstSeenAt: v.number(),
    lastSeenAt: v.number(),
    // Filled by sub-project 5 (company research). Optional now.
    domain: v.optional(v.string()),
    logoStorageId: v.optional(v.id("_storage")),
    // Sub-project 4: Brandfetch-sourced metadata. logoUrl is a CDN URL
    // (stable, no proxying needed); brandColor is the dominant brand colour
    // when Brandfetch has it. Both nullable for "we tried but Brandfetch
    // didn't recognise the company" so we don't keep retrying.
    logoUrl: v.optional(v.union(v.string(), v.null())),
    brandColor: v.optional(v.union(v.string(), v.null())),
    brandEnrichedAt: v.optional(v.number()),
  })
    .index("by_nameNormalized", ["nameNormalized"])
    .index("by_slug", ["slug"]),

  // One row per real-world job, deduped on dedupKey
  // = sha256(normalize(title)::normalize(company)::extractCity(location)).
  // Same role at same company in same city collapses to one row regardless
  // of which board surfaced it.
  job_postings: defineTable({
    // Dedup identity
    dedupKey: v.string(),
    // FK
    companyId: v.id("companies"),
    // Raw fields from SearchAPI (preserved for re-rewriting and audit)
    title: v.string(),
    titleSlug: v.string(),
    city: v.string(),
    citySlug: v.string(),
    countryCode: v.optional(v.string()),
    location: v.string(),
    via: v.optional(v.string()),
    rawDescription: v.string(),
    applyLink: v.optional(v.string()),
    applyLinkSource: v.optional(v.string()),
    sharingLink: v.optional(v.string()),
    thumbnail: v.optional(v.string()),
    detectedExtensions: v.optional(
      v.object({
        schedule: v.optional(v.string()),
        postedAt: v.optional(v.string()),
        salary: v.optional(v.string()),
        workFromHome: v.optional(v.boolean()),
        healthInsurance: v.optional(v.boolean()),
        dentalInsurance: v.optional(v.boolean()),
        paidTimeOff: v.optional(v.boolean()),
      }),
    ),
    // Provenance
    firstSeenAt: v.number(),
    lastSeenAt: v.number(),
    seenCount: v.number(),
    // Last N unique queries that surfaced this posting (capped to 20).
    // Powers cache-hit lookups + future analytics.
    searchQueries: v.array(v.string()),
    // Lifecycle
    isActive: v.boolean(),
    archivedAt: v.optional(v.number()),
    archivedReason: v.optional(v.string()),
    // Sub-project 6 fields (cron sweep). Indexed for "oldest first".
    lastChecked: v.optional(v.number()),
    failedCheckCount: v.optional(v.number()),
    // Enrichment status (sub-project 2 wires _rewriteContent to drain pending).
    contentStatus: v.union(
      v.literal("pending"),
      v.literal("generating"),
      v.literal("complete"),
      v.literal("failed"),
    ),
    contentLastError: v.optional(v.string()),
    contentLastFailureAt: v.optional(v.number()),
    contentAttempts: v.optional(v.number()),
    // Sub-project 2: LLM-rewritten posting in our voice. Optional until the
    // _rewriteContent action drains it from "pending". Each section's word
    // budget is enforced by the prompt, not by Zod (Gemini structured output
    // rejects bounded constraints).
    content: v.optional(
      v.object({
        overview: v.string(),
        theRole: v.string(),
        whatStandsOut: v.array(v.string()),
        idealCandidate: v.string(),
        // null when no salary information is available in the source posting.
        // Renderers should hide the section in that case.
        compSummary: v.union(v.string(), v.null()),
        // SEO meta. Title kept short for SERP truncation safety; description
        // sized for the standard 150-160 char snippet budget.
        metaTitle: v.string(),
        metaDescription: v.string(),
        socialAlt: v.string(),
      }),
    ),
    // Optional cost tracker for the rewrite call. Lets us spot-check spend
    // per posting and per cohort without scraping logs.
    contentCostCents: v.optional(v.number()),
    // Synchronously resolved at upsert from cached title_canonicalizations.
    // null means we'll resolve later via _resolveArchetype (LLM-canonicalize
    // → guide lookup, fired on first /jobs/listing/... view per posting).
    roleArchetypeSlug: v.optional(v.union(v.string(), v.null())),
    // Set the moment _resolveArchetype completes a slug-resolution attempt,
    // regardless of outcome. Distinguishes "we haven't tried yet" (undefined)
    // from "tried, no matching career_guide for this canonical title" (set
    // with roleArchetypeSlug still null). The detail page hides the role-
    // overlay research cards once this is set without a slug — honest
    // absence beats showing "Researching…" forever.
    roleArchetypeResolvedAt: v.optional(v.number()),
    // Sub-project 4: hero image lazy-generated on first /jobs/listing view.
    // illustrationStatus undefined → never started; "generating" → action in
    // flight; "complete" → storage id is populated; "failed" → an error,
    // page renders the gradient placeholder.
    illustrationStorageId: v.optional(v.id("_storage")),
    illustrationStatus: v.optional(
      v.union(
        v.literal("generating"),
        v.literal("complete"),
        v.literal("failed"),
      ),
    ),
    illustrationLastError: v.optional(v.string()),
    illustrationCostCents: v.optional(v.number()),
    // Denormalised geo coordinates for the posting's city. Sourced from the
    // `locations` table at upsert time (see jobPostings.upsertFromSearch).
    // Optional during the widen phase of the migration; tightens to required
    // once backfill coverage stabilises. Powers the Haversine ranking in
    // convex/jobsForGuide.forGuide without a per-read join against locations.
    gps: v.optional(v.object({ lat: v.number(), lon: v.number() })),
  })
    .index("by_dedupKey", ["dedupKey"])
    .index("by_companyId", ["companyId"])
    .index("by_isActive_lastSeenAt", ["isActive", "lastSeenAt"])
    .index("by_lastChecked", ["lastChecked"])
    .index("by_contentStatus_firstSeenAt", ["contentStatus", "firstSeenAt"])
    .index("by_roleArchetypeSlug_isActive_lastSeenAt", [
      "roleArchetypeSlug",
      "isActive",
      "lastSeenAt",
    ]),

  // ── Job-search query typo cache ───────────────────────────────────────
  // Layer-1 dedup for the typo-correction Flash call. Mirrors the
  // title_canonicalizations pattern: lookup by inputNormalized; on miss the
  // action calls Flash and write-throughs the result. Result rows live
  // forever — corrections don't go stale and cache hits are free.
  query_corrections: defineTable({
    inputNormalized: v.string(),  // lowercased + whitespace-collapsed input
    corrected: v.string(),         // what Flash returned (may equal input)
    hadTypo: v.boolean(),
    confidence: v.number(),        // 0..1, from Flash
    model: v.string(),
    createdAt: v.number(),
  }).index("by_inputNormalized", ["inputNormalized"]),

  // ── Google Indexing API queue (sub-project 6) ─────────────────────────
  // Google's Indexing API caps at 200 publish requests per day. We enqueue
  // every URL_UPDATED / URL_DELETED event here and drain via an hourly cron
  // at 8 items/tick (192/day, 8/day headroom for ad-hoc operations). Items
  // above the daily quota stay queued for the next day.
  google_indexing_queue: defineTable({
    url: v.string(),                    // fully-qualified, e.g. https://career-steer.app/jobs/listing/...
    kind: v.union(
      v.literal("URL_UPDATED"),
      v.literal("URL_DELETED"),
    ),
    status: v.union(
      v.literal("pending"),
      v.literal("sent"),
      v.literal("failed"),
    ),
    queuedAt: v.number(),
    sentAt: v.optional(v.number()),
    attempts: v.optional(v.number()),
    lastError: v.optional(v.string()),
  })
    .index("by_status_queuedAt", ["status", "queuedAt"])
    // Used by enqueue to dedup pending entries for the same URL+kind.
    .index("by_url_kind_status", ["url", "kind", "status"]),

  // ── Company research (sub-project 5) ──────────────────────────────────
  // Per-company research bundle: culture + financials. One row per company.
  // Lazy-generated on first /jobs/listing view; refreshed every 90 days.
  // citations is the V2 mirror of career_guides.citations — keyed by field
  // path so the page can hang per-field source links off each section.
  company_research: defineTable({
    companyId: v.id("companies"),
    status: v.union(
      v.literal("pending"),
      v.literal("generating"),
      v.literal("complete"),
      v.literal("failed"),
    ),
    attempts: v.optional(v.number()),
    lastFailureAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    lastResearchedAt: v.optional(v.number()),
    costCents: v.optional(v.number()),
    culture: v.optional(v.string()),
    financials: v.optional(v.string()),
    citations: v.optional(
      v.record(
        v.string(), // field key: "culture" | "financials"
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
    recentNews: v.optional(v.object({
      bullets: v.array(v.object({
        headline: v.string(),
        summary: v.string(),
        sourceUrl: v.string(),
        publisher: v.optional(v.string()),
        publishedAt: v.optional(v.number()),
      })),
      fetchedAt: v.number(),
    })),
  })
    .index("by_companyId", ["companyId"])
    .index("by_status", ["status"]),

  // Per-(company, role-archetype) research overlay: interview process + comp
  // specifics for THIS role at THIS company. Generic facts come from the
  // matching career_guide via job_postings.roleArchetypeSlug, so this table
  // only captures what's company-specific.
  company_role_research: defineTable({
    companyId: v.id("companies"),
    roleArchetypeSlug: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("generating"),
      v.literal("complete"),
      v.literal("failed"),
    ),
    attempts: v.optional(v.number()),
    lastFailureAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    lastResearchedAt: v.optional(v.number()),
    costCents: v.optional(v.number()),
    interview: v.optional(v.string()),
    interviewBundle: v.optional(v.object({
      rounds: v.array(v.object({
        name: v.string(),
        durationMinutes: v.optional(v.number()),
        focus: v.string(),
        interviewerArchetype: v.string(),
      })),
      signatureQuestions: v.array(v.object({
        question: v.string(),
        rationale: v.string(),
      })),
      rubric: v.object({
        rigor: v.number(),
        rigorRationale: v.string(),
        interviewerArchetype: v.string(),
        dimensions: v.array(v.object({
          key: v.string(),
          anchorBelow: v.string(),
          anchorAt: v.string(),
          anchorAbove: v.string(),
        })),
      }),
      prestigeSignals: v.object({
        employeeBand: v.optional(v.string()),
        fundingOrPublic: v.optional(v.string()),
        brandMentions: v.optional(v.number()),
        glassdoorDifficulty: v.optional(v.number()),
      }),
      generatedAt: v.number(),
      modelUsed: v.string(),
    })),
    compensation: v.optional(v.string()),
    citations: v.optional(
      v.record(
        v.string(), // field key: "interview" | "compensation"
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
  })
    .index("by_companyId_archetype", ["companyId", "roleArchetypeSlug"])
    .index("by_status", ["status"]),

  // ── Job-posting facet embeddings ──────────────────────────────────────
  // Same 4-facet shape as career_guide_embeddings + profile_embeddings, so
  // job vectors are directly comparable to profile vectors via the existing
  // matching primitives (currentState↔currentState for "matches what I do",
  // arc↔arc for "matches where I'm headed", domain↔domain for skill overlap).
  // wholeVector also powers job↔job related-jobs on the detail page.
  // Generated once when contentStatus flips to "complete"; no auto-refresh
  // because content is one-shot per posting.
  job_posting_embeddings: defineTable({
    jobPostingId: v.id("job_postings"),
    wholeVector: v.array(v.float64()),
    arcVector: v.array(v.float64()),
    currentStateVector: v.array(v.float64()),
    domainVector: v.array(v.float64()),
    dimensions: v.number(),
    model: v.string(),
    generatedAt: v.number(),
  })
    .index("by_jobPostingId", ["jobPostingId"])
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

  // Lightweight mirror of job_postings — dual-written on every patch.
  // Carries only the fields hot-path queries need (sitemap, listings, admin).
  // Avoids the 16MB tx byte limit when job_postings eventually carries
  // embeddings + content + research blobs. Mirrors V1's jobsLivenessIndex
  // pattern. ~1KB/row vs. eventual ~30KB on the main table.
  job_postings_index: defineTable({
    jobPostingId: v.id("job_postings"),
    dedupKey: v.string(),
    companyId: v.id("companies"),
    companyName: v.string(),
    companySlug: v.string(),
    title: v.string(),
    titleSlug: v.string(),
    city: v.string(),
    citySlug: v.string(),
    isActive: v.boolean(),
    firstSeenAt: v.number(),
    lastSeenAt: v.number(),
    contentStatus: v.string(),
  })
    .index("by_jobPostingId", ["jobPostingId"])
    .index("by_isActive_lastSeenAt", ["isActive", "lastSeenAt"])
    .index("by_companyId", ["companyId"]),

  // Per-user bookmark of a job posting. The (userId, jobPostingId) pair is
  // unique by convention — enforced at write time in convex/savedJobs.ts via
  // a by_userId_jobPostingId lookup before insert. Reads on the workspace
  // jobs page hit by_userId_savedAt for the listing and by_userId_jobPostingId
  // for the per-card "is saved?" check.
  saved_jobs: defineTable({
    userId: v.id("users"),
    jobPostingId: v.id("job_postings"),
    savedAt: v.number(),
    note: v.optional(v.string()),
  })
    .index("by_userId_savedAt", ["userId", "savedAt"])
    .index("by_userId_jobPostingId", ["userId", "jobPostingId"]),

  // Per-query SearchAPI cache marker. One row per distinct
  // (queryNormalized, citySlug, countryCode) tuple records the timestamp of
  // the last successful SearchAPI run. The action consults this BEFORE the
  // searchCache fan-out so a duplicate search inside the freshness window
  // skips SearchAPI entirely — even if the original run returned fewer than
  // the searchCache threshold. Empty strings are used in place of null for
  // citySlug / countryCode so the index keys stay total. Without this table
  // the cache only kicks in once a query has accumulated ≥N postings, which
  // burned paid credits on niche / first-time queries.
  search_runs: defineTable({
    queryNormalized: v.string(),
    citySlug: v.string(),
    countryCode: v.string(),
    lastRunAt: v.number(),
    resultCount: v.number(),
  }).index("by_query_city_country", [
    "queryNormalized",
    "citySlug",
    "countryCode",
  ]),
});
