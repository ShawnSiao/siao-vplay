export function createPlaybackCompletion() {
  let baseline: number | null = null;
  let advanced = false;
  return {
    seek(position: number) { baseline = position; advanced = false; },
    observe(position: number, playing: boolean) {
      if (playing && baseline !== null && position > baseline) advanced = true;
      baseline = position;
    },
    ended() { return advanced; },
  };
}
