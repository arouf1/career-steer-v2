/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as careerGuides from "../careerGuides.js";
import type * as careerPaths from "../careerPaths.js";
import type * as embeddings from "../embeddings.js";
import type * as enrichments from "../enrichments.js";
import type * as http from "../http.js";
import type * as lib_dedup from "../lib/dedup.js";
import type * as lib_imagePrompts from "../lib/imagePrompts.js";
import type * as lib_imageReference from "../lib/imageReference.js";
import type * as lib_normalize from "../lib/normalize.js";
import type * as lib_rateLimit from "../lib/rateLimit.js";
import type * as matching from "../matching.js";
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
  careerGuides: typeof careerGuides;
  careerPaths: typeof careerPaths;
  embeddings: typeof embeddings;
  enrichments: typeof enrichments;
  http: typeof http;
  "lib/dedup": typeof lib_dedup;
  "lib/imagePrompts": typeof lib_imagePrompts;
  "lib/imageReference": typeof lib_imageReference;
  "lib/normalize": typeof lib_normalize;
  "lib/rateLimit": typeof lib_rateLimit;
  matching: typeof matching;
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

export declare const components: {};
