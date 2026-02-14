/**
 * BufferedEmitter - buffers events until first listener, then flushes.
 *
 * Drop-in replacement for vscode.EventEmitter that prevents dropped events
 * during startup race conditions. Events fired before any listener subscribes
 * are buffered and flushed synchronously when the first listener attaches.
 *
 * Zero vscode runtime dependencies — uses structural interface compatibility.
 */

/** Disposable interface (structurally compatible with vscode.Disposable) */
interface IDisposable {
    dispose(): void;
}

/** Event subscription function (structurally compatible with vscode.Event<T>) */
type Event<T> = (
    listener: (e: T) => any,
    thisArgs?: any,
    disposables?: IDisposable[]
) => IDisposable;

export class BufferedEmitter<T> implements IDisposable {
    private _buffer: T[] = [];
    private _listeners: Array<(e: T) => any> = [];
    private _disposed = false;

    get event(): Event<T> {
        return (listener: (e: T) => any, _thisArgs?: any, disposables?: IDisposable[]): IDisposable => {
            if (this._disposed) {
                return { dispose: () => {} };
            }

            // Flush buffer on first listener attachment
            if (this._listeners.length === 0 && this._buffer.length > 0) {
                const buffered = this._buffer;
                this._buffer = [];
                for (const item of buffered) {
                    listener(item);
                }
            }

            this._listeners.push(listener);

            const disposable: IDisposable = {
                dispose: () => {
                    const idx = this._listeners.indexOf(listener);
                    if (idx >= 0) {
                        this._listeners.splice(idx, 1);
                    }
                }
            };

            if (disposables) {
                disposables.push(disposable);
            }

            return disposable;
        };
    }

    fire(data: T): void {
        if (this._disposed) { return; }

        if (this._listeners.length > 0) {
            const snapshot = [...this._listeners];
            for (const fn of snapshot) {
                fn(data);
            }
        } else {
            this._buffer.push(data);
        }
    }

    dispose(): void {
        this._disposed = true;
        this._buffer = [];
        this._listeners = [];
    }
}
