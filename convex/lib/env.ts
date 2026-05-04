/**
 * Deployment-environment helpers.
 *
 * `isCronAllowedDeployment()` is the structural defence against the V1 incident
 * where seven abandoned preview Convex backends silently kept running expensive
 * crons (Exa + LLM spend) after their branches were merged. See
 * `.claude/rules/deployment-previews.md` for the full incident write-up.
 *
 * The check is allow-list, not deny-list: only the two known-good deployments
 * (prod + dev) get crons registered. Any preview backend ends up with zero
 * `_scheduled_functions` rows and therefore zero possible spend.
 *
 * If you spin up a new permanent deployment (rare — staging, canary, etc.),
 * add it to the allow-list below FIRST, then deploy.
 */

const ALLOWED_DEPLOYMENTS = [
  "striped-narwhal-926", // prod
  "pleasant-pigeon-988", // dev
] as const;

export function isCronAllowedDeployment(): boolean {
  const url = process.env.CONVEX_CLOUD_URL ?? "";
  return ALLOWED_DEPLOYMENTS.some((name) => url.includes(name));
}
