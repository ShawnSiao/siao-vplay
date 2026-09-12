import { Component, type ReactNode } from "react";

export class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() { return { failed: true }; }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="preparation-screen">
        <section className="preparation-card" role="alert">
          <h1>界面遇到错误</h1>
          <p>可以重新打开界面。此操作不会删除本地项目、字幕或收藏。</p>
          <button className="button primary" type="button" onClick={() => this.setState({ failed: false })}>
            重新打开界面
          </button>
        </section>
      </main>
    );
  }
}
