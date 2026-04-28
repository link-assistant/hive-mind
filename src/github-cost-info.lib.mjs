#!/usr/bin/env node

import Decimal from 'decimal.js-light';

const formatTokenCount = value => (Number.isFinite(value) ? value : 0).toLocaleString();

const isObservedTokenField = (usage, fieldName) => {
  const value = usage?.[fieldName];
  if (Number.isFinite(value) && value > 0) return true;
  if (usage?.tokenFieldAvailability?.[fieldName] === true) return true;
  if (Array.isArray(usage?.availableTokenFields) && usage.availableTokenFields.includes(fieldName)) return true;
  return false;
};

const buildTokenUsageString = tokenUsage => {
  const parts = [`${formatTokenCount(tokenUsage.inputTokens)} input`, `${formatTokenCount(tokenUsage.outputTokens)} output`];
  if (isObservedTokenField(tokenUsage, 'reasoningTokens')) parts.push(`${formatTokenCount(tokenUsage.reasoningTokens)} reasoning`);
  if (isObservedTokenField(tokenUsage, 'cacheReadTokens')) parts.push(`${formatTokenCount(tokenUsage.cacheReadTokens)} cache read`);
  if (isObservedTokenField(tokenUsage, 'cacheWriteTokens')) parts.push(`${formatTokenCount(tokenUsage.cacheWriteTokens)} cache write`);
  return `\n- Token usage: ${parts.join(', ')}`;
};

/** Build cost estimation string for log comments (Issue #1250, Issue #1557, Issue #1600: Decimal precision) */
export const buildCostInfoString = (totalCostUSD, anthropicTotalCostUSD, pricingInfo, options = {}) => {
  const includeTokenUsage = options.includeTokenUsage !== false;
  const hasPublic = totalCostUSD !== null && totalCostUSD !== undefined;
  const hasAnthropic = anthropicTotalCostUSD !== null && anthropicTotalCostUSD !== undefined;
  const hasPricing = pricingInfo && (pricingInfo.modelName || pricingInfo.tokenUsage || pricingInfo.isFreeModel || pricingInfo.isOpencodeFreeModel);
  const hasOpencodeCost = pricingInfo?.opencodeCost !== null && pricingInfo?.opencodeCost !== undefined;
  if (!hasPublic && !hasAnthropic && !hasPricing && !hasOpencodeCost) return '';
  const publicDec = hasPublic ? new Decimal(totalCostUSD) : null;
  const anthropicDec = hasAnthropic ? new Decimal(anthropicTotalCostUSD) : null;
  // Issue #1703: collapse to short form when the rounded difference is below 6-decimal display precision.
  // Without this, near-matching values like $11.219694 vs $11.219693 still printed the full breakdown
  // even though "Difference: $-0.000000 (-0.00%)" carries no meaningful information.
  if (publicDec && anthropicDec && anthropicDec.minus(publicDec).abs().toFixed(6) === '0.000000') return `\n\n### 💰 Cost: **$${anthropicDec.toFixed(6)}**`;
  let costInfo = '\n\n### 💰 **Cost estimation:**';
  if (pricingInfo?.modelName) {
    costInfo += `\n- Model: ${pricingInfo.modelName}`;
    if (pricingInfo.provider) costInfo += `\n- Provider: ${pricingInfo.provider}`;
  }
  if (hasPublic) {
    if (pricingInfo?.isFreeModel && publicDec.eq(0) && !pricingInfo?.baseModelName) {
      costInfo += '\n- Public pricing estimate: $0.00 (Free model)';
    } else {
      let pricingRef = '';
      if (pricingInfo?.baseModelName && pricingInfo?.originalProvider) {
        pricingRef = ` (based on ${pricingInfo.originalProvider} ${pricingInfo.baseModelName} prices)`;
      } else if (pricingInfo?.originalProvider) {
        pricingRef = ` (based on ${pricingInfo.originalProvider} prices)`;
      }
      costInfo += `\n- Public pricing estimate: $${publicDec.toFixed(6)}${pricingRef}`;
    }
  } else if (hasPricing) {
    costInfo += '\n- Public pricing estimate: unknown';
  }
  if (hasOpencodeCost) {
    if (pricingInfo.isOpencodeFreeModel) {
      costInfo += '\n- Calculated by OpenCode Zen: $0.00 (Free model)';
    } else {
      costInfo += `\n- Calculated by OpenCode Zen: $${new Decimal(pricingInfo.opencodeCost).toFixed(6)}`;
    }
  }
  if (includeTokenUsage && pricingInfo?.tokenUsage) costInfo += buildTokenUsageString(pricingInfo.tokenUsage);
  if (hasAnthropic) {
    costInfo += `\n- Calculated by Anthropic: $${anthropicDec.toFixed(6)}`;
    if (hasPublic) {
      const diff = anthropicDec.minus(publicDec);
      const pct = publicDec.gt(0) ? diff.div(publicDec).mul(100) : new Decimal(0);
      costInfo += `\n- Difference: $${diff.toFixed(6)} (${pct.gt(0) ? '+' : ''}${pct.toFixed(2)}%)`;
    }
  }
  return costInfo;
};
