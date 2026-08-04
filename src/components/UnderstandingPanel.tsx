import { useEffect, useRef, useState } from "react";

import {
  cancelExplanationTask,
  chooseExplanationResultFile,
  commandError,
  getCodexRuntimeStatus,
  getExplanation,
  getExplanationTask,
  importExplanationResult,
  listExplanations,
  listExplanationTasks,
  openExplanationMaterials,
  openExternalResultDirectory,
  prepareExplanationTask,
  readExplanationPrompt,
  resumeCodexExplanationTask,
  startCodexExplanationTask,
} from "../lib/desktop";
import { formatDuration } from "../lib/format";
import type {
  CodexRuntimeStatus,
  Explanation,
  ExplanationTask,
  SubtitleVersion,
} from "../types";

type UnderstandingPanelProps = {
  projectId: string;
  playbackCutoffMs: number;
  sourceVersion: SubtitleVersion | null;
  translationVersion: SubtitleVersion | null;
  onPrepareSubtitles: () => void;
  onClose: () => void;
  embedded?: boolean;
};

type HandoffKind = "codex" | "manual";

const activeStatuses = new Set([
  "awaiting_external_result",
  "queued",
  "running",
  "validating",
]);

function fileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? "result.json";
}

function statusCopy(task: ExplanationTask): string {
  if (task.status === "queued") {
    return "已准备好，等待本机开始";
  }
  if (task.status === "running") {
    return "正在结合字幕和关键帧理解当前场景";
  }
  if (task.status === "validating") {
    return "正在检查播放范围和结果完整性";
  }
  if (task.status === "interrupted") {
    return "应用上次关闭时尚未完成";
  }
  if (task.status === "cancelled") {
    return "本次理解已取消";
  }
  return task.errorMessage ?? "本次理解没有完成";
}

export function UnderstandingPanel({
  projectId,
  playbackCutoffMs,
  sourceVersion,
  translationVersion,
  onPrepareSubtitles,
  onClose,
  embedded = false,
}: UnderstandingPanelProps) {
  const handledCompletionRef = useRef<string | null>(null);
  const initialCutoffRef = useRef(playbackCutoffMs);
  const [handoff, setHandoff] = useState<HandoffKind>("codex");
  const [runtime, setRuntime] = useState<CodexRuntimeStatus | null>(null);
  const [task, setTask] = useState<ExplanationTask | null>(null);
  const [explanation, setExplanation] = useState<Explanation | null>(null);
  const [history, setHistory] = useState<Explanation[]>([]);
  const [prompt, setPrompt] = useState<string | null>(null);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [factsExpanded, setFactsExpanded] = useState(false);
  const [interpretationExpanded, setInterpretationExpanded] = useState(true);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  const [resultPath, setResultPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [operation, setOperation] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([
      getCodexRuntimeStatus(),
      listExplanationTasks(projectId),
      listExplanations(projectId),
    ])
      .then(([nextRuntime, tasks, explanations]) => {
        if (!active) {
          return;
        }
        setRuntime(nextRuntime);
        setHistory(explanations);
        const activeTask = tasks.find((item) =>
          activeStatuses.has(item.status),
        );
        if (activeTask) {
          setTask(activeTask);
          setHandoff(activeTask.handoffKind);
        }
        const latestVisible =
          explanations.find(
            (item) => item.playbackCutoffMs <= initialCutoffRef.current,
          ) ??
          explanations[0] ??
          null;
        if (!activeTask && latestVisible) {
          setFactsExpanded(false);
          setInterpretationExpanded(true);
          setExplanation(latestVisible);
          setTask(
            tasks.find((item) => item.id === latestVisible.taskId) ?? null,
          );
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(commandError(cause).message);
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [projectId]);

  useEffect(() => {
    if (
      !task ||
      task.handoffKind !== "manual" ||
      task.status !== "awaiting_external_result" ||
      prompt
    ) {
      return;
    }
    let active = true;
    void readExplanationPrompt(task.id)
      .then((value) => {
        if (active) {
          setPrompt(value);
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(commandError(cause).message);
        }
      });
    return () => {
      active = false;
    };
  }, [prompt, task]);

  useEffect(() => {
    if (
      !task ||
      !["awaiting_external_result", "running", "validating"].includes(
        task.status,
      )
    ) {
      return;
    }
    let active = true;
    const timer = window.setInterval(() => {
      void getExplanationTask(task.id)
        .then((nextTask) => {
          if (active) {
            setTask(nextTask);
          }
        })
        .catch((cause: unknown) => {
          if (active) {
            setError(commandError(cause).message);
          }
        });
    }, 800);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [task]);

  useEffect(() => {
    if (
      !task ||
      task.status !== "completed" ||
      !task.outputExplanationId ||
      handledCompletionRef.current === task.id
    ) {
      return;
    }
    handledCompletionRef.current = task.id;
    void getExplanation(task.outputExplanationId)
      .then((value) => {
        setFactsExpanded(false);
        setInterpretationExpanded(true);
        setExplanation(value);
        setHistory((current) => [
          value,
          ...current.filter((item) => item.id !== value.id),
        ]);
      })
      .catch((cause: unknown) => {
        setError(commandError(cause).message);
      });
  }, [task]);

  const resetForCurrentScene = () => {
    handledCompletionRef.current = null;
    setTask(null);
    setExplanation(null);
    setPrompt(null);
    setPromptExpanded(false);
    setFactsExpanded(false);
    setInterpretationExpanded(true);
    setCopyNotice(null);
    setResultPath(null);
    setError(null);
  };

  const prepare = async () => {
    if (!sourceVersion || playbackCutoffMs <= 0) {
      return;
    }
    setOperation("prepare");
    setError(null);
    try {
      const prepared = await prepareExplanationTask(
        projectId,
        handoff,
        playbackCutoffMs,
      );
      setTask(prepared);
      setExplanation(null);
      if (handoff === "codex") {
        setTask(await startCodexExplanationTask(prepared.id));
      } else {
        setPrompt(await readExplanationPrompt(prepared.id));
        setPromptExpanded(true);
      }
    } catch (cause) {
      setError(commandError(cause).message);
      const tasks = await listExplanationTasks(projectId).catch(() => []);
      const activeTask = tasks.find((item) => activeStatuses.has(item.status));
      if (activeTask) {
        setTask(activeTask);
        setHandoff(activeTask.handoffKind);
      }
    } finally {
      setOperation(null);
    }
  };

  const cancel = async () => {
    if (!task) {
      return;
    }
    setOperation("cancel");
    setError(null);
    try {
      setTask(await cancelExplanationTask(task.id));
    } catch (cause) {
      setError(commandError(cause).message);
    } finally {
      setOperation(null);
    }
  };

  const resume = async () => {
    if (!task) {
      return;
    }
    setOperation("resume");
    setError(null);
    try {
      setTask(await resumeCodexExplanationTask(task.id));
    } catch (cause) {
      setError(commandError(cause).message);
    } finally {
      setOperation(null);
    }
  };

  const copyPrompt = async () => {
    if (!prompt) {
      return;
    }
    setCopyNotice(null);
    if (!navigator.clipboard?.writeText) {
      setPromptExpanded(true);
      setCopyNotice("无法自动复制，可以在下方选择完整提示词。");
      return;
    }
    try {
      await navigator.clipboard.writeText(prompt);
      setCopyNotice("完整提示词已复制。");
    } catch {
      setPromptExpanded(true);
      setCopyNotice("无法自动复制，可以在下方选择完整提示词。");
    }
  };

  const chooseResult = async () => {
    setError(null);
    try {
      const path = await chooseExplanationResultFile();
      if (path) {
        setResultPath(path);
      }
    } catch (cause) {
      setError(commandError(cause).message);
    }
  };

  const openReturnDirectory = async () => {
    if (!task) {
      return;
    }
    setError(null);
    try {
      await openExternalResultDirectory("explanation", task.id);
      setCopyNotice("已打开自动返回目录。保存为 result.json 后会自动检测。");
    } catch (cause) {
      setError(commandError(cause).message);
    }
  };

  const importResult = async () => {
    if (!task || !resultPath) {
      return;
    }
    setOperation("import");
    setError(null);
    try {
      const application = await importExplanationResult(task.id, resultPath);
      handledCompletionRef.current = task.id;
      setFactsExpanded(false);
      setInterpretationExpanded(true);
      setTask(application.task);
      setExplanation(application.explanation);
      setHistory((current) => [
        application.explanation,
        ...current.filter((item) => item.id !== application.explanation.id),
      ]);
    } catch (cause) {
      setError(commandError(cause).message);
      setTask(await getExplanationTask(task.id).catch(() => task));
    } finally {
      setOperation(null);
    }
  };

  const busy = operation !== null;
  const runtimeReady =
    runtime?.available && runtime.authenticated && runtime.supported;
  const running =
    task && ["queued", "running", "validating"].includes(task.status);
  const canResume =
    task?.handoffKind === "codex" &&
    ["failed", "cancelled", "interrupted"].includes(task.status);
  const visibleFacts = explanation
    ? explanation.confirmedFacts.slice(0, factsExpanded ? undefined : 3)
    : [];
  const hasMoreFacts = Boolean(
    explanation && explanation.confirmedFacts.length > 3,
  );

  const PanelElement = embedded ? "section" : "aside";

  return (
    <PanelElement
      className={`understanding-panel ${embedded ? "embedded" : ""}`}
      aria-label="场景理解"
    >
      {!embedded ? <header className="understanding-header">
        <div>
          <span>按需理解</span>
          <strong>当前场景</strong>
        </div>
        <button
          aria-label="关闭场景理解"
          className="understanding-close"
          type="button"
          onClick={onClose}
        >
          ×
        </button>
      </header> : null}

      <div className="understanding-scroll">
        <div className="spoiler-boundary">
          <span>无剧透范围</span>
          <strong>仅使用 {formatDuration(playbackCutoffMs)} 之前</strong>
          <small>不会读取或发送这个播放点之后的字幕和画面。</small>
        </div>

        {error ? (
          <div className="understanding-error" role="alert">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="understanding-loading" role="status">
            <span className="spinner"></span>
            <span>正在读取此前的场景理解</span>
          </div>
        ) : explanation ? (
          <div className="understanding-result">
            <div className="understanding-result-time">
              <span>解释位置</span>
              <strong>{formatDuration(explanation.playbackCutoffMs)}</strong>
            </div>
            <section className="understanding-result-section facts-section">
              <div className="understanding-section-heading">
                <div>
                  <span>01</span>
                  <h3>当前可确认的事实</h3>
                </div>
                {hasMoreFacts ? (
                  <button
                    aria-controls="understanding-facts"
                    aria-expanded={factsExpanded}
                    className="understanding-disclosure"
                    type="button"
                    onClick={() => setFactsExpanded((value) => !value)}
                  >
                    {factsExpanded ? "收起部分" : "展开全部"}
                  </button>
                ) : null}
              </div>
              <ul id="understanding-facts">
                {visibleFacts.map((fact) => (
                  <li key={fact}>{fact}</li>
                ))}
              </ul>
            </section>
            <section
              className={`understanding-result-section interpretation ${
                interpretationExpanded ? "is-expanded" : "is-collapsed"
              }`}
            >
              <div className="understanding-section-heading">
                <div>
                  <span>02</span>
                  <h3>结合当前剧情的可能解读</h3>
                </div>
                <button
                  aria-controls="understanding-interpretation"
                  aria-expanded={interpretationExpanded}
                  className="understanding-disclosure"
                  type="button"
                  onClick={() => setInterpretationExpanded((value) => !value)}
                >
                  {interpretationExpanded ? "收起" : "展开"}
                </button>
              </div>
              <div
                className="understanding-disclosure-body"
                hidden={!interpretationExpanded}
                id="understanding-interpretation"
              >
                <ul>
                  {explanation.possibleInterpretations.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <p className="understanding-interpretation-note">
                  这是结合当前播放位置的可能解读，不代表影片后续已经给出结论。
                </p>
              </div>
            </section>
            {explanation.withheldReason ? (
              <p className="understanding-withheld">
                {explanation.withheldReason}
              </p>
            ) : null}
            <button
              className="button quiet understanding-again"
              type="button"
              onClick={resetForCurrentScene}
            >
              解释当前播放位置
            </button>
          </div>
        ) : !sourceVersion ? (
          <div className="understanding-empty">
            <strong>需要先准备原文字幕</strong>
            <p>场景理解以当前播放点之前的真实字幕和关键帧为依据。</p>
            <button
              className="button primary small"
              type="button"
              onClick={onPrepareSubtitles}
            >
              生成或导入原文字幕
            </button>
          </div>
        ) : !task ? (
          <div className="understanding-setup">
            <div className="understanding-intro">
              <strong>理解人物此刻为什么这样说</strong>
              <p>根据最近的字幕和最多三张关键帧，区分已确认事实与可能解读。</p>
            </div>
            <div className="understanding-handoff" aria-label="理解方式">
              <button
                className={handoff === "codex" ? "selected" : ""}
                type="button"
                onClick={() => setHandoff("codex")}
              >
                <strong>本机 Codex</strong>
                <small>完成后自动检查结果</small>
              </button>
              <button
                className={handoff === "manual" ? "selected" : ""}
                type="button"
                onClick={() => setHandoff("manual")}
              >
                <strong>复制提示词</strong>
                <small>交给自行选择的工具</small>
              </button>
            </div>
            {handoff === "codex" && runtime && !runtimeReady ? (
              <div className="understanding-runtime">
                <strong>本机 Codex 当前不可用</strong>
                <span>{runtime.errorMessage}</span>
              </div>
            ) : null}
            <div className="understanding-scope">
              <div>
                <span>接收方</span>
                <strong>
                  {handoff === "codex" ? "本机 Codex" : "自行选择的工具"}
                </strong>
              </div>
              <ul>
                <li>最近 60 秒内的原文字幕</li>
                {translationVersion ? <li>已有的简体中文字幕</li> : null}
                <li>不晚于当前播放点的最多三张关键帧</li>
              </ul>
              <p>不包含完整视频、音频、源媒体路径、数据库或凭证。</p>
            </div>
            <button
              className="button primary understanding-primary"
              type="button"
              disabled={
                busy ||
                playbackCutoffMs <= 0 ||
                (handoff === "codex" && !runtimeReady)
              }
              onClick={() => void prepare()}
            >
              {operation === "prepare" ? "正在准备…" : "确认范围并理解当前场景"}
            </button>
          </div>
        ) : task.status === "awaiting_external_result" ? (
          <div className="understanding-manual">
            <div className="understanding-task-heading">
              <span>等待其他 Agent 返回</span>
              <strong>复制文字并按提示附上关键帧</strong>
              <p>SiaoVPlay 不会自动发送材料，只检查受控返回目录。</p>
            </div>
            {task.errorMessage ? (
              <div className="notice danger" role="alert">
                <strong>返回结果未通过检查</strong>
                <p>{task.errorMessage}</p>
              </div>
            ) : null}
            <div className="understanding-manual-actions">
              <button
                className="button primary"
                type="button"
                disabled={!prompt || busy}
                onClick={() => void copyPrompt()}
              >
                复制完整提示词
              </button>
              <button
                className="button quiet"
                type="button"
                disabled={busy}
                onClick={() =>
                  void openExplanationMaterials(task.id).catch((cause) =>
                    setError(commandError(cause).message),
                  )
                }
              >
                打开 {task.frames.length} 张关键帧
              </button>
            </div>
            <button
              className="button quiet understanding-primary"
              type="button"
              disabled={busy}
              onClick={() => void openReturnDirectory()}
            >
              打开自动返回目录
            </button>
            <ol className="external-return-guide">
              <li>将完整提示词发送给聊天型 AI，并按提示附上关键帧。</li>
              <li>等待其返回一个纯 JSON 对象，只复制 JSON 本身。</li>
              <li>
                用记事本「另存为」result.json，文件类型选「所有文件」，编码选
                UTF-8。
              </li>
              <li>保存到自动返回目录；也可保存到其他位置后在下方手动选择。</li>
            </ol>
            {copyNotice ? <p role="status">{copyNotice}</p> : null}
            <button
              className="understanding-prompt-toggle"
              type="button"
              disabled={!prompt}
              onClick={() => setPromptExpanded((value) => !value)}
            >
              {promptExpanded ? "收起完整提示词" : "查看完整提示词"}
            </button>
            {promptExpanded && prompt ? (
              <textarea
                aria-label="场景理解完整提示词"
                readOnly
                value={prompt}
                onFocus={(event) => event.currentTarget.select()}
              ></textarea>
            ) : null}
            <button
              className={`understanding-result-file ${
                resultPath ? "selected" : ""
              }`}
              type="button"
              disabled={busy}
              onClick={() => void chooseResult()}
            >
              <span>
                <strong>
                  {resultPath
                    ? fileName(resultPath)
                    : "未自动识别？手动选择 JSON"}
                </strong>
                <small>只读取选择的结果文件</small>
              </span>
              <em>{resultPath ? "重新选择" : "选择…"}</em>
            </button>
            <button
              className="button primary understanding-primary"
              type="button"
              disabled={!resultPath || busy}
              onClick={() => void importResult()}
            >
              {operation === "import" ? "正在检查…" : "检查并显示解释"}
            </button>
            <button
              className="button text understanding-cancel"
              type="button"
              disabled={busy}
              onClick={() => void cancel()}
            >
              取消本次理解
            </button>
          </div>
        ) : running ? (
          <div className="understanding-running">
            <span className="spinner large"></span>
            <strong>{statusCopy(task)}</strong>
            <p>
              {task.handoffKind === "manual"
                ? "已自动检测到 result.json，正在核对播放范围和结果完整性。"
                : "可以继续观看；关闭面板不会中断本机处理。"}
            </p>
            <div
              aria-label="场景理解进度"
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={Math.round(task.progress * 100)}
              className="understanding-progress"
              role="progressbar"
            >
              <span style={{ width: `${Math.round(task.progress * 100)}%` }} />
            </div>
            <button
              className="button quiet"
              type="button"
              disabled={busy}
              onClick={() => void cancel()}
            >
              取消
            </button>
          </div>
        ) : (
          <div className="understanding-recovery">
            <strong>{statusCopy(task)}</strong>
            {task.errorMessage ? <p>{task.errorMessage}</p> : null}
            {canResume ? (
              <button
                className="button primary understanding-primary"
                type="button"
                disabled={busy}
                onClick={() => void resume()}
              >
                {operation === "resume" ? "正在重新开始…" : "重新开始"}
              </button>
            ) : null}
            <button
              className="button quiet understanding-again"
              type="button"
              disabled={busy}
              onClick={resetForCurrentScene}
            >
              新建当前场景理解
            </button>
          </div>
        )}

        {history.length > 1 ? (
          <details className="understanding-history">
            <summary>此前理解 · {history.length}</summary>
            <div>
              {history.slice(0, 8).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setFactsExpanded(false);
                    setInterpretationExpanded(true);
                    setExplanation(item);
                    setTask(null);
                  }}
                >
                  <span>{formatDuration(item.playbackCutoffMs)}</span>
                  <strong>{item.confirmedFacts[0] ?? "此前的场景理解"}</strong>
                </button>
              ))}
            </div>
          </details>
        ) : null}
      </div>
    </PanelElement>
  );
}
