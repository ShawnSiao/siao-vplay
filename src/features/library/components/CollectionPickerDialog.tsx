import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Dialog } from "../../../components/Dialog";
import { commandError } from "../../../lib/desktop";
import { useCollectionOverviewPages, type CollectionOverviewReader } from "../useCollectionOverviewPages";
import "./collection-picker.css";

type Props = {
  projectId: string;
  projectTitle: string;
  excludedCollectionId: string | null;
  onAdd: (collectionId: string, projectId: string) => Promise<unknown>;
  onClose: () => void;
  onAfterClose?: () => void;
  readCollections?: CollectionOverviewReader;
};

export function CollectionPickerDialog({ projectId, projectTitle, excludedCollectionId, onAdd, onClose, onAfterClose, readCollections }: Props) {
  const pages = useCollectionOverviewPages(readCollections);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const pending = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; onAfterClose?.(); }; }, [onAfterClose]);
  const add = async (id: string) => {
    if (pending.current) return;
    pending.current = true; setSaving(true); setSaveError(null);
    try {
      const result = await onAdd(id, projectId);
      if (!alive.current) return;
      if (result === null) setSaveError("未能加入合集，请重试。");
      else onClose();
    } catch (error) {
      if (alive.current) setSaveError(commandError(error).message);
    } finally {
      pending.current = false;
      if (alive.current) setSaving(false);
    }
  };
  const page = pages.page;
  const results = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { if (page && results.current) results.current.scrollTop = 0; }, [page]);
  const busy = saving || pages.loading;
  return createPortal(<Dialog title="加入合集" onClose={onClose} actions={<button className="button small" type="button" onClick={onClose}>关闭</button>}>
    <div className="collection-picker">
      <p className="collection-picker-context" title={projectTitle}>{projectTitle}</p>
      <label className="field"><span>合集类型</span><select value={String(pages.input.rootLinked)} disabled={saving}
        onChange={event => { setSaveError(null); void pages.search(query.trim(), event.target.value === "true"); }}>
        <option value="false">自建合集</option><option value="true">文件夹合集</option>
      </select></label>
      <form className="collection-picker-search" onSubmit={event => { event.preventDefault(); setSaveError(null); void pages.search(query.trim(), pages.input.rootLinked); }}>
        <label className="field"><span>搜索合集</span><input value={query} disabled={saving} placeholder="按合集名称查找"
          onChange={event => setQuery(event.target.value)} /></label>
        <button className="button small" type="submit" disabled={saving}>搜索</button>
      </form>
      {saving ? <p role="status">正在加入合集…</p> : null}
      {saveError ? <p role="alert">{saveError}</p> : null}
      {pages.loading ? <p role="status">正在读取合集…</p> : null}
      {pages.error ? <div role="alert"><p>{pages.error}</p><button className="button small" type="button" disabled={busy} onClick={() => void pages.retry()}>重试读取</button></div> : null}
      <div ref={results} className="collection-picker-results" role="group" aria-label="可选合集" aria-busy={busy}>
        {page?.items.map(item => <button className="button small" type="button" key={item.id} disabled={busy || Boolean(pages.error) || item.id === excludedCollectionId}
          onClick={() => void add(item.id)} aria-label={`加入「${item.title}」`}>
          <span>{item.title}</span><small>{item.id === excludedCollectionId ? "当前合集" : `${item.itemCount} 个视频`}</small>
        </button>)}
        {page && page.items.length === 0 ? <p>{pages.input.query ? "没有找到匹配的合集。" : "暂无这类合集。"}</p> : null}
      </div>
      <div className="collection-picker-pagination">
        <span aria-live="polite">{page ? `共 ${page.totalCount} 个${page.items.length ? `，${page.offset + 1}–${page.offset + page.items.length}` : ""}` : ""}</span>
        <button className="button small" type="button" disabled={busy || !page || page.offset === 0} onClick={() => void pages.previous()}>上一页</button>
        <button className="button small" type="button" disabled={busy || !page || page.nextOffset === null || Boolean(pages.error)} onClick={() => void pages.next()}>下一页</button>
        <button className="button small" type="button" disabled={busy} onClick={() => void pages.reload()}>重新加载</button>
      </div>
    </div>
  </Dialog>, document.body);
}
