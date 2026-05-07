/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as careerGuidePersonalizations from "../careerGuidePersonalizations.js";
import type * as careerGuides from "../careerGuides.js";
import type * as careerPaths from "../careerPaths.js";
import type * as catalogEmail from "../catalogEmail.js";
import type * as catalogExpansion from "../catalogExpansion.js";
import type * as companies from "../companies.js";
import type * as companyResearch from "../companyResearch.js";
import type * as compassVoice from "../compassVoice.js";
import type * as compassVoiceContext from "../compassVoiceContext.js";
import type * as compassVoiceNode from "../compassVoiceNode.js";
import type * as crons from "../crons.js";
import type * as discover from "../discover.js";
import type * as embeddings from "../embeddings.js";
import type * as enrichments from "../enrichments.js";
import type * as googleIndexingQueue from "../googleIndexingQueue.js";
import type * as guideBranches from "../guideBranches.js";
import type * as guideEmbeddings from "../guideEmbeddings.js";
import type * as http from "../http.js";
import type * as jobPostingEmbeddings from "../jobPostingEmbeddings.js";
import type * as jobPostings from "../jobPostings.js";
import type * as jobPostingsContent from "../jobPostingsContent.js";
import type * as jobPostingsImage from "../jobPostingsImage.js";
import type * as jobSearch from "../jobSearch.js";
import type * as jobVoice from "../jobVoice.js";
import type * as jobVoiceContext from "../jobVoiceContext.js";
import type * as jobVoiceNode from "../jobVoiceNode.js";
import type * as jobsForGuide from "../jobsForGuide.js";
import type * as jobsLifecycle from "../jobsLifecycle.js";
import type * as lib_dedup from "../lib/dedup.js";
import type * as lib_discoverScoring from "../lib/discoverScoring.js";
import type * as lib_discoverThresholds from "../lib/discoverThresholds.js";
import type * as lib_env from "../lib/env.js";
import type * as lib_haversine from "../lib/haversine.js";
import type * as lib_imagePrompts from "../lib/imagePrompts.js";
import type * as lib_imageReference from "../lib/imageReference.js";
import type * as lib_jobFit from "../lib/jobFit.js";
import type * as lib_jobImagePrompts from "../lib/jobImagePrompts.js";
import type * as lib_locationLadder from "../lib/locationLadder.js";
import type * as lib_normalize from "../lib/normalize.js";
import type * as lib_rateLimit from "../lib/rateLimit.js";
import type * as lib_titleAbbreviations from "../lib/titleAbbreviations.js";
import type * as lib_voiceLiveConfig from "../lib/voiceLiveConfig.js";
import type * as locations from "../locations.js";
import type * as matching from "../matching.js";
import type * as migrations_2026_05_06_jobPostings_gps from "../migrations/2026_05_06_jobPostings_gps.js";
import type * as people from "../people.js";
import type * as peopleOutreach from "../peopleOutreach.js";
import type * as podcasts from "../podcasts.js";
import type * as podcastsTts from "../podcastsTts.js";
import type * as profileGuideSeeding from "../profileGuideSeeding.js";
import type * as profiles from "../profiles.js";
import type * as queryCorrection from "../queryCorrection.js";
import type * as savedJobs from "../savedJobs.js";
import type * as searchRuns from "../searchRuns.js";
import type * as titleCanonicalization from "../titleCanonicalization.js";
import type * as users from "../users.js";
import type * as usersAccount from "../usersAccount.js";
import type * as voiceCallContext from "../voiceCallContext.js";
import type * as voiceCalls from "../voiceCalls.js";
import type * as voiceCallsNode from "../voiceCallsNode.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  careerGuidePersonalizations: typeof careerGuidePersonalizations;
  careerGuides: typeof careerGuides;
  careerPaths: typeof careerPaths;
  catalogEmail: typeof catalogEmail;
  catalogExpansion: typeof catalogExpansion;
  companies: typeof companies;
  companyResearch: typeof companyResearch;
  compassVoice: typeof compassVoice;
  compassVoiceContext: typeof compassVoiceContext;
  compassVoiceNode: typeof compassVoiceNode;
  crons: typeof crons;
  discover: typeof discover;
  embeddings: typeof embeddings;
  enrichments: typeof enrichments;
  googleIndexingQueue: typeof googleIndexingQueue;
  guideBranches: typeof guideBranches;
  guideEmbeddings: typeof guideEmbeddings;
  http: typeof http;
  jobPostingEmbeddings: typeof jobPostingEmbeddings;
  jobPostings: typeof jobPostings;
  jobPostingsContent: typeof jobPostingsContent;
  jobPostingsImage: typeof jobPostingsImage;
  jobSearch: typeof jobSearch;
  jobVoice: typeof jobVoice;
  jobVoiceContext: typeof jobVoiceContext;
  jobVoiceNode: typeof jobVoiceNode;
  jobsForGuide: typeof jobsForGuide;
  jobsLifecycle: typeof jobsLifecycle;
  "lib/dedup": typeof lib_dedup;
  "lib/discoverScoring": typeof lib_discoverScoring;
  "lib/discoverThresholds": typeof lib_discoverThresholds;
  "lib/env": typeof lib_env;
  "lib/haversine": typeof lib_haversine;
  "lib/imagePrompts": typeof lib_imagePrompts;
  "lib/imageReference": typeof lib_imageReference;
  "lib/jobFit": typeof lib_jobFit;
  "lib/jobImagePrompts": typeof lib_jobImagePrompts;
  "lib/locationLadder": typeof lib_locationLadder;
  "lib/normalize": typeof lib_normalize;
  "lib/rateLimit": typeof lib_rateLimit;
  "lib/titleAbbreviations": typeof lib_titleAbbreviations;
  "lib/voiceLiveConfig": typeof lib_voiceLiveConfig;
  locations: typeof locations;
  matching: typeof matching;
  "migrations/2026_05_06_jobPostings_gps": typeof migrations_2026_05_06_jobPostings_gps;
  people: typeof people;
  peopleOutreach: typeof peopleOutreach;
  podcasts: typeof podcasts;
  podcastsTts: typeof podcastsTts;
  profileGuideSeeding: typeof profileGuideSeeding;
  profiles: typeof profiles;
  queryCorrection: typeof queryCorrection;
  savedJobs: typeof savedJobs;
  searchRuns: typeof searchRuns;
  titleCanonicalization: typeof titleCanonicalization;
  users: typeof users;
  usersAccount: typeof usersAccount;
  voiceCallContext: typeof voiceCallContext;
  voiceCalls: typeof voiceCalls;
  voiceCallsNode: typeof voiceCallsNode;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  agent: import("@convex-dev/agent/_generated/component.js").ComponentApi<"agent">;
};
