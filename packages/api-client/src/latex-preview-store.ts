export type LatexPreviewState = {
  source: string | null;
  pdf: { blob: Blob; source: string } | null;
  busy: boolean;
  error: string;
};

/** One document owns its PDF across Note/source changes, never across accounts. */
export class LatexPreviewStore {
  private state: LatexPreviewState = {
    source: null,
    pdf: null,
    busy: false,
    error: "",
  };
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private controller: AbortController | null = null;
  private generation = 0;
  private ready = false;
  private stopped = false;
  private lastStarted = 0;
  constructor(
    private compile: (source: string, signal: AbortSignal) => Promise<Blob>,
  ) {}
  start() {
    this.stopped = false;
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.state;
  private publish(change: Partial<LatexPreviewState>) {
    this.state = { ...this.state, ...change };
    this.listeners.forEach((listener) => listener());
  }
  private cancel() {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.controller?.abort();
    this.controller = null;
    this.generation++;
  }
  update(source: string | null, ready: boolean) {
    if (this.stopped || (source === this.state.source && ready === this.ready))
      return;
    this.cancel();
    this.ready = ready;
    this.publish({
      source,
      busy: false,
      error: source === this.state.source ? this.state.error : "",
    });
    if (source === null || !ready || this.state.pdf?.source === source) return;
    if (!source.trim()) {
      this.publish({ error: "Add LaTeX source to preview this note." });
      return;
    }
    this.timer = setTimeout(
      () => {
        this.timer = undefined;
        void this.run();
      },
      Math.max(1200, 4000 - (Date.now() - this.lastStarted)),
    );
  }
  retry = () => {
    if (!this.stopped && this.ready && this.state.source) {
      this.cancel();
      void this.run();
    }
  };
  private async run() {
    const source = this.state.source;
    if (this.stopped || !source || !this.ready) return;
    const generation = ++this.generation,
      controller = new AbortController();
    this.controller = controller;
    this.lastStarted = Date.now();
    this.publish({ busy: true, error: "" });
    const current = () =>
      !this.stopped &&
      this.generation === generation &&
      !controller.signal.aborted &&
      this.state.source === source;
    try {
      const blob = await this.compile(source, controller.signal);
      if (current()) this.publish({ pdf: { blob, source } });
    } catch (error) {
      if (current())
        this.publish({
          error:
            error instanceof Error
              ? error.message
              : "Couldn’t update the PDF. Try again.",
        });
    } finally {
      if (current()) {
        this.controller = null;
        this.publish({ busy: false });
      }
    }
  }
  stop() {
    this.cancel();
    this.stopped = true;
    this.ready = false;
    this.listeners.clear();
    this.state = { source: null, pdf: null, busy: false, error: "" };
  }
}
