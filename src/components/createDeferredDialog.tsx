import { createElement, useEffect, useState, type ComponentType } from "react";
import { Dialog } from "./Dialog";

export function createDeferredDialog<P extends { onClose: () => void }>(
  load: () => Promise<ComponentType<P>>,
  title: string,
) {
  let loaded: ComponentType<P> | null = null;
  let pending: Promise<ComponentType<P>> | null = null;
  function request() {
    pending ??= Promise.resolve().then(load).then(component => {
      loaded = component;
      return component;
    }).catch(error => {
      pending = null;
      throw error;
    });
    return pending;
  }

  return function DeferredDialog(props: P) {
    const [component, setComponent] = useState(() => loaded);
    const [failed, setFailed] = useState(false);
    useEffect(() => {
      if (component) return;
      let current = true;
      void request().then(value => {
        if (current) setComponent(() => value);
      }, () => {
        if (current) setFailed(true);
      });
      return () => { current = false; };
    }, [component]);

    if (component) return createElement(component, props);
    return <Dialog title={title} onClose={props.onClose}>
      {failed ? <>
        <p role="alert">界面加载失败。请关闭提示，保存当前工作后重启应用。</p>
        <button className="button" type="button" onClick={props.onClose}>关闭提示</button>
      </> : <p role="status">正在打开…</p>}
    </Dialog>;
  };
}
