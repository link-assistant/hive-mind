export const state = { active: 0, peak: 0, order: [] };

export const slowLoad = async name => {
  state.active += 1;
  state.peak = Math.max(state.peak, state.active);
  state.order.push(`${name} start`);
  await new Promise(resolve => setTimeout(resolve, 50));
  state.order.push(`${name} end`);
  state.active -= 1;
  return name;
};
