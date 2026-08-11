import { useState } from "react";
import { act, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Project } from "../../types";
import { usePosterQueue } from "./usePosterQueue";

const desktopMocks = vi.hoisted(() => ({
  ensureProjectPoster: vi.fn(),
}));

vi.mock("../../lib/desktop", () => desktopMocks);

function project(id: string, posterPath: string | null = null): Project {
  return {
    id,
    status: "ready",
    mediaSource: { posterPath },
  } as Project;
}

function PosterQueueHarness({ projects: initialProjects }: { projects: Project[] }) {
  const [projects, setProjects] = useState(initialProjects);
  const [, setActiveProject] = useState<Project | null>(projects[0] ?? null);
  usePosterQueue({
    enabled: true,
    projects,
    refreshLibrary: vi.fn(),
    setProjects,
    setActiveProject,
  });
  return null;
}

describe("usePosterQueue", () => {
  it("generates missing posters one at a time", async () => {
    const first = project("project-1");
    const second = project("project-2");
    let resolveFirst: ((value: Project) => void) | undefined;
    desktopMocks.ensureProjectPoster
      .mockImplementationOnce(
        () =>
          new Promise<Project>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce(project(second.id, "poster-2.jpg"));

    render(<PosterQueueHarness projects={[first, second]} />);

    await waitFor(() =>
      expect(desktopMocks.ensureProjectPoster).toHaveBeenCalledTimes(1),
    );
    expect(desktopMocks.ensureProjectPoster).toHaveBeenLastCalledWith(first.id);

    await act(async () => resolveFirst?.(project(first.id, "poster-1.jpg")));

    await waitFor(
      () => expect(desktopMocks.ensureProjectPoster).toHaveBeenCalledTimes(2),
      { timeout: 2_000 },
    );
    expect(desktopMocks.ensureProjectPoster).toHaveBeenLastCalledWith(second.id);
  });
});
