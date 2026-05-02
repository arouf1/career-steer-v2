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
import type * as crons from "../crons.js";
import type * as discover from "../discover.js";
import type * as embeddings from "../embeddings.js";
import type * as enrichments from "../enrichments.js";
import type * as guideBranches from "../guideBranches.js";
import type * as guideEmbeddings from "../guideEmbeddings.js";
import type * as http from "../http.js";
import type * as lib_dedup from "../lib/dedup.js";
import type * as lib_discoverScoring from "../lib/discoverScoring.js";
import type * as lib_discoverThresholds from "../lib/discoverThresholds.js";
import type * as lib_imagePrompts from "../lib/imagePrompts.js";
import type * as lib_imageReference from "../lib/imageReference.js";
import type * as lib_normalize from "../lib/normalize.js";
import type * as lib_rateLimit from "../lib/rateLimit.js";
import type * as locations from "../locations.js";
import type * as matching from "../matching.js";
import type * as people from "../people.js";
import type * as peopleOutreach from "../peopleOutreach.js";
import type * as podcasts from "../podcasts.js";
import type * as podcastsTts from "../podcastsTts.js";
import type * as profiles from "../profiles.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  careerGuidePersonalizations: typeof careerGuidePersonalizations;
  careerGuides: typeof careerGuides;
  careerPaths: typeof careerPaths;
  crons: typeof crons;
  discover: typeof discover;
  embeddings: typeof embeddings;
  enrichments: typeof enrichments;
  guideBranches: typeof guideBranches;
  guideEmbeddings: typeof guideEmbeddings;
  http: typeof http;
  "lib/dedup": typeof lib_dedup;
  "lib/discoverScoring": typeof lib_discoverScoring;
  "lib/discoverThresholds": typeof lib_discoverThresholds;
  "lib/imagePrompts": typeof lib_imagePrompts;
  "lib/imageReference": typeof lib_imageReference;
  "lib/normalize": typeof lib_normalize;
  "lib/rateLimit": typeof lib_rateLimit;
  locations: typeof locations;
  matching: typeof matching;
  people: typeof people;
  peopleOutreach: typeof peopleOutreach;
  podcasts: typeof podcasts;
  podcastsTts: typeof podcastsTts;
  profiles: typeof profiles;
  users: typeof users;
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
