import * as vscode from 'vscode';

export class DisposableStore implements vscode.Disposable {
    private _disposables: vscode.Disposable[] = [];
    private _isDisposed = false;

    add<T extends vscode.Disposable>(disposable: T): T {
        if (this._isDisposed) {
            disposable.dispose();
        } else {
            this._disposables.push(disposable);
        }
        return disposable;
    }

    dispose(): void {
        if (this._isDisposed) {
            return;
        }
        this._isDisposed = true;
        
        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            disposable?.dispose();
        }
    }
}

export class MutableDisposable<T extends vscode.Disposable> implements vscode.Disposable {
    private _disposable: T | undefined;

    get value(): T | undefined {
        return this._disposable;
    }

    set value(disposable: T | undefined) {
        this._disposable?.dispose();
        this._disposable = disposable;
    }

    dispose(): void {
        this._disposable?.dispose();
        this._disposable = undefined;
    }
}

export function toDisposable(fn: () => void): vscode.Disposable {
    return { dispose: fn };
}
