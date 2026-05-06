export type DescribeLadderHitArgs = {
  ladderHit: "radius" | "country" | "anywhere";
  pickedCitySlugs: Array<string | undefined>;
  viewerCityLabel: string | undefined;
  viewerCountryLabel: string | undefined;
  total: number;
};

export function describeLadderHit(args: DescribeLadderHitArgs): string {
  const { ladderHit, pickedCitySlugs, viewerCityLabel, viewerCountryLabel, total } = args;

  if (ladderHit === "radius") {
    const first = pickedCitySlugs[0];
    const allSameCity =
      first !== undefined && pickedCitySlugs.every((s) => s === first);

    if (viewerCityLabel) {
      return allSameCity
        ? `${total} in ${viewerCityLabel}`
        : `${total} within 50 km of ${viewerCityLabel}`;
    }
    return `${total} nearby`;
  }

  if (ladderHit === "country") {
    return viewerCountryLabel ? `${total} in ${viewerCountryLabel}` : `${total} available`;
  }

  return `${total} globally`;
}
