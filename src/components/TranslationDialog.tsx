import { useEffect, useMemo, useRef, useState } from "react";

import {
  cancelTranslationTask,
  chooseTranslationResultFile,
  commandError,
  getCodexRuntimeStatus,
  getTranslationTask,
  importTranslationResult,
  listTranslationTasks,
  prepareTranslationTask,
  readTranslationPrompt,
  resumeCodexTranslationTask,
  startCodexTranslationTask,
} from "../lib/desktop";
import type {
  CodexRuntimeStatus,
  SubtitleVersion,
  TranslationTask,
  TranslationValidation,
} from "../types";
import { Dialog } from "./Dialog";

type TranslationDialogProps = {
  projectId: string;
  sourceVersion: SubtitleVersion | null;
  translationVersion: SubtitleVersion | null;
  requestedSegmentIds?: string[];
  onClose: () => void;
  onPrepareOriginal: () => void;
  onTaskCompleted: (
    task: TranslationTask,
    version?: SubtitleVersion,
  ) => Promise<void>;
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

function taskStage(task: TranslationTask): string {
  if (task.status === "awaiting_external_result") {
    return "等待导入 Agent 返回的结果";
  }
  if (task.status === "queued") {
    return "任务已经准备好，等待启动本机 Codex";
  }
  if (task.status === "validating") {
    return "正在检查任务、版本、字幕范围和完整性";
  }
  if (task.status === "completed") {
    return "简体中文字幕草稿已经生成";
  }
  if (task.status === "interrupted") {
    return "应用上次关闭时任务尚未完成";
  }
  if (task.status === "cancelled") {
    return "任务已经取消";
  }
  if (task.status === "failed") {
    return "任务处理失败";
  }
  const match = /^translating_batch_(\d+)_of_(\d+)$/.exec(task.stage);
  if (match) {
    return `正在翻译第 ${match[1]} / ${match[2]} 批字幕`;
  }
  return "正在启动本机 Codex";
}

function statusTone(task: TranslationTask): string {
  if (task.status === "completed") {
    return "ready";
  }
  if (task.status === "failed") {
    return "danger";
  }
  if (task.status === "cancelled" || task.status === "interrupted") {
    return "warning";
  }
  return "agent";
}

function validationCopy(validation: TranslationValidation | null): string {
  if (!validation) {
    return "结构检查通过后仍需抽查人名、称谓和人物语气。";
  }
  return validation.warningCount > 0
    ? `结构检查通过，另有 ${validation.warningCount} 项一致性提示。`
    : `已检查 ${validation.translationCount} 条字幕的任务、版本、范围和完整性。`;
}

export function TranslationDialog({
  projectId,
  sourceVersion,
  translationVersion,
  requestedSegmentIds,
  onClose,
  onPrepareOriginal,
  onTaskCompleted,
}: TranslationDialogProps) {
  const notifiedTaskRef = useRef<string | null>(null);
  const requestedKey = [...(requestedSegmentIds ?? [])].sort().join("|");
  const requestedSet = useMemo(
    () => new Set(requestedSegmentIds ?? []),
    [requestedSegmentIds],
  );
  const selectedCount = requestedSet.size || sourceVersion?.segments.length || 0;
  const isSelectedRetranslation =
    requestedSet.size > 0 &&
    requestedSet.size < (sourceVersion?.segments.length ?? 0);
  const [handoff, setHandoff] = useState<HandoffKind>("codex");
  const [runtime, setRuntime] = useState<CodexRuntimeStatus | null>(null);
  const [task, setTask] = useState<TranslationTask | null>(null);
  const [loading, setLoading] = useState(true);
  const [operation, setOperation] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<string | null>(null);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  const [resultPath, setResultPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const taskVersion =
    task?.outputVersionId === translationVersion?.id
      ? translationVersion
      : null;
  const sourceById = useMemo(
    () =>
      new Map(
        sourceVersion?.segments.map((segment) => [segment.id, segment]) ?? [],
      ),
    [sourceVersion],
  );

  useEffect(() => {
    let active = true;
    void Promise.all([
      getCodexRuntimeStatus(),
      listTranslationTasks(projectId),
    ])
      .then(([nextRuntime, tasks]) => {
        if (!active) {
          return;
        }
        setRuntime(nextRuntime);
        const activeTask = tasks.find((item) => activeStatuses.has(item.status));
        const taskMatchesSelection = (item: TranslationTask) => {
          const taskKey = [...item.authorizedSegmentIds].sort().join("|");
          if (requestedKey) {
            return taskKey === requestedKey;
          }
          return item.segmentCount === sourceVersion?.segments.length;
        };
        const currentTask =
          activeTask ??
          tasks.find(
            (item) =>
              taskMatchesSelection(item) &&
              item.sourceVersionId === sourceVersion?.id &&
              item.outputVersionId === translationVersion?.id,
          ) ??
          tasks.find(
            (item) =>
              taskMatchesSelection(item) &&
              item.sourceVersionId === sourceVersion?.id,
          ) ??
          null;
        setTask(currentTask);
        if (currentTask) {
          setHandoff(currentTask.handoffKind);
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
  }, [
    projectId,
    requestedKey,
    sourceVersion?.id,
    sourceVersion?.segments.length,
    translationVersion?.id,
  ]);

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
    void readTranslationPrompt(task.id)
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
    if (!task || !["running", "validating"].includes(task.status)) {
      return;
    }
    let active = true;
    const timer = window.setInterval(() => {
      void getTranslationTask(task.id)
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
      notifiedTaskRef.current === task.id
    ) {
      return;
    }
    if (translationVersion?.id === task.outputVersionId) {
      notifiedTaskRef.current = task.id;
      return;
    }
    notifiedTaskRef.current = task.id;
    void onTaskCompleted(task);
  }, [onTaskCompleted, task, translationVersion?.id]);

  const prepare = async () => {
    if (!sourceVersion) {
      return;
    }
    setOperation("prepare");
    setError(null);
    setCopyNotice(null);
    try {
      const prepared = requestedSegmentIds?.length
        ? await prepareTranslationTask(projectId, handoff, requestedSegmentIds)
        : await prepareTranslationTask(projectId, handoff);
      setTask(prepared);
      if (handoff === "codex") {
        const started = await startCodexTranslationTask(prepared.id);
        setTask(started);
      } else {
        const value = await readTranslationPrompt(prepared.id);
        setPrompt(value);
        setPromptExpanded(true);
      }
    } catch (cause) {
      setError(commandError(cause).message);
      const tasks = await listTranslationTasks(projectId).catch(() => []);
      const activeTask = tasks.find((item) => activeStatuses.has(item.status));
      if (activeTask) {
        setTask(activeTask);
      }
    } finally {
      setOperation(null);
    }
  };

  const startQueued = async () => {
    if (!task) {
      return;
    }
    setOperation("start");
    setError(null);
    try {
      setTask(await startCodexTranslationTask(task.id));
    } catch (cause) {
      setError(commandError(cause).message);
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
      setTask(await cancelTranslationTask(task.id));
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
      setTask(await resumeCodexTranslationTask(task.id));
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
      setCopyNotice("系统未授权自动复制，可以在下方选择完整提示词。");
      return;
    }
    try {
      await navigator.clipboard.writeText(prompt);
      setCopyNotice("完整任务提示词已复制。");
    } catch {
      setPromptExpanded(true);
      setCopyNotice("自动复制没有完成，可以在下方选择完整提示词。");
    }
  };

  const chooseResult = async () => {
    setError(null);
    try {
      const path = await chooseTranslationResultFile();
      if (path) {
        setResultPath(path);
      }
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
      const application = await importTranslationResult(task.id, resultPath);
      notifiedTaskRef.current = application.task.id;
      setTask(application.task);
      await onTaskCompleted(application.task, application.subtitleVersion);
    } catch (cause) {
      setError(commandError(cause).message);
    } finally {
      setOperation(null);
    }
  };

  const resetToSetup = () => {
    setTask(null);
    setPrompt(null);
    setPromptExpanded(false);
    setResultPath(null);
    setCopyNotice(null);
    setError(null);
  };

  const busy = operation !== null;
  const setup = !task;
  const running = task && ["running", "validating"].includes(task.status);
  const canResume =
    task?.handoffKind === "codex" &&
    ["failed", "cancelled", "interrupted"].includes(task.status);

  let actions: React.ReactNode = (
    <button className="button quiet" type="button" onClick={onClose}>
      关闭
    </button>
  );
  if (setup && sourceVersion) {
    actions = (
      <>
        <button className="button quiet" type="button" onClick={onClose}>
          取消
        </button>
        <button
          className="button primary"
          type="button"
          disabled={busy || (handoff === "codex" && !runtime?.available)}
          onClick={() => void prepare()}
        >
          {operation === "prepare"
            ? "正在准备…"
            : handoff === "codex"
              ? "确认范围并开始翻译"
              : "生成完整任务提示词"}
        </button>
      </>
    );
  } else if (task?.status === "queued") {
    actions = (
      <>
        <button
          className="button quiet"
          type="button"
          disabled={busy}
          onClick={() => void cancel()}
        >
          取消任务
        </button>
        <button
          className="button primary"
          type="button"
          disabled={busy || !runtime?.available}
          onClick={() => void startQueued()}
        >
          {operation === "start" ? "正在启动…" : "开始本机翻译"}
        </button>
      </>
    );
  } else if (running) {
    actions = (
      <>
        <button className="button quiet" type="button" onClick={onClose}>
          关闭窗口
        </button>
        <button
          className="button danger"
          type="button"
          disabled={busy}
          onClick={() => void cancel()}
        >
          {operation === "cancel" ? "正在取消…" : "取消翻译"}
        </button>
      </>
    );
  } else if (task?.status === "awaiting_external_result") {
    actions = (
      <>
        <button
          className="button quiet"
          type="button"
          disabled={busy}
          onClick={() => void cancel()}
        >
          取消任务
        </button>
        <button
          className="button"
          type="button"
          disabled={!prompt || busy}
          onClick={() => void copyPrompt()}
        >
          复制完整提示词
        </button>
        <button
          className="button primary"
          type="button"
          disabled={!resultPath || busy}
          onClick={() => void importResult()}
        >
          {operation === "import" ? "正在检查并导入…" : "检查并生成中文字幕"}
        </button>
      </>
    );
  } else if (task?.status === "completed") {
    actions = (
      <>
        <button className="button quiet" type="button" onClick={resetToSetup}>
          重新生成
        </button>
        <button className="button primary" type="button" onClick={onClose}>
          返回观看
        </button>
      </>
    );
  } else if (task) {
    actions = (
      <>
        <button className="button quiet" type="button" onClick={resetToSetup}>
          改用其他方式
        </button>
        {canResume ? (
          <button
            className="button primary"
            type="button"
            disabled={busy || !runtime?.available}
            onClick={() => void resume()}
          >
            {operation === "resume" ? "正在重新开始…" : "重新开始本机翻译"}
          </button>
        ) : null}
      </>
    );
  }

  return (
    <Dialog
      title={isSelectedRetranslation ? "重新翻译选中字幕" : "生成简体中文字幕"}
      eyebrow={
        isSelectedRetranslation
          ? `只处理选中的 ${selectedCount} 条原文字幕`
          : "原文字幕保持不变，结果先保存为草稿"
      }
      onClose={running ? onClose : busy ? () => undefined : onClose}
      actions={actions}
    >
      {loading ? (
        <div className="translation-loading" role="status">
          <span className="spinner"></span>
          <span>正在读取翻译状态</span>
        </div>
      ) : !sourceVersion ? (
        <div className="translation-empty">
          <span className="translation-empty-mark">原</span>
          <div>
            <h3>先准备原文字幕</h3>
            <p>
              可以导入现有字幕；英语、泰语、日语和韩语也可以从原声生成。
            </p>
            <button
              className="button primary"
              type="button"
              onClick={onPrepareOriginal}
            >
              准备原文字幕
            </button>
          </div>
        </div>
      ) : setup ? (
        <div className="translation-setup">
          <div className="translation-source-summary">
            <div>
              <span>当前原文</span>
              <strong>{sourceVersion.sourceLabel}</strong>
              <small>
                {sourceVersion.languageCode.toUpperCase()} ·{" "}
                {sourceVersion.segments.length} 条 · 版本{" "}
                {sourceVersion.versionNumber}
              </small>
            </div>
            <span className="translation-arrow">→</span>
            <div>
              <span>目标字幕</span>
              <strong>简体中文</strong>
              <small>
                {isSelectedRetranslation
                  ? `更新 ${selectedCount} 条 · 其余译文保持不变`
                  : "独立草稿 · 不覆盖原文"}
              </small>
            </div>
          </div>

          <section className="translation-section">
            <h3>选择处理方式</h3>
            <div className="translation-handoff-options">
              <button
                className={handoff === "codex" ? "selected" : ""}
                type="button"
                onClick={() => setHandoff("codex")}
              >
                <span>
                  <strong>在本机 Codex 中处理</strong>
                  <small>任务完成后自动检查结果并生成草稿。</small>
                </span>
                <em
                  className={`status-pill ${
                    runtime?.available ? "ready" : "warning"
                  }`}
                >
                  {runtime?.available ? "本机已就绪" : "当前不可使用"}
                </em>
              </button>
              <button
                className={handoff === "manual" ? "selected" : ""}
                type="button"
                onClick={() => setHandoff("manual")}
              >
                <span>
                  <strong>复制任务提示词</strong>
                  <small>交给自行选择的 Agent，再导入 result.json。</small>
                </span>
                <em className="status-pill">不会自动发送</em>
              </button>
            </div>
            {handoff === "codex" && runtime && !runtime.available ? (
              <div className="notice warning translation-runtime-notice">
                <strong>本机 Codex 还不能开始</strong>
                <p>{runtime.errorMessage}</p>
              </div>
            ) : null}
          </section>

          <section className="translation-section">
            <div className="translation-section-heading">
              <h3>
                {handoff === "codex" ? "将发送给本机 Codex" : "提示词包含"}
              </h3>
              <span>点击底部操作前不会处理</span>
            </div>
            <div className="translation-scope-grid">
              {[
                [
                  isSelectedRetranslation
                    ? "选中的原文字幕文本"
                    : "原文字幕文本",
                  `${selectedCount} 条`,
                ],
                ["字幕时间码", "用于保持播放同步"],
                ["任务与字幕版本标识", "用于拒绝过期结果"],
                ["人物与术语上下文", "当前为空"],
              ].map(([label, detail]) => (
                <div key={label}>
                  <span className="scope-check">✓</span>
                  <span>
                    <strong>{label}</strong>
                    <small>{detail}</small>
                  </span>
                </div>
              ))}
            </div>
            <p className="translation-excluded">
              不包含视频、音频、本机媒体路径、项目数据库、凭证或账号信息。
            </p>
          </section>
        </div>
      ) : task.status === "completed" ? (
        <div className="translation-complete">
          <div className="translation-result-heading">
            <div>
              <span className="status-pill ready">中文字幕草稿</span>
              <h3>翻译完成，可以开始抽查</h3>
              <p>{validationCopy(task.validation)}</p>
            </div>
            <strong>{task.segmentCount} 条</strong>
          </div>
          {task.validation?.warnings.length ? (
            <ul className="translation-warning-list">
              {task.validation.warnings.slice(0, 4).map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : null}
          {taskVersion ? (
            <div className="translation-samples">
              {taskVersion.segments
                .filter(
                  (segment) =>
                    !isSelectedRetranslation ||
                    (segment.sourceSegmentId !== null &&
                      requestedSet.has(segment.sourceSegmentId)),
                )
                .slice(0, 4)
                .map((segment) => {
                const source = segment.sourceSegmentId
                  ? sourceById.get(segment.sourceSegmentId)
                  : null;
                return (
                  <div key={segment.id}>
                    <span>{source?.text ?? "原文字幕段"}</span>
                    <strong>{segment.text}</strong>
                  </div>
                );
                })}
            </div>
          ) : (
            <div className="translation-loading" role="status">
              <span className="spinner"></span>
              <span>正在读取中文字幕草稿</span>
            </div>
          )}
        </div>
      ) : task.status === "awaiting_external_result" ? (
        <div className="translation-manual">
          <div className="translation-task-heading">
            <div>
              <span className="status-pill agent">等待 Agent 返回</span>
              <h3>完整任务提示词已经生成</h3>
              <p>
                SiaoVPlay 不会自动发送材料。复制提示词后，在自行选择的
                Agent 中执行，再导入返回的 JSON 文件。
              </p>
            </div>
          </div>
          <div className="translation-manual-steps">
            <div>
              <span>1</span>
              <strong>复制完整提示词</strong>
              <small>包含字幕、时间码、版本和返回结构。</small>
            </div>
            <div>
              <span>2</span>
              <strong>让 Agent 只返回 JSON</strong>
              <small>不要修改任务 ID 和字幕段 ID。</small>
            </div>
            <div>
              <span>3</span>
              <strong>导入 result.json</strong>
              <small>SiaoVPlay 会重新检查全部结果。</small>
            </div>
          </div>
          <button
            className="translation-prompt-toggle"
            type="button"
            disabled={!prompt}
            onClick={() => setPromptExpanded((value) => !value)}
          >
            {promptExpanded ? "收起完整提示词" : "查看完整提示词"}
          </button>
          {promptExpanded && prompt ? (
            <textarea
              className="translation-prompt"
              aria-label="完整任务提示词"
              readOnly
              value={prompt}
              onFocus={(event) => event.currentTarget.select()}
            ></textarea>
          ) : null}
          {copyNotice ? (
            <p className="translation-inline-notice" role="status">
              {copyNotice}
            </p>
          ) : null}
          <button
            className={`translation-result-picker ${
              resultPath ? "selected" : ""
            }`}
            type="button"
            disabled={busy}
            onClick={() => void chooseResult()}
          >
            <span>
              <strong>
                {resultPath ? fileName(resultPath) : "选择 Agent 返回的 JSON"}
              </strong>
              <small>
                {resultPath
                  ? "只读取这个结果文件，不读取同目录其他内容。"
                  : "选择后将在本机检查任务、版本和字幕范围。"}
              </small>
            </span>
            <em>{resultPath ? "重新选择" : "选择…"}</em>
          </button>
        </div>
      ) : running || task.status === "queued" ? (
        <div className="translation-running">
          <div className="translation-task-heading">
            <div>
              <span className={`status-pill ${statusTone(task)}`}>
                {task.status === "queued" ? "等待开始" : "本机处理中"}
              </span>
              <h3>{taskStage(task)}</h3>
              <p>
                只处理受控字幕文本。可以关闭窗口；应用退出造成中断后可重新开始。
              </p>
            </div>
            <strong>{Math.round(task.progress * 100)}%</strong>
          </div>
          <div
            className="translation-progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(task.progress * 100)}
          >
            <span style={{ width: `${Math.round(task.progress * 100)}%` }}></span>
          </div>
          <div className="translation-task-facts">
            <div>
              <small>接收方</small>
              <strong>{task.receiverLabel}</strong>
            </div>
            <div>
              <small>原文</small>
              <strong>{task.sourceLanguageCode.toUpperCase()}</strong>
            </div>
            <div>
              <small>目标</small>
              <strong>简体中文</strong>
            </div>
            <div>
              <small>字幕段</small>
              <strong>{task.segmentCount}</strong>
            </div>
          </div>
        </div>
      ) : (
        <div className="translation-failed">
          <span className={`status-pill ${statusTone(task)}`}>
            {task.status === "failed"
              ? "处理失败"
              : task.status === "interrupted"
                ? "处理已中断"
                : "任务已取消"}
          </span>
          <h3>{taskStage(task)}</h3>
          <p>{task.errorMessage ?? "原文字幕和已有中文字幕没有改变。"}</p>
          <p className="translation-recovery-note">
            重新开始会从受控任务包的第一批字幕开始，不复用未确认的中间结果。
          </p>
        </div>
      )}

      {error ? (
        <div className="notice danger translation-error" role="alert">
          <strong>中文字幕处理没有完成</strong>
          <p>{error}</p>
        </div>
      ) : null}
    </Dialog>
  );
}
