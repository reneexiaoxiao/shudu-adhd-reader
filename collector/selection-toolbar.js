(() => {
  const hasArea = (rect) => rect && (Number(rect.width) > 0 || Number(rect.height) > 0);

  function selectionAnchor(rects, boundingRect) {
    const visibleRects = Array.from(rects || []).filter(hasArea);
    return visibleRects.at(-1) || (hasArea(boundingRect) ? boundingRect : null);
  }

  function overflowScore(position, width, height, viewportWidth, viewportHeight, margin) {
    return Math.max(0, margin - position.left) +
      Math.max(0, position.left + width + margin - viewportWidth) +
      Math.max(0, margin - position.top) +
      Math.max(0, position.top + height + margin - viewportHeight);
  }

  function computePosition(rect, size, viewport) {
    const margin = 8;
    const gap = 8;
    const width = Math.max(1, Number(size?.width) || 32);
    const height = Math.max(1, Number(size?.height) || 32);
    const viewportWidth = Math.max(width + margin * 2, Number(viewport?.width) || width + margin * 2);
    const viewportHeight = Math.max(height + margin * 2, Number(viewport?.height) || height + margin * 2);
    const leftAtEnd = Number(rect?.right || 0) - width;
    const leftAtStart = Number(rect?.left || 0);
    const above = Number(rect?.top || 0) - height - gap;
    const below = Number(rect?.bottom || 0) + gap;
    const candidates = [
      { left: leftAtEnd, top: above, placement: "above-end" },
      { left: leftAtEnd, top: below, placement: "below-end" },
      { left: leftAtStart, top: above, placement: "above-start" },
      { left: leftAtStart, top: below, placement: "below-start" }
    ];
    const ranked = candidates
      .map((candidate, index) => ({
        ...candidate,
        index,
        score: overflowScore(candidate, width, height, viewportWidth, viewportHeight, margin)
      }))
      .sort((a, b) => a.score - b.score || a.index - b.index);
    const best = ranked[0];
    return {
      left: Math.round(Math.max(margin, Math.min(viewportWidth - width - margin, best.left))),
      top: Math.round(Math.max(margin, Math.min(viewportHeight - height - margin, best.top))),
      placement: best.placement
    };
  }

  function computeDockPosition(rect, size, viewport) {
    const margin = 12;
    const viewportWidth = Math.max(1, Number(viewport?.width) || 1);
    const viewportHeight = Math.max(1, Number(viewport?.height) || 1);
    const width = Math.min(Number(size?.width) || 32, Math.max(1, viewportWidth - margin * 2));
    const height = Math.min(Number(size?.height) || 32, Math.max(1, viewportHeight - margin * 2));
    const roomAbove = Math.max(0, Number(rect?.top) || 0);
    const roomBelow = Math.max(0, viewportHeight - (Number(rect?.bottom) || 0));
    const atBottom = roomBelow >= roomAbove;
    return {
      left: Math.max(0, Math.round((viewportWidth - width) / 2)),
      top: atBottom ? Math.max(0, viewportHeight - height - margin) : Math.min(margin, Math.max(0, viewportHeight - height)),
      placement: atBottom ? "dock-bottom" : "dock-top"
    };
  }

  function nearbyImageIndexes(candidates, selectionRect, maxDistance = 2000) {
    const selectionTop = Number(selectionRect?.top) || 0;
    const selectionBottom = Number(selectionRect?.bottom) || selectionTop;
    const limit = Math.max(0, Number(maxDistance) || 0);
    const normalized = Array.from(candidates || [])
      .map((candidate, order) => {
        const top = Number(candidate?.top);
        const bottom = Number(candidate?.bottom);
        if (!Number.isFinite(top) || !Number.isFinite(bottom) || bottom <= top) return null;
        const direction = bottom < selectionTop
          ? "above"
          : top > selectionBottom
            ? "below"
            : "overlap";
        const distance = direction === "above"
          ? selectionTop - bottom
          : direction === "below"
            ? top - selectionBottom
            : 0;
        return {
          index: Number.isInteger(candidate?.index) ? candidate.index : order,
          order,
          direction,
          distance
        };
      })
      .filter(Boolean);

    const overlaps = normalized
      .filter((candidate) => candidate.direction === "overlap")
      .sort((left, right) => left.order - right.order)
      .slice(0, 2);
    if (overlaps.length) return overlaps.map((candidate) => candidate.index);

    const nearest = (direction) => normalized
      .filter((candidate) => candidate.direction === direction && candidate.distance <= limit)
      .sort((left, right) => left.distance - right.distance || left.order - right.order)[0];
    return [nearest("above"), nearest("below")]
      .filter(Boolean)
      .map((candidate) => candidate.index);
  }

  globalThis.ShuduSelectionToolbar = { computePosition, computeDockPosition, selectionAnchor, nearbyImageIndexes };
})();
