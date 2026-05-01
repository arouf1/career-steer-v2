type ClassValue =
  | string
  | number
  | false
  | null
  | undefined
  | ClassValue[];

const flatten = (input: ClassValue, out: string[]): void => {
  if (!input && input !== 0) return;
  if (typeof input === "string" || typeof input === "number") {
    const s = String(input).trim();
    if (s.length > 0) out.push(s);
    return;
  }
  if (Array.isArray(input)) {
    for (const item of input) flatten(item, out);
  }
};

/**
 * Join class-name fragments. Minimal stand-in for the shadcn `cn` helper.
 * If/when `clsx` + `tailwind-merge` get installed for real shadcn primitives,
 * swap this for the canonical `clsx(twMerge(...))` implementation.
 */
export const cn = (...inputs: ClassValue[]): string => {
  const parts: string[] = [];
  for (const input of inputs) flatten(input, parts);
  return parts.join(" ");
};
