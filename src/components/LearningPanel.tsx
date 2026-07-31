import { useEffect, useMemo, useRef, useState } from "react";

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
  playbackUrl,
  prepareLearningTask,
  readLearningPrompt,
  resumeCodexLearningTask,
  startCodexLearningTask,
} from "../lib/desktop";
import { formatDuration } from "../lib/format";
import type {
  CodexRuntimeStatus,
  DictionaryEntry,
  LearningCard,
  LearningSelectionKind,
  LearningTask,
  SubtitleSegment,
  SubtitleVersion,
} from "../types";

type LearningPanelProps = {
  projectId: string;
  playbackPositionMs: number;
  sourceVersion: SubtitleVersion | null;
  translationVersion: SubtitleVersion | null;
  sourceSegment: SubtitleSegment | null;
  translationSegment: SubtitleSegment | null;
  onPrepareSubtitles: () => void;
  onClose: () => void;
  onJump: (positionMs: number) => void;
};

type HandoffKind = "codex" | "manual";

type SelectablePart = {
  text: string;
  selectable: boolean;
};

const activeStatuses = new Set([
  "awaiting_external_result",
  "queued",
  "running",
  "validating",
]);

function splitForSelection(text: string, languageCode: string): SelectablePart[] {
  if (!text) {
    return [];
  }
  try {
    const segmenter = new Intl.Segmenter(languageCode, {
      granularity: "word",
    });
    return Array.from(segmenter.segment(text), (part) => ({
      text: part.segment,
      selectable: Boolean(part.isWordLike),
    }));
  } catch {
    return text.split(/(\s+|[.,!?，。！？、…]+)/u).map((part) => ({
      text: part,
      selectable: Boolean(part.trim()) && !/^[.,!?，。！？、…]+$/u.test(part),
    }));
  }
}

function selectionKind(
  selectedText: string,
  sourceSentence: string,
  selectableParts: SelectablePart[],
): LearningSelectionKind {
  if (selectedText === sourceSentence) {
    return "sentence";
  }
  if (
    selectableParts.some(
      (part) => part.selectable && part.text === selectedText,
    )
  ) {
    return "word";
  }
  return "phrase";
}

function selectionKindLabel(kind: LearningSelectionKind): string {
  if (kind === "word") {
    return "词语";
  }
  if (kind === "phrase") {
    return "短语";
  }
  return "整句";
}

function statusCopy(task: LearningTask): string {
  if (task.status === "queued") {
    return "已准备好，等待本机开始";
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

export function LearningPanel({
  projectId,
  playbackPositionMs,
  sourceVersion,
  translationVersion,
  sourceSegment,
  translationSegment,
  onPrepareSubtitles,
  onClose,
  onJump,
}: LearningPanelProps) {
  const handledCompletionRef = useRef<string | null>(null);
  const selectableParts = useMemo(
    () =>
      splitForSelection(
        sourceSegment?.text ?? "",
        sourceVersion?.languageCode ?? "und",
      ),
    [sourceSegment?.text, sourceVersion?.languageCode],
  );
  const [selectedText, setSelectedText] = useState(sourceSegment?.text ?? "");
  const [handoff, setHandoff] = useState<HandoffKind>("codex");
  const [runtime, setRuntime] = useState<CodexRuntimeStatus | null>(null);
  const [task, setTask] = useState<LearningTask | null>(null);
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
      getCodexRuntimeStatus(),
      listLearningTasks(projectId),
      listDictionaryEntries(projectId),
      listLearningCards(projectId),
    ])
      .then(([nextRuntime, tasks, nextEntries, nextCards]) => {
        if (!active) {
          return;
        }
        setRuntime(nextRuntime);
        setEntries(nextEntries);
        setCards(nextCards);
        const activeTask = tasks.find((item) =>
          activeStatuses.has(item.status),
        );
        if (activeTask) {
          setTask(activeTask);
          setHandoff(activeTask.handoffKind);
          setSelectedText(activeTask.selectedText);
        } else {
          setEntry(
            nextEntries.find(
              (item) =>
                sourceSegment !== null &&
                item.sourceSegmentId === sourceSegment.id &&
                item.selectedText === sourceSegment.text,
            ) ?? null,
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
  }, [projectId, sourceSegment]);

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
      void getLearningTask(task.id)
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
      !task.outputDictionaryEntryId ||
      handledCompletionRef.current === task.id
    ) {
      return;
    }
    handledCompletionRef.current = task.id;
    void getDictionaryEntry(task.outputDictionaryEntryId)
      .then((value) => {
        setEntry(value);
        setEntries((current) => [
          value,
          ...current.filter((item) => item.id !== value.id),
        ]);
      })
      .catch((cause: unknown) => {
        setError(commandError(cause).message);
      });
  }, [task]);

  const selectText = (value: string) => {
    setSelectedText(value);
    setTask(null);
    setEntry(
      entries.find(
        (item) =>
          item.sourceSegmentId === sourceSegment?.id &&
          item.selectedText === value,
      ) ?? null,
    );
    setPrompt(null);
    setPromptExpanded(false);
    setResultPath(null);
    setNotice(null);
    setError(null);
  };

  const prepare = async () => {
    if (!sourceSegment || !selectionValid) {
      return;
    }
    setOperation("prepare");
    setError(null);
    setNotice(null);
    try {
      const normalized = selectedText.trim();
      const prepared = await prepareLearningTask(
        projectId,
        handoff,
        sourceSegment.id,
        normalized,
        selectionKind(normalized, sourceSegment.text, selectableParts),
        playbackPositionMs,
      );
      setTask(prepared);
      setEntry(null);
      if (handoff === "codex") {
        setTask(await startCodexLearningTask(prepared.id));
      } else {
        setPrompt(await readLearningPrompt(prepared.id));
        setPromptExpanded(true);
      }
    } catch (cause) {
      setError(commandError(cause).message);
      const tasks = await listLearningTasks(projectId).catch(() => []);
      const activeTask = tasks.find((item) => activeStatuses.has(item.status));
      if (activeTask) {
        setTask(activeTask);
        setHandoff(activeTask.handoffKind);
        setSelectedText(activeTask.selectedText);
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
      setTask(await resumeCodexLearningTask(task.id));
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
    setEntry(null);
    setPrompt(null);
    setPromptExpanded(false);
    setResultPath(null);
    setNotice(null);
    setError(null);
  };

  const busy = operation !== null;
  const runtimeReady =
    runtime?.available && runtime.authenticated && runtime.supported;
  const running =
    task && ["queued", "running", "validating"].includes(task.status);
  const canResume =
    task?.handoffKind === "codex" &&
    ["failed", "cancelled", "interrupted"].includes(task.status);
  const savedEntry = entry
    ? cards.some((card) => card.dictionaryEntryId === entry.id)
    : false;

  return (
    <aside className="learning-panel" aria-label="语言学习">
      <header className="learning-header">
        <div>
          <span>随看随学</span>
          <strong>当前台词</strong>
        </div>
        <button
          aria-label="关闭语言学习"
          className="learning-close"
          type="button"
          onClick={onClose}
        >
          ×
        </button>
      </header>

      <div className="learning-scroll">
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
            <section className="learning-selection">
              <div className="learning-selection-heading">
                <span>{formatDuration(playbackPositionMs)}</span>
                <button
                  type="button"
                  onClick={() => selectText(sourceSegment.text)}
                >
                  选整句
                </button>
              </div>
              <div
                aria-label="选择原文词语"
                className="learning-words"
                lang={sourceVersion.languageCode}
              >
                {selectableParts.map((part, index) =>
                  part.selectable ? (
                    <button
                      className={
                        selectedText === part.text ? "selected" : undefined
                      }
                      key={`${index}-${part.text}`}
                      type="button"
                      onClick={() => selectText(part.text)}
                    >
                      {part.text}
                    </button>
                  ) : (
                    <span key={`${index}-${part.text}`}>{part.text}</span>
                  ),
                )}
              </div>
              {translationSegment ? (
                <p className="learning-translation" lang="zh-CN">
                  {translationSegment.text}
                </p>
              ) : null}
              <label className="learning-selection-input">
                <span>查询内容 · {selectionKindLabel(kind)}</span>
                <input
                  aria-invalid={!selectionValid}
                  aria-label="要查询的原文"
                  value={selectedText}
                  onChange={(event) => selectText(event.target.value)}
                />
              </label>
              {!selectionValid ? (
                <small className="learning-selection-error">
                  查询内容必须完整出现在当前原文字幕中。
                </small>
              ) : null}
            </section>

            {entry ? (
              <section className="learning-result">
                <div className="learning-result-heading">
                  <div>
                    <strong>{entry.selectedText}</strong>
                    <span>{entry.pronunciation}</span>
                  </div>
                  <em>{entry.partOfSpeech}</em>
                </div>
                <p>{entry.contextualMeaning}</p>
                {entry.usageNote ? <small>{entry.usageNote}</small> : null}
                <button
                  className="button primary learning-primary"
                  type="button"
                  disabled={busy || savedEntry}
                  onClick={() => void saveCard()}
                >
                  {savedEntry
                    ? "已收藏"
                    : operation === "card"
                      ? "正在截取场景…"
                      : "收藏台词和场景"}
                </button>
                <button
                  className="button text learning-reset"
                  type="button"
                  disabled={busy}
                  onClick={resetQuery}
                >
                  查询其他内容
                </button>
              </section>
            ) : !task ? (
              <section className="learning-setup">
                <div className="learning-handoff" aria-label="词义查询方式">
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
                  <div className="learning-runtime">
                    <strong>本机 Codex 当前不可用</strong>
                    <span>{runtime.errorMessage}</span>
                  </div>
                ) : null}
                <div className="learning-scope">
                  <div>
                    <span>接收方</span>
                    <strong>
                      {handoff === "codex" ? "本机 Codex" : "自行选择的工具"}
                    </strong>
                  </div>
                  <ul>
                    <li>所选原文和当前完整台词</li>
                    {translationVersion && translationSegment ? (
                      <li>当前台词对应的简体中文字幕</li>
                    ) : null}
                    <li>字幕语言、版本标识和播放位置</li>
                  </ul>
                  <p>不包含视频、音频、本机媒体路径、数据库或凭证。</p>
                </div>
                <button
                  className="button primary learning-primary"
                  type="button"
                  disabled={
                    busy ||
                    !selectionValid ||
                    (handoff === "codex" && !runtimeReady)
                  }
                  onClick={() => void prepare()}
                >
                  {operation === "prepare" ? "正在准备…" : "确认范围并查询"}
                </button>
              </section>
            ) : task.status === "awaiting_external_result" ? (
              <section className="learning-manual">
                <div className="learning-task-heading">
                  <span>等待其他 Agent 返回</span>
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
                {canResume ? (
                  <button
                    className="button primary learning-primary"
                    type="button"
                    disabled={busy}
                    onClick={() => void resume()}
                  >
                    {operation === "resume" ? "正在重新开始…" : "重新开始"}
                  </button>
                ) : null}
                <button
                  className="button quiet learning-primary"
                  type="button"
                  disabled={busy}
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

            <section className="learning-cards">
              <div className="learning-cards-heading">
                <div>
                  <span>学习卡片</span>
                  <strong>{cards.length}</strong>
                </div>
                <button
                  type="button"
                  disabled={!cards.length || busy}
                  onClick={() => void exportCards()}
                >
                  {operation === "export" ? "导出中…" : "导出"}
                </button>
              </div>
              {cards.length ? (
                <div className="learning-card-list">
                  {cards.map((card) => (
                    <article className="learning-card" key={card.id}>
                      {card.screenshotAvailable ? (
                        <img
                          alt={`${card.selectedText} 的场景截图`}
                          src={playbackUrl(card.screenshotPath)}
                        />
                      ) : (
                        <div className="learning-card-missing">截图不可用</div>
                      )}
                      <div>
                        <strong>{card.selectedText}</strong>
                        <span>{card.contextualMeaning}</span>
                        <small>{formatDuration(card.playbackPositionMs)}</small>
                      </div>
                      <div className="learning-card-actions">
                        <button
                          type="button"
                          onClick={() => onJump(card.playbackPositionMs)}
                        >
                          跳回
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void removeCard(card)}
                        >
                          {operation === `delete:${card.id}` ? "删除中" : "删除"}
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="learning-cards-empty">
                  查询台词后，可以收藏释义与当前场景。
                </p>
              )}
            </section>
          </>
        )}
      </div>
    </aside>
  );
}
