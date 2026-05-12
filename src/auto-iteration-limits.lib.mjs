#!/usr/bin/env node

export const DEFAULT_AUTO_ITERATION_LIMIT = 5;

export const normalizeAutoIterationLimit = (value, fallback = DEFAULT_AUTO_ITERATION_LIMIT) => {
  if (value === 0 || value === '0') return 0;

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;

  return Math.floor(parsed);
};

export const normalizeAutoIterationCounter = value => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;

  return Math.floor(parsed);
};

export const hasReachedAutoIterationLimit = (completedIterations, maxIterations) => {
  const normalizedMax = normalizeAutoIterationLimit(maxIterations);
  if (normalizedMax === 0) return false;

  return normalizeAutoIterationCounter(completedIterations) >= normalizedMax;
};

export const formatAutoIterationLimit = maxIterations => {
  const normalizedMax = normalizeAutoIterationLimit(maxIterations);
  return normalizedMax === 0 ? 'unlimited' : `${normalizedMax}`;
};

export const shouldSyncBeforeRestart = ({ hasUncommittedChanges }) => !hasUncommittedChanges;
