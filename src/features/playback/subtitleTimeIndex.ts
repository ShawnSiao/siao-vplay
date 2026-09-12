export function createSubtitleTimeIndex<T extends { startMs: number; endMs: number }>(segments: readonly T[]) {
  const intervals = segments.map((segment, index) => ({ segment, index, start: segment.startMs, end: segment.endMs }))
    .filter(item => Number.isFinite(item.start) && Number.isFinite(item.end) && item.start < item.end);
  const starts = [...intervals].sort((a, b) => a.start - b.start);
  const boundaries = [...new Set(intervals.flatMap(item => [item.start, item.end]))].sort((a, b) => a - b);
  // Source-order heap preserves Array.find semantics even for unsorted, overlapping cues.
  const heap: typeof intervals = [];
  function push(item: typeof intervals[number]) {
    let slot = heap.length;
    heap.push(item);
    while (slot > 0) {
      const parent = (slot - 1) >>> 1;
      if (heap[parent].index < item.index) break;
      heap[slot] = heap[parent];
      slot = parent;
    }
    heap[slot] = item;
  }
  function pop() {
    const last = heap.pop()!;
    if (!heap.length) return;
    let slot = 0;
    while (slot * 2 + 1 < heap.length) {
      let child = slot * 2 + 1;
      if (child + 1 < heap.length && heap[child + 1].index < heap[child].index) child++;
      if (last.index < heap[child].index) break;
      heap[slot] = heap[child];
      slot = child;
    }
    heap[slot] = last;
  }
  const times: number[] = [];
  const values: (T | null)[] = [];
  let cursor = 0;
  let previous: T | null = null;
  for (const time of boundaries) {
    while (cursor < starts.length && starts[cursor].start <= time) push(starts[cursor++]);
    while (heap.length && heap[0].end <= time) pop();
    const value = heap[0]?.segment ?? null;
    if (value !== previous) { times.push(time); values.push(value); previous = value; }
  }
  return (positionMs: number): T | null => {
    if (!Number.isFinite(positionMs)) return null;
    let low = 0, high = times.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (times[mid] <= positionMs) low = mid + 1;
      else high = mid;
    }
    return low === 0 ? null : values[low - 1];
  };
}
