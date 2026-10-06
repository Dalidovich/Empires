import { updateVisibility } from '../core/visibility';
import type { System } from '../system';

export const visibilitySystem: System = {
  id: 'visibility',
  update(state, ctx) {
    updateVisibility(state, ctx.data);
  },
};
