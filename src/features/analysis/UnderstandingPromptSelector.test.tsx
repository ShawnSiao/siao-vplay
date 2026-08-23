import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PromptSelection } from "./types";

const mocks = vi.hoisted(() => ({
  listAnalysisPromptTemplates: vi.fn(),
  saveAnalysisPromptTemplate: vi.fn(),
  deleteAnalysisPromptTemplate: vi.fn(),
}));

vi.mock("./gateway", () => mocks);

import { UnderstandingPromptSelector } from "./UnderstandingPromptSelector";

const balanced = {
  id: "builtin:understanding:balanced",
  taskType: "understanding" as const,
  baseTemplateId: "builtin:understanding:balanced",
  name: "均衡解释",
  customRequirements: "均衡理解",
  isBuiltin: true,
  createdAtMs: 1,
  updatedAtMs: 1,
};

function Fixture() {
  const [selection, setSelection] = useState<PromptSelection>({
    templateId: balanced.id,
    oneTimeRequirements: "",
  });
  return (
    <UnderstandingPromptSelector
      value={selection}
      disabled={false}
      onChange={setSelection}
      onError={(cause) => {
        throw cause;
      }}
    />
  );
}

describe("UnderstandingPromptSelector", () => {
  beforeEach(() => {
    mocks.listAnalysisPromptTemplates.mockResolvedValue([balanced]);
    mocks.saveAnalysisPromptTemplate.mockResolvedValue({
      ...balanced,
      id: "personal-1",
      baseTemplateId: balanced.id,
      name: "术语重点",
      customRequirements: "重点解释术语",
      isBuiltin: false,
    });
  });

  it("keeps one-time requirements separate and can save them as a personal template", async () => {
    render(<Fixture />);
    expect(await screen.findByRole("option", { name: "均衡解释" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("本次补充要求"), {
      target: { value: "重点解释术语" },
    });
    expect(screen.getByText("6 / 4000")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保存为个人模板" }));
    fireEvent.change(screen.getByLabelText("个人模板名称"), {
      target: { value: "术语重点" },
    });
    fireEvent.click(screen.getByRole("button", { name: "确认保存" }));

    await waitFor(() =>
      expect(mocks.saveAnalysisPromptTemplate).toHaveBeenCalledWith({
        id: null,
        taskType: "understanding",
        baseTemplateId: balanced.id,
        name: "术语重点",
        customRequirements: "重点解释术语",
      }),
    );
    expect(screen.getByLabelText("提示词模板")).toHaveValue("personal-1");
    expect(screen.getByLabelText("本次补充要求")).toHaveValue("");
  });
});
