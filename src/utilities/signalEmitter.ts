/**
 * SignalEmitter — an event that means "this just happened", never "this happened".
 *
 * The counterpart to {@link BufferedEmitter}, and deliberately its opposite on the one
 * axis that matters: **it never replays.** A listener that subscribes late hears
 * nothing about the past.
 *
 * `BufferedEmitter` exists because transcript content fired before the webview
 * attached still has to arrive — losing it loses the conversation. A *signal* is the
 * other kind of event. `session.idle` is `ephemeral: true`, is never written to the
 * event log, and fires at the end of every turn; a consumer arms a countdown on it.
 * Flushing three buffered idles into such a consumer would wind down a session that is
 * busy right now. **A replayed signal is a lie about the present.**
 *
 * If what you are emitting would still be meaningful an hour later, it is not a signal
 * and this is the wrong emitter.
 *
 * Zero `vscode` dependencies, structurally compatible with `vscode.Event`, so it works
 * in the agent process where the module does not exist.
 */

interface IDisposable {
    dispose(): void;
}

type Event<T> = (
    listener: (e: T) => unknown,
    thisArgs?: unknown,
    disposables?: IDisposable[]
) => IDisposable;

export class SignalEmitter<T = void> implements IDisposable {
    private listeners: Array<(e: T) => unknown> = [];
    private disposed = false;

    public get event(): Event<T> {
        return (listener, _thisArgs, disposables): IDisposable => {
            if (this.disposed) {
                return { dispose: () => { /* nothing to release */ } };
            }
            this.listeners.push(listener);

            const subscription: IDisposable = {
                dispose: () => {
                    const i = this.listeners.indexOf(listener);
                    if (i !== -1) {
                        this.listeners.splice(i, 1);
                    }
                }
            };
            disposables?.push(subscription);
            return subscription;
        };
    }

    public fire(value?: T): void {
        if (this.disposed) {
            return;
        }
        // A copy, because a listener may unsubscribe while being notified — mutating
        // the array mid-iteration would silently skip whoever came after it.
        for (const listener of [...this.listeners]) {
            try {
                listener(value as T);
            } catch {
                // One consumer failing must not rob the others. This rides the SDK
                // event pump, where an escaping throw takes down unrelated handling.
            }
        }
    }

    public dispose(): void {
        this.disposed = true;
        this.listeners = [];
    }
}
