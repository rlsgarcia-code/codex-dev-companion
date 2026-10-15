export type ContextBudget = {
  maximumCharacters: number;
  usedCharacters: number;
  estimatedTokens: number;
  utilizationPercent: number;
  automaticCharacters: number;
  guidanceCharacters: number;
  guidanceFiles: number;
  guidancePaths: string[];
  pinnedCharacters: number;
  truncated: boolean;
};

export type ComposedContext = {
  text: string;
  budget: ContextBudget;
};

const CHARACTERS_PER_ESTIMATED_TOKEN = 4;
const MINIMUM_AUTOMATIC_SHARE = 0.25;
const TRUNCATION_MARKER = "\n<context_truncated />";

export function estimateContextTokens(characters: number): number {
  return Math.ceil(Math.max(0, characters) / CHARACTERS_PER_ESTIMATED_TOKEN);
}

/**
 * Keeps explicitly pinned context visible even when automatic workspace context
 * is large. When both sources exist, automatic context retains at least 25% of
 * the available budget and pinned context can use the remainder. Any unused
 * share is immediately returned to the other source.
 */
export function composeContextWithinBudget(
  automaticContext: string,
  pinnedContext: string,
  maximumCharacters: number
): ComposedContext {
  return composeContextSourcesWithinBudget(automaticContext, "", pinnedContext, maximumCharacters);
}

/** Keeps explicit context first, then repository guidance, then editor signals. */
export function composeContextSourcesWithinBudget(
  automaticContext: string,
  guidanceContext: string,
  pinnedContext: string,
  maximumCharacters: number
): ComposedContext {
  const maximum = Math.max(1, Math.floor(maximumCharacters));
  const sourceCount = [automaticContext, guidanceContext, pinnedContext].filter(Boolean).length;
  const separatorCharacters = Math.min(maximum, Math.max(0, sourceCount - 1) * 2);
  const contentMaximum = Math.max(0, maximum - separatorCharacters);
  const hasAutomaticSource = Boolean(automaticContext || guidanceContext);
  const maximumPinned = pinnedContext && hasAutomaticSource
    ? Math.max(0, contentMaximum - Math.max(1, Math.floor(contentMaximum * MINIMUM_AUTOMATIC_SHARE)))
    : contentMaximum;
  let pinnedBudget = Math.min(pinnedContext.length, maximumPinned);
  let remaining = Math.max(0, contentMaximum - pinnedBudget);
  let guidanceBudget = 0;
  let automaticBudget = 0;

  if (guidanceContext && automaticContext) {
    guidanceBudget = Math.min(guidanceContext.length, Math.floor(remaining * 0.7));
    automaticBudget = Math.min(automaticContext.length, remaining - guidanceBudget);
    let unused = remaining - guidanceBudget - automaticBudget;
    const extraGuidance = Math.min(unused, guidanceContext.length - guidanceBudget);
    guidanceBudget += extraGuidance;
    unused -= extraGuidance;
    automaticBudget += Math.min(unused, automaticContext.length - automaticBudget);
  } else if (guidanceContext) {
    guidanceBudget = Math.min(guidanceContext.length, remaining);
  } else {
    automaticBudget = Math.min(automaticContext.length, remaining);
  }

  remaining = contentMaximum - pinnedBudget - guidanceBudget - automaticBudget;
  pinnedBudget += Math.min(remaining, pinnedContext.length - pinnedBudget);

  const boundedGuidance = truncateContext(guidanceContext, guidanceBudget);
  const boundedAutomatic = truncateContext(automaticContext, automaticBudget);
  const boundedPinned = truncateContext(pinnedContext, pinnedBudget);
  const text = [boundedGuidance, boundedAutomatic, boundedPinned].filter(Boolean).join("\n\n").slice(0, maximum);
  return {
    text,
    budget: budgetFor(
      maximum,
      boundedAutomatic.length,
      boundedGuidance.length,
      boundedPinned.length,
      automaticContext.length > boundedAutomatic.length
        || guidanceContext.length > boundedGuidance.length
        || pinnedContext.length > boundedPinned.length
    )
  };
}

function truncateContext(value: string, maximumCharacters: number): string {
  if (maximumCharacters <= 0) return "";
  if (value.length <= maximumCharacters) return value;
  if (maximumCharacters <= TRUNCATION_MARKER.length) return value.slice(0, maximumCharacters);
  return `${value.slice(0, maximumCharacters - TRUNCATION_MARKER.length)}${TRUNCATION_MARKER}`;
}

function budgetFor(
  maximumCharacters: number,
  automaticCharacters: number,
  guidanceCharacters: number,
  pinnedCharacters: number,
  truncated: boolean
): ContextBudget {
  const usedCharacters = Math.min(
    maximumCharacters,
    automaticCharacters + guidanceCharacters + pinnedCharacters
      + Math.max(0, [automaticCharacters, guidanceCharacters, pinnedCharacters].filter(Boolean).length - 1) * 2
  );
  return {
    maximumCharacters,
    usedCharacters,
    estimatedTokens: estimateContextTokens(usedCharacters),
    utilizationPercent: Math.min(100, Math.round((usedCharacters / maximumCharacters) * 100)),
    automaticCharacters,
    guidanceCharacters,
    guidanceFiles: 0,
    guidancePaths: [],
    pinnedCharacters,
    truncated
  };
}
