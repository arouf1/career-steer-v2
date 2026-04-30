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
        dayToDay: v.string(),
        riskFactors: v.array(v.string()),
        whyConsider: v.string(),
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
  })
    .index("by_slug", ["slug"])
    .index("by_title_normalized", ["titleNormalized"])
    .index("by_content_status", ["contentStatus"])
    .index("by_created", ["createdAt"])
    .searchIndex("search_title", { searchField: "title" }),

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
});
