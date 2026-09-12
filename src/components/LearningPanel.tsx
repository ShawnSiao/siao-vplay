import { useCodexDetection } from "../features/ai-tasks/useCodexDetection";
import { CodexDetectionNotice } from "../features/ai-tasks/CodexDetectionNotice";
import { useLearningPolling } from "../features/learning/useLearningPolling";
import { findLearningHistory } from "../features/learning/learningHistory";
import { requireLearningResult } from "../lib/learningResult";
import { AiTaskDispatchConfirm } from "../features/ai-tasks/AiTaskDispatchConfirm";
import { executeLearningDispatch, previewTaskDispatch, type TaskDispatchPreview } from "../features/ai-tasks/taskDispatch";
import { useEffect, useMemo, useRef, useState } from "react";

import "../features/learning/learning-speech.css";
import "../features/learning/learning-context.css";

import {
  cancelLearningTask,
  chooseLearningExportDirectory,
  chooseLearningResultFile,
  commandError,
  createLearningCard,
  deleteLearningCard,
  exportLearningCards,
  getCodexRuntimeStatus,
  getDictionaryEntry,
  getLearningTask,
  importLearningResult,
  listDictionaryEntries,
  listLearningCards,
  listLearningTasks,
  openExternalResultDirectory,
  prepareLearningTask,
  readLearningPrompt,
} from "../lib/desktop";
import type {
  DictionaryEntry,
  LearningCard,
  LearningTask,
  SubtitleSegment,
  SubtitleVersion,
} from "../types";
import { AiTaskExecutionSetup } from "../features/ai-tasks/AiTaskExecutionSetup";
import { prepareAiLearningTask } from "../features/ai-tasks/gateway";
import {
  useAiExecutionChoice,
} from "../features/ai-tasks/useAiExecutionChoice";
import { LearningCardsSection } from "../features/learning/LearningCardsSection";
import { LearningResultSection } from "../features/learning/LearningResultSection";
import { LearningSelectionSection } from "../features/learning/LearningSelectionSection";
import { selectionKind, splitForSelection } from "../features/learning/learningSelection";
import { useLocalSpeech } from "../features/learning/useLocalSpeech";
import { loadLearningDraft, writeLearningDraft, discardLearningDraft } from "../features/learning/learningDraft";
import { readLearningContextReference } from "../features/learning/learningTaskContext";
import { useLearningTaskContext } from "../features/learning/useLearningTaskContext";
import { useLearningContext } from "../features/learning/learningContext";

type LearningPanelProps = {
  visible?: boolean;
  projectId: string;
  playbackPositionMs: number;
  sourceVersion: SubtitleVersion | null;
  translationVersion: SubtitleVersion | null;
  sourceSegment: SubtitleSegment | null;
  translationSegment: SubtitleSegment | null;
  onPrepareSubtitles: () => void;
  onClose: () => void;
  embedded?: boolean;
  onJump: (positionMs: number) => void;
  onPausePlayback: () => void;
};

const activeStatuses = new Set([
  "awaiting_external_result",
  "queued",
  "running",
  "validating",
]);

function statusCopy(task: LearningTask): string {
  if (task.stage === "cancelling") return "正在取消请求…";
  if (task.status === "completed") return "结果已生成，可以重新读取";
  if (task.status === "queued") {
    return "材料已准备好，请查看发送清单";
  }
  if (task.status === "running") {
    return "正在查询这句台词里的用法";
  }
  if (task.status === "validating") {
    return "正在检查查询范围和结果";
  }
  if (task.status === "interrupted") {
    return "应用上次关闭时查询尚未完成";
  }
  if (task.status === "cancelled") {
    return "本次查询已取消";
  }
  return task.errorMessage ?? "本次查询没有完成";
}

function fileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? "result.json";
}

export function LearningPanel(props: LearningPanelProps) {
  return <LearningPanelSession key={props.projectId} {...props} />;
}

function LearningPanelSession({
  visible = true,
  projectId,
  playbackPositionMs: livePositionMs,
  sourceVersion: liveSourceVersion,
  translationVersion: liveTranslationVersion,
  sourceSegment: liveSourceSegment,
  translationSegment: liveTranslationSegment,
  onPrepareSubtitles,
  onClose,
  embedded = false,
  onJump,
  onPausePlayback,
}: LearningPanelProps) {
  const [savedDraft, setSavedDraft] = useState(() => loadLearningDraft(projectId));
  const [bootstrapAttempt, setBootstrapAttempt] = useState(0);
  const [bootstrapFailed, setBootstrapFailed] = useState(false);
  const [draftSaveError, setDraftSaveError] = useState<string | null>(null);
  const learningContext = useLearningContext({ projectId, playbackPositionMs: livePositionMs,
    sourceVersion: liveSourceVersion, translationVersion: liveTranslationVersion,
    sourceSegment: liveSourceSegment, translationSegment: liveTranslationSegment });
  const { playbackPositionMs, sourceVersion, translationVersion, sourceSegment, translationSegment } = learningContext.context;
  const [initialContext] = useState(learningContext.context);
  const restoreLearningContext = learningContext.restoreContext;
  const handledCompletionRef = useRef<string | null>(null);
  const [resultReadAttempt, setResultReadAttempt] = useState(0);
  const selectableParts = useMemo(
    () =>
      splitForSelection(
        sourceSegment?.text ?? "",
        sourceVersion?.languageCode ?? "und",
      ),
    [sourceSegment?.text, sourceVersion?.languageCode],
  );
  const [selectedText, setSelectedText] = useState(savedDraft.draft?.selectedText ?? sourceSegment?.text ?? "");
  const executionChoice = useAiExecutionChoice(false, savedDraft.draft?.execution);
  const codexDetection = useCodexDetection(getCodexRuntimeStatus);
  const { runtime } = codexDetection;
  const [task, setTask] = useState<LearningTask | null>(null);
  const recovery = useLearningTaskContext(task, learningContext.context, (context, text) => {
    learningContext.restoreContext(context);
    setSelectedText(text);
  });
  const [dispatch, setDispatch] = useState<TaskDispatchPreview | null>(null);
  const [entry, setEntry] = useState<DictionaryEntry | null>(null);
  const [entries, setEntries] = useState<DictionaryEntry[]>([]);
  const [cards, setCards] = useState<LearningCard[]>([]);
  const [prompt, setPrompt] = useState<string | null>(null);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [resultPath, setResultPath] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [operation, setOperation] = useState<string | null>(null);
  const speech = useLocalSpeech({
    language: sourceVersion?.languageCode ?? "und",
    onBeforeSpeak: onPausePlayback,
  });
  const stopSpeech = speech.stop;
  useEffect(() => {
    if (!visible) stopSpeech();
  }, [visible, stopSpeech]);

  const kind = selectionKind(
    selectedText,
    sourceSegment?.text ?? "",
    selectableParts,
  );
  const selectionValid =
    Boolean(selectedText.trim()) &&
    Boolean(sourceSegment?.text.includes(selectedText.trim()));

  useEffect(() => {
    let active = true;
    void Promise.all([
      listLearningTasks(projectId),
      listDictionaryEntries(projectId),
      listLearningCards(projectId),
    ])
      .then(async ([tasks, nextEntries, nextCards]) => {
        if (!active) {
          return;
        }
        setEntries(nextEntries);
        setCards(nextCards);
        const activeTask = tasks.find((item) => activeStatuses.has(item.status))
          ?? (tasks[0] && ["failed", "interrupted"].includes(tasks[0].status) ? tasks[0] : null);
        if (savedDraft.error) throw new Error(savedDraft.error);
        if (activeTask && (activeStatuses.has(activeTask.status) || !savedDraft.draft || savedDraft.draft.taskId === activeTask.id)) {
          setTask(activeTask);
        } else if (savedDraft.draft) {
          const restored = await readLearningContextReference(savedDraft.draft, initialContext);
          if (!active) return;
          restoreLearningContext(restored);
          setSelectedText(savedDraft.draft.selectedText);
          setEntry(findLearningHistory(nextEntries, restored, savedDraft.draft.selectedText));
        } else {
          setEntry(findLearningHistory(nextEntries, initialContext, initialContext.sourceSegment?.text ?? ""));
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(commandError(cause).message);
          setBootstrapFailed(true);
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
  }, [projectId, initialContext, savedDraft, bootstrapAttempt, restoreLearningContext]);

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
    void readLearningPrompt(task.id)
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

  useLearningPolling({ projectId, task, read: getLearningTask,
    onTask: next => setTask(current => current?.id === next.id && current.projectId === next.projectId && activeStatuses.has(current.status) ? next : current),
    onError: cause => setError(commandError(cause).message) });

  useEffect(() => {
    if (
      !task ||
      task.status !== "completed" ||
      !task.outputDictionaryEntryId ||
      handledCompletionRef.current === task.id
    ) {
      return;
    }
    let active = true;
    void getDictionaryEntry(task.outputDictionaryEntryId)
      .then((value) => {
        if (!active) return;
        requireLearningResult(value, task);
        handledCompletionRef.current = task.id;
        setError(null);
        setEntry(value);
        setEntries((current) => [
          value,
          ...current.filter((item) => item.id !== value.id),
        ]);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setError(commandError(cause).message);
      });
    return () => { active = false; };
  }, [task, resultReadAttempt]);

  useEffect(() => {
    if (loading || bootstrapFailed || recovery.blocked || executionChoice.loading) return;
    let active = true;
    try {
      writeLearningDraft(learningContext.context, selectedText, task?.id ?? null, {
        kind: executionChoice.kind, serviceId: executionChoice.serviceId, modelId: executionChoice.modelId,
      });
      queueMicrotask(() => { if (active) setDraftSaveError(null); });
    } catch (cause) { queueMicrotask(() => { if (active) setDraftSaveError(commandError(cause).message); }); }
    return () => { active = false; };
  }, [loading, bootstrapFailed, recovery.blocked, executionChoice.loading, executionChoice.kind,
    executionChoice.serviceId, executionChoice.modelId, learningContext.context, selectedText, task?.id]);

  const selectText = (value: string) => {
    if (operation || (task && activeStatuses.has(task.status))) return;
    setSelectedText(value);
    setTask(null);
    setDispatch(null);
    setEntry(findLearningHistory(entries, learningContext.context, value));
    setPrompt(null);
    setPromptExpanded(false);
    setResultPath(null);
    setNotice(null);
    setError(null);
  };

  const prepare = async () => {
    if (recovery.blocked || !sourceSegment || !selectionValid) {
      return;
    }
    setOperation("prepare");
    setError(null);
    setNotice(null);
    try {
      const normalized = selectedText.trim();
      const choice = executionChoice.kind === "api" ? await executionChoice.preview() : null;
      const kind = selectionKind(normalized, sourceSegment.text, selectableParts);
      const prepared = choice ? await prepareAiLearningTask({
        projectId, sourceSegmentId: sourceSegment.id, selectedText: normalized,
        selectionKind: kind, playbackPositionMs, execution: choice.execution, authorization: choice.authorization,
      }) : await prepareLearningTask(projectId, executionChoice.kind === "manual" ? "manual" : "codex", sourceSegment.id, normalized, kind, playbackPositionMs);
      setTask(prepared);
      setEntry(null);
      setDispatch(await previewTaskDispatch("learning", prepared.id));
    } catch (cause) {
      setError(commandError(cause).message);
      const tasks = await listLearningTasks(projectId).catch(() => []);
      const activeTask = tasks.find((item) => activeStatuses.has(item.status));
      if (activeTask) {
        setTask(activeTask);
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
      setTask(await cancelLearningTask(task.id));
      setDispatch(null);
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
      setDispatch(await previewTaskDispatch("learning", task.id));
    } catch (cause) {
      setError(commandError(cause).message);
    } finally {
      setOperation(null);
    }
  };

  const confirmDispatch = async () => {
    if (recovery.blocked || !task || !dispatch) return;
    setOperation("dispatch");
    setError(null);
    try {
      setTask(await executeLearningDispatch(task, dispatch));
      if (dispatch.execution.kind === "manual") {
        setPrompt(await readLearningPrompt(task.id));
        setPromptExpanded(true);
      }
      setDispatch(null);
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
    if (!navigator.clipboard?.writeText) {
      setPromptExpanded(true);
      setNotice("无法自动复制，可以在下方选择完整提示词。");
      return;
    }
    try {
      await navigator.clipboard.writeText(prompt);
      setNotice("完整提示词已复制。");
    } catch {
      setPromptExpanded(true);
      setNotice("无法自动复制，可以在下方选择完整提示词。");
    }
  };

  const chooseResult = async () => {
    setError(null);
    try {
      const path = await chooseLearningResultFile();
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
      await openExternalResultDirectory("learning", task.id);
      setNotice("已打开自动返回目录。保存为 result.json 后会自动检测。");
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
      const application = await importLearningResult(task.id, resultPath);
      requireLearningResult(application.dictionaryEntry, task);
      if (application.task.id !== task.id) throw new Error("返回的学习任务不匹配。");
      handledCompletionRef.current = task.id;
      setTask(application.task);
      setEntry(application.dictionaryEntry);
      setEntries((current) => [
        application.dictionaryEntry,
        ...current.filter(
          (item) => item.id !== application.dictionaryEntry.id,
        ),
      ]);
    } catch (cause) {
      setError(commandError(cause).message);
      setTask(await getLearningTask(task.id).catch(() => task));
    } finally {
      setOperation(null);
    }
  };

  const saveCard = async () => {
    if (!entry) {
      return;
    }
    setOperation("card");
    setError(null);
    try {
      const card = await createLearningCard(projectId, entry.id);
      setCards((current) => [
        card,
        ...current.filter((item) => item.id !== card.id),
      ]);
      setNotice("已收藏当前台词和场景截图。");
    } catch (cause) {
      setError(commandError(cause).message);
    } finally {
      setOperation(null);
    }
  };

  const removeCard = async (card: LearningCard) => {
    speech.stop();
    setOperation(`delete:${card.id}`);
    setError(null);
    try {
      if (await deleteLearningCard(projectId, card.id)) {
        setCards((current) => current.filter((item) => item.id !== card.id));
      }
    } catch (cause) {
      setError(commandError(cause).message);
    } finally {
      setOperation(null);
    }
  };

  const exportCards = async () => {
    setError(null);
    const directory = await chooseLearningExportDirectory().catch((cause) => {
      setError(commandError(cause).message);
      return null;
    });
    if (!directory) {
      return;
    }
    setOperation("export");
    try {
      const exported = await exportLearningCards(projectId, directory);
      setNotice(`已导出 ${exported.cardCount} 张卡片到 ${exported.directory}`);
    } catch (cause) {
      setError(commandError(cause).message);
    } finally {
      setOperation(null);
    }
  };

  const resetQuery = () => {
    handledCompletionRef.current = null;
    setTask(null);
    setDispatch(null);
    setEntry(null);
    setPrompt(null);
    setPromptExpanded(false);
    setResultPath(null);
    setNotice(null);
    setError(null);
  };

  const busy = operation !== null;
  const running =
    task && ["running", "validating"].includes(task.status);
  const canResume = Boolean(
    task && task.handoffKind !== "manual" &&
    ["queued", "failed", "cancelled", "interrupted"].includes(task.status),
  );
  const savedEntry = entry
    ? cards.some((card) => card.dictionaryEntryId === entry.id)
    : false;

  const PanelElement = embedded ? "section" : "aside";

  return (
    <PanelElement
      hidden={!visible}
      inert={!visible}
      style={!visible ? { display: "none" } : undefined}
      className={`learning-panel ${embedded ? "embedded" : ""}`}
      aria-label="语言学习"
    >
      {!embedded ? <header className="learning-header">
        <div>
          <span>随看随学</span>
          <strong>当前台词</strong>
        </div>
        <button
          aria-label="关闭语言学习"
          className="learning-close"
          type="button"
          onClick={() => {
            speech.stop();
            onClose();
          }}
        >
          ×
        </button>
      </header> : null}

      <div className="learning-scroll">
        <CodexDetectionNotice {...codexDetection} />
        {learningContext.changed && liveSourceVersion && liveSourceSegment ? (
          <div className="learning-context-notice">
            <span>{sourceSegment ? "已保留正在学习的台词。" : "当前已有可学习的台词。"}</span>
            <button className="button quiet small" type="button" disabled={loading || busy || Boolean(task && activeStatuses.has(task.status))}
              onClick={() => {
                if (selectedText !== (sourceSegment?.text ?? "") && !window.confirm("更换台词会放弃当前未发送的输入，是否继续？")) return;
                speech.stop();
                resetQuery();
                setSelectedText(liveSourceSegment.text);
                learningContext.selectCurrent();
              }}>学习当前台词</button>
          </div>
        ) : null}
        {draftSaveError ? <p role="alert">当前窗口无法暂存学习输入，关闭或重新准备播放前请复制保留。{draftSaveError}</p> : null}
        {error ? (
          <div className="learning-error" role="alert">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="learning-loading" role="status">
            <span className="spinner"></span>
            <span>正在读取学习记录</span>
          </div>
        ) : bootstrapFailed ? (
          <div className="learning-empty">
            <button className="button quiet small" type="button" onClick={() => { setLoading(true); setBootstrapFailed(false); setError(null); setBootstrapAttempt((value) => value + 1); }}>重新读取学习记录</button>
            {savedDraft.draft || savedDraft.error ? <button className="button quiet small" type="button" onClick={() => {
              if (!window.confirm("放弃当前窗口保存的学习草稿，改为学习当前台词？")) return;
              try { discardLearningDraft(projectId); setLoading(true); setBootstrapFailed(false); setError(null); setSavedDraft({ draft: null, error: null }); setSelectedText(liveSourceSegment?.text ?? ""); }
              catch (cause) { setError(commandError(cause).message); }
            }}>放弃无法恢复的草稿</button> : null}
          </div>
        ) : recovery.blocked ? (
          <div className="learning-empty">
            <p role={recovery.error ? "alert" : "status"}>{recovery.error ?? "正在恢复查询使用的字幕和播放范围"}</p>
            {recovery.error ? <button className="button quiet small" type="button" onClick={recovery.retry}>重新读取学习上下文</button> : null}
            {task && !activeStatuses.has(task.status) && liveSourceSegment ? <button className="button quiet small" type="button" disabled={busy} onClick={() => {
              resetQuery();
              setSelectedText(liveSourceSegment.text);
              learningContext.selectCurrent();
            }}>放下本次查询，学习当前台词</button> : null}
            {task && activeStatuses.has(task.status) ? <button className="button quiet small" type="button" disabled={busy} onClick={() => void cancel()}>取消本次查询</button> : null}
          </div>
        ) : !sourceVersion ? (
          <div className="learning-empty">
            <strong>需要先准备原文字幕</strong>
            <p>词义查询只使用真实原文字幕和已有的简体中文字幕。</p>
            <button
              className="button primary small"
              type="button"
              onClick={onPrepareSubtitles}
            >
              生成或导入原文字幕
            </button>
          </div>
        ) : !sourceSegment ? (
          <div className="learning-empty">
            <strong>播放到一句原文字幕</strong>
            <p>出现台词后，可以选择词语、短语或整句进行查询。</p>
          </div>
        ) : (
          <>
            <LearningSelectionSection
              disabled={busy || Boolean(task && activeStatuses.has(task.status))}
              playbackPositionMs={playbackPositionMs}
              sourceVersion={sourceVersion}
              sourceSegment={sourceSegment}
              translationSegment={translationSegment}
              selectableParts={selectableParts}
              selectedText={selectedText}
              selectionValid={selectionValid}
              kind={kind}
              speech={speech}
              onSelectText={selectText}
            />

            {entry ? (
              <LearningResultSection
                entry={entry}
                speech={speech}
                busy={busy}
                saved={savedEntry}
                saving={operation === "card"}
                onSave={() => void saveCard()}
                onReset={resetQuery}
              />
            ) : !task ? (
              <section className="learning-setup">
                <AiTaskExecutionSetup
                  controller={executionChoice}
                  runtime={runtime}
                  allowFrames={false}
                  translationAvailable={Boolean(translationVersion && translationSegment)}
                  taskLabel="学习辅助"
                  actionLabel="准备查询材料"
                  operationLabel="正在准备…"
                  buttonClassName="learning-primary"
                  busy={operation === "prepare"}
                  blocked={busy || !selectionValid}
                  onStart={() => void prepare()}
                />
              </section>
            ) : dispatch ? (
              <AiTaskDispatchConfirm preview={dispatch} busy={busy} onConfirm={() => void confirmDispatch()} onBack={() => setDispatch(null)} />
            ) : task.status === "awaiting_external_result" ? (
              <section className="learning-manual">
                <div className="learning-task-heading">
                  <span>等待其他 AI 工具返回</span>
                  <strong>复制提示词后，可自动检测 result.json</strong>
                  <p>SiaoVPlay 不会自动发送材料，只检查受控返回目录。</p>
                </div>
                {task.errorMessage ? (
                  <div className="notice danger" role="alert">
                    <strong>返回结果未通过检查</strong>
                    <p>{task.errorMessage}</p>
                  </div>
                ) : null}
                <button
                  className="button primary learning-primary"
                  type="button"
                  disabled={!prompt || busy}
                  onClick={() => void copyPrompt()}
                >
                  复制完整提示词
                </button>
                <button
                  className="button quiet learning-primary"
                  type="button"
                  disabled={busy}
                  onClick={() => void openReturnDirectory()}
                >
                  打开自动返回目录
                </button>
                <ol className="external-return-guide">
                  <li>将完整提示词发送给聊天型 AI，等待其返回一个纯 JSON 对象。</li>
                  <li>只复制 JSON，不包含说明文字或 Markdown 代码围栏。</li>
                  <li>
                    用记事本「另存为」result.json，文件类型选「所有文件」，编码选
                    UTF-8。
                  </li>
                  <li>保存到自动返回目录；也可保存到其他位置后在下方手动选择。</li>
                </ol>
                {notice ? <p role="status">{notice}</p> : null}
                <button
                  className="learning-prompt-toggle"
                  type="button"
                  disabled={!prompt}
                  onClick={() => setPromptExpanded((value) => !value)}
                >
                  {promptExpanded ? "收起完整提示词" : "查看完整提示词"}
                </button>
                {promptExpanded && prompt ? (
                  <textarea
                    aria-label="词义查询完整提示词"
                    readOnly
                    value={prompt}
                    onFocus={(event) => event.currentTarget.select()}
                  />
                ) : null}
                <button
                  className={`learning-result-file ${
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
                  className="button primary learning-primary"
                  type="button"
                  disabled={!resultPath || busy}
                  onClick={() => void importResult()}
                >
                  {operation === "import" ? "正在检查…" : "检查并显示词义"}
                </button>
                <button
                  className="button text learning-reset"
                  type="button"
                  disabled={busy}
                  onClick={() => void cancel()}
                >
                  取消本次查询
                </button>
              </section>
            ) : running ? (
              <section className="learning-running">
                <span className="spinner large"></span>
                <strong>{statusCopy(task)}</strong>
                <p>
                  {task.handoffKind === "manual"
                    ? "已自动检测到 result.json，正在核对任务、版本和所选文本。"
                    : task.handoffKind === "api"
                      ? "可以继续观看；关闭面板不会中断当前 API 请求。"
                      : "可以继续观看；关闭面板不会中断本机处理。"}
                </p>
                <div
                  aria-label="词义查询进度"
                  aria-valuemax={100}
                  aria-valuemin={0}
                  aria-valuenow={Math.round(task.progress * 100)}
                  className="learning-progress"
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
              </section>
            ) : (
              <section className="learning-recovery">
                <strong>{statusCopy(task)}</strong>
                {task.errorMessage ? <p>{task.errorMessage}</p> : null}
            {task.status === "completed" ? <button className="button primary" type="button" onClick={() => setResultReadAttempt((value) => value + 1)}>
              重新读取结果
            </button> : null}
                {canResume ? (
                  <button
                    className="button primary learning-primary"
                    type="button"
                    disabled={busy}
                    onClick={() => void resume()}
                  >
                    {operation === "resume" ? "正在重新开始…" : task.status === "queued" ? "查看发送清单" : "重新开始"}
                  </button>
                ) : null}
                {task.status === "queued" ? <button className="button quiet" type="button" disabled={busy} onClick={() => void cancel()}>
                  取消本次准备
                </button> : null}
                <button
                  className="button quiet learning-primary"
                  type="button"
                  disabled={busy || task.status === "queued"}
                  onClick={resetQuery}
                >
                  新建查询
                </button>
              </section>
            )}

            {notice && task?.status !== "awaiting_external_result" ? (
              <p className="learning-notice" role="status">
                {notice}
              </p>
            ) : null}

            <LearningCardsSection
              cards={cards}
              speech={speech}
              busy={busy}
              operation={operation}
              onExport={() => void exportCards()}
              onJump={onJump}
              onDelete={(card) => void removeCard(card)}
            />
          </>
        )}
      </div>
    </PanelElement>
  );
}
