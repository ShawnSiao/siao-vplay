type NavigationIconName = "search" | "play" | "collection" | "folder" | "clock" | "video" | "link";

// Conventional geometric symbols, drawn locally rather than dependent on font glyphs.
const paths: Record<NavigationIconName, string> = {
  search: "M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  play: "M8 5l11 7-11 7z",
  collection: "M4 3h16 M2 7h20v14H2z M10 11l5 3-5 3z",
  folder: "M2 6V4h7l2 3h11v13H2z",
  clock: "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0 M12 6v6l4 2",
  video: "M3 2h12l6 6v14H3z M15 2v6h6 M9 11l6 4-6 4z",
  link: "M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2 M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2",
};

export function NavigationIcon({ name }: { name: NavigationIconName }) {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"
    style={{ display: "inline-block", verticalAlign: "middle", flexShrink: 0 }}>
    <path d={paths[name]} />
  </svg>;
}
