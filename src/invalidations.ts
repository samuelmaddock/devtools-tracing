// Copied from chromium's devtools-frontend:
// front_end/panels/timeline/components/DetailsView.ts
// https://source.chromium.org/chromium/chromium/src/+/main:third_party/devtools-frontend/src/front_end/panels/timeline/components/DetailsView.ts

import type * as Protocol from '../lib/front_end/generated/protocol.js';
import * as Trace from '../lib/front_end/models/trace/trace.js';

export function generateInvalidationsList(
    invalidations: Trace.Types.Events.InvalidationTrackingEvent[],
    ): {
  groupedByReason: Record<string, Trace.Types.Events.InvalidationTrackingEvent[]>,
  backendNodeIds: Set<Protocol.DOM.BackendNodeId>,
} {
  const groupedByReason: Record<string, Trace.Types.Events.InvalidationTrackingEvent[]> = {};

  const backendNodeIds = new Set<Protocol.DOM.BackendNodeId>();
  for (const invalidation of invalidations) {
    backendNodeIds.add(invalidation.args.data.nodeId);

    let reason = invalidation.args.data.reason || 'unknown';

    // ScheduleStyle events do not always have a reason, but if they tell us
    // via their data what changed, we can update the reason that we show to
    // the user.
    if (reason === 'unknown' && Trace.Types.Events.isScheduleStyleInvalidationTracking(invalidation) &&
        invalidation.args.data.invalidatedSelectorId) {
      switch (invalidation.args.data.invalidatedSelectorId) {
        case 'attribute':
          reason = 'Attribute';
          if (invalidation.args.data.changedAttribute) {
            reason += ` (${invalidation.args.data.changedAttribute})`;
          }
          break;
        case 'class':
          reason = 'Class';
          if (invalidation.args.data.changedClass) {
            reason += ` (${invalidation.args.data.changedClass})`;
          }
          break;
        case 'id':
          reason = 'Id';
          if (invalidation.args.data.changedId) {
            reason += ` (${invalidation.args.data.changedId})`;
          }
          break;
      }
    }

    if (reason === 'PseudoClass' && Trace.Types.Events.isStyleRecalcInvalidationTracking(invalidation) &&
        invalidation.args.data.extraData) {
      // This will append the `:focus` onto the reason.
      reason += invalidation.args.data.extraData;
    }

    if (reason === 'Attribute' && Trace.Types.Events.isStyleRecalcInvalidationTracking(invalidation) &&
        invalidation.args.data.extraData) {
      // Append the attribute that changed.
      reason += ` (${invalidation.args.data.extraData})`;
    }

    if (reason === 'StyleInvalidator') {
      // These events give us some extra metadata but are not in isolation that
      // useful and end up duplicating information from other tracking events,
      // so we do not include these in the UI.
      continue;
    }

    const existing = groupedByReason[reason] || [];
    existing.push(invalidation);
    groupedByReason[reason] = existing;
  }
  return {groupedByReason, backendNodeIds};
}
