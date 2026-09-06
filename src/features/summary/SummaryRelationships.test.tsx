import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { createSummaryFixtures } from "../../test-fixtures/summary";
import { SummaryResultView } from "./SummaryResultView";
import { SummaryRelationships } from "./SummaryRelationships";
import { readableRelationships } from "./readableRelationships";

it("presents simple relationships as readable text instead of graph source", () => {
  const { summary } = createSummaryFixtures();
  render(<SummaryResultView summary={summary} exporting={false} exportNotice={null} onExport={vi.fn()} onNewSummary={vi.fn()} />);
  expect(screen.getByText("Input → State")).toBeInTheDocument();
  expect(screen.queryByText(/flowchart LR/)).not.toBeInTheDocument();
});

it("resolves labels declared after edges and preserves relationship labels", () => {
  expect(readableRelationships('flowchart LR\nA -->|提交| B\nA[用户]\nB["服务"]')).toEqual([{ from: "用户", to: "服务", label: "提交" }]);
});

it.each([
  'flowchart LR\nA --> B\nclick A "javascript:alert(1)"',
  '%%{init: {securityLevel: loose}}%%\nflowchart LR\nA --> B',
  'flowchart LR\nA[<img src=x onerror=alert(1)>] --> B',
  'flowchart LR\nA --> B\nsubgraph secrets',
  "x".repeat(20_001),
])("falls back entirely for unsupported or active graph syntax", (source) => {
  const { container } = render(<SummaryRelationships source={source} />);
  expect(screen.getByText(/格式暂不支持显示/)).toBeInTheDocument();
  expect(container.querySelector("pre, a, script, img, iframe")).toBeNull();
  expect(container.textContent).not.toContain("A → B");
});
