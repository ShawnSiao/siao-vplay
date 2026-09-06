import { previewTranslationDispatch, type TranslationDispatchPreview } from "../features/ai-tasks/translationDispatch";
import { TranslationDispatchConfirm } from "../features/ai-tasks/TranslationDispatchConfirm";
import { AiExecutionConfirm } from "../features/ai-tasks/AiExecutionConfirm";
import { useAiExecutionChoice } from "../features/ai-tasks/useAiExecutionChoice";
import { prepareApiTranslation, startApiTranslation } from "../features/ai-tasks/apiTranslation";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  cancelTranslationTask,
  chooseTranslationResultFile,
  commandError,
  getCodexRuntimeStatus,
  getTranslationTask,
  importTranslationResult,
  listTranslationTasks,
  openExternalResultDirectory,
  prepareTranslationTask,
  readTranslationPrompt,
  resumeCodexTranslationTask,
  startCodexTranslationTask,
} from "../lib/desktop";
import type {
  CodexRuntimeStatus,
  SubtitleVersion,
  TranslationTask,
} from "../types";
import {
  defaultTargetLanguage,
  translationLanguageLabel,
} from "../config/translationLanguages";
import { TranslationDialogFrame } from "./TranslationDialogFrame";
import { TranslationLanguageSelectors } from "./TranslationLanguageSelectors";
import {
  copyTranslationPrompt,
  translationResultFileName,
  translationStatusTone,
  translationTaskStage,
  translationValidationCopy,
} from "./translationPresentation";

type TranslationDialogProps = {
  projectId: string;
  sourceVersion: SubtitleVersion | null;
  translationVersions: SubtitleVersion[];
  requestedSegmentIds?: string[];
  embedded?: boolean;
  onClose: () => void;
  onPrepareOriginal: () => void;
  onTaskCompleted: (
    task: TranslationTask,
    version?: SubtitleVersion,
  ) => Promise<void>;
};

const activeStatuses = new Set([
  "awaiting_external_result",
  "queued",
  "running",
  "validating",
]);

export function TranslationDialog({
  projectId,
  sourceVersion,
  translationVersions,
  requestedSegmentIds,
  embedded = false,
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
  const choice = useAiExecutionChoice(false);
  const { kind: handoff, setKind: setHandoff } = choice;
  const [sourceLanguageCode, setSourceLanguageCode] = useState(
    sourceVersion?.languageCode.toLowerCase() ?? "en",
  );
  const [targetLanguageCode, setTargetLanguageCode] = useState(() =>
    defaultTargetLanguage(sourceVersion?.languageCode ?? "en"),
  );
  const [runtime, setRuntime] = useState<CodexRuntimeStatus | null>(null);
  const [dispatch, setDispatch] = useState<TranslationDispatchPreview | null>(null);
  const [task, setTask] = useState<TranslationTask | null>(null);
  const [loading, setLoading] = useState(true);
  const [operation, setOperation] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<string | null>(null);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  const [resultPath, setResultPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const currentTranslation = useMemo(
    () =>
      translationVersions.find(
        (version) =>
          version.isCurrent &&
          version.languageCode.toLowerCase() === targetLanguageCode,
      ) ?? null,
    [targetLanguageCode, translationVersions],
  );
  const taskVersion =
    translationVersions.find((version) => version.id === task?.outputVersionId) ??
    null;
  const targetLanguageLabel = translationLanguageLabel(targetLanguageCode);
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
          const scopeMatches = requestedKey
            ? taskKey === requestedKey
            : item.segmentCount === sourceVersion?.segments.length;
          return (
            scopeMatches &&
            item.sourceLanguageCode.toLowerCase() ===
              sourceLanguageCode.toLowerCase() &&
            item.targetLanguageCode.toLowerCase() ===
              targetLanguageCode.toLowerCase()
          );
        };
        const currentTask =
          activeTask ??
          tasks.find(
            (item) =>
              taskMatchesSelection(item) &&
              item.sourceVersionId === sourceVersion?.id &&
              item.outputVersionId === currentTranslation?.id,
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
    setHandoff,
    requestedKey,
    sourceLanguageCode,
    sourceVersion?.id,
    sourceVersion?.segments.length,
    targetLanguageCode,
    currentTranslation?.id,
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
    if (translationVersions.some((version) => version.id === task.outputVersionId)) {
      notifiedTaskRef.current = task.id;
      return;
    }
    notifiedTaskRef.current = task.id;
    void onTaskCompleted(task);
  }, [onTaskCompleted, task, translationVersions]);

  const prepare = async () => {
    if (!sourceVersion) {
      return;
    }
    setOperation("prepare");
    setError(null);
    setCopyNotice(null);
    try {
      const prepared = handoff === "api" ? await prepareApiTranslation(projectId, sourceLanguageCode, targetLanguageCode,
        requestedSegmentIds, choice.execution, choice.authorization.serviceRevision ?? null) : requestedSegmentIds?.length
        ? await prepareTranslationTask(
            projectId,
            handoff,
            sourceLanguageCode,
            targetLanguageCode,
            requestedSegmentIds,
          )
        : await prepareTranslationTask(
            projectId,
            handoff,
            sourceLanguageCode,
            targetLanguageCode,
          );
      setTask(prepared);
      setDispatch(await previewTranslationDispatch(prepared.id));
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

  const reviewDispatch = async () => {
    if (!task) {
      return;
    }
    setOperation("start");
    setError(null);
    try {
      setDispatch(await previewTranslationDispatch(task.id));
    } catch (cause) {
      setError(commandError(cause).message);
    } finally {
      setOperation(null);
    }
  };

  const confirmDispatch = async () => {
    if (!task || !dispatch || task.id !== dispatch.taskId) return;
    setOperation("dispatch");
    setError(null);
    try {
      if (dispatch.handoffKind === "manual") {
        setPrompt(await readTranslationPrompt(task.id));
        setPromptExpanded(true);
      } else if (dispatch.handoffKind === "api") {
        setTask(await startApiTranslation(task.id, dispatch.confirmationSha256));
      } else {
        const run = task.status === "queued" ? startCodexTranslationTask : resumeCodexTranslationTask;
        setTask(await run(task.id, undefined, dispatch.confirmationSha256));
      }
      setDispatch(null);
    } catch (cause) {
      setError(commandError(cause).message);
      setDispatch(null);
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

  const copyPrompt = async () => {
    if (!prompt) return;
    const notice = await copyTranslationPrompt(prompt);
    setPromptExpanded(true);
    setCopyNotice(notice);
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

  const openReturnDirectory = async () => {
    if (!task) {
      return;
    }
    setError(null);
    try {
      await openExternalResultDirectory("translation", task.id);
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
    setDispatch(null);
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
    task?.handoffKind !== "manual" && task &&
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
          disabled={
            busy || choice.loading || (handoff === "api" && !choice.execution) ||
            sourceLanguageCode === targetLanguageCode ||
            (handoff === "codex" && !runtime?.available)
          }
          onClick={() => void prepare()}
        >
          {operation === "prepare"
            ? "正在准备…"
            : handoff !== "manual"
              ? "准备翻译材料"
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
          disabled={busy || (task.handoffKind === "codex" && !runtime?.available)}
          onClick={() => void reviewDispatch()}
        >
          {operation === "start" ? "正在启动…" : "查看发送清单"}
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
          {operation === "cancel"
            ? "正在取消…"
            : task.handoffKind === "manual"
              ? "取消任务"
              : "取消翻译"}
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
          {operation === "import"
            ? "正在检查并导入…"
            : `检查并生成${targetLanguageLabel}字幕`}
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
            disabled={busy || (task.handoffKind === "codex" && !runtime?.available)}
            onClick={() => void reviewDispatch()}
          >
            {operation === "resume" ? "正在重新开始…" : task.handoffKind === "api" ? "重试未完成批次" : "重新开始本机翻译"}
          </button>
        ) : null}
      </>
    );
  }

  const content = (
    <>
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
          <TranslationLanguageSelectors
            sourceLanguageCode={sourceLanguageCode}
            targetLanguageCode={targetLanguageCode}
            sourceVersionLanguageCode={sourceVersion.languageCode}
            sourceSegmentCount={sourceVersion.segments.length}
            selectedCount={selectedCount}
            isSelectedRetranslation={isSelectedRetranslation}
            onSourceLanguageChange={setSourceLanguageCode}
            onTargetLanguageChange={setTargetLanguageCode}
          />

          <AiExecutionConfirm controller={choice} runtime={runtime} allowFrames={false} translationAvailable={false} taskLabel="翻译" translationScope />

          <section className="translation-section">
            <div className="translation-section-heading">
              <h3>
                {handoff === "api" ? "准备翻译的内容" : handoff === "codex" ? "准备发送给 OpenAI（通过 Codex）" : "提示词包含"}
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
              <span className="status-pill ready">
                {targetLanguageLabel}字幕草稿
              </span>
              <h3>翻译完成，可以开始抽查</h3>
              <p>{translationValidationCopy(task.validation)}</p>
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
              <span>正在读取{targetLanguageLabel}字幕草稿</span>
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
                Agent 中执行；保存 result.json 后会自动检测。
              </p>
            </div>
          </div>
          {task.errorMessage ? (
            <div className="notice danger" role="alert">
              <strong>返回结果未通过检查</strong>
              <p>{task.errorMessage}</p>
            </div>
          ) : null}
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
              <strong>保存 result.json</strong>
              <small>放入自动返回目录后会自动检查。</small>
            </div>
          </div>
          <button
            className="button quiet"
            type="button"
            disabled={busy}
            onClick={() => void openReturnDirectory()}
          >
            打开自动返回目录
          </button>
          <ol className="external-return-guide">
            <li>聊天型 AI 返回后，只复制 JSON，不包含说明或 Markdown 代码围栏。</li>
            <li>
              用记事本「另存为」result.json，文件类型选「所有文件」，编码选
              UTF-8。
            </li>
            <li>保存到自动返回目录；也可保存到其他位置后在下方手动选择。</li>
          </ol>
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
                {resultPath
                  ? translationResultFileName(resultPath)
                  : "未自动识别？手动选择 JSON"}
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
              <span className={`status-pill ${translationStatusTone(task)}`}>
                {task.status === "queued"
                  ? "等待开始"
                  : task.handoffKind === "manual"
                    ? "正在检查"
                    : "翻译中"}
              </span>
              <h3>{translationTaskStage(task)}</h3>
              <p>
                {task.handoffKind === "manual"
                  ? "已自动检测到 result.json，正在核对任务、版本和字幕范围。"
                  : "只处理受控字幕文本。可以关闭窗口；应用退出造成中断后可重新开始。"}
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
              <strong>{translationLanguageLabel(task.targetLanguageCode)}</strong>
            </div>
            <div>
              <small>字幕段</small>
              <strong>{task.segmentCount}</strong>
            </div>
          </div>
        </div>
      ) : (
        <div className="translation-failed">
          <span className={`status-pill ${translationStatusTone(task)}`}>
            {task.status === "failed"
              ? "处理失败"
              : task.status === "interrupted"
                ? "处理已中断"
                : "任务已取消"}
          </span>
          <h3>{translationTaskStage(task)}</h3>
          <p>
            {task.errorMessage ??
              `原文字幕和已有${targetLanguageLabel}字幕没有改变。`}
          </p>
          <p className="translation-recovery-note">
            重新开始会从受控任务包的第一批字幕开始，不复用未确认的中间结果。
          </p>
        </div>
      )}

      {error ? (
        <div className="notice danger translation-error" role="alert">
          <strong>{targetLanguageLabel}字幕处理没有完成</strong>
          <p>{error}</p>
        </div>
      ) : null}
    </>
  );

  return (
    <TranslationDialogFrame
      title={
        isSelectedRetranslation
          ? "重新翻译选中字幕"
          : `生成${targetLanguageLabel}字幕`
      }
      eyebrow={
        isSelectedRetranslation
          ? `只处理选中的 ${selectedCount} 条原文字幕`
          : "原文字幕保持不变，结果先保存为草稿"
      }
      embedded={embedded}
      running={Boolean(running)}
      busy={busy}
      onClose={onClose}
      actions={dispatch ? null : actions}
    >
      {dispatch ? <>
        <TranslationDispatchConfirm preview={dispatch} busy={busy} onConfirm={() => void confirmDispatch()} onBack={() => setDispatch(null)} />
        {error ? <div className="notice warning" role="alert">{error}</div> : null}
      </> : content}
    </TranslationDialogFrame>
  );
}
