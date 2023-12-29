import type { ChildProcess } from 'child_process';
import { spawn } from 'child_process';

export class PredictedProcess {
  private _childProcess: ChildProcess | null = null;
  private _cache: Map<AbortSignal, Promise<void>> = new Map();

  public constructor(
    public readonly id: number,
    public readonly command: string,
  ) {}

  /**
   * Spawns and manages a child process to execute a given command, with handling for an optional AbortSignal.
   *
   * Expected behavior:
   * 1. No process should be initiated if a signal that has already been aborted is passed;
   *    instead, the function should reject immediately.
   * 2. The function should reject if the process terminates with an error or if the AbortSignal is triggered during execution.
   * 3. The function should resolve if the process terminates successfully.
   * 4. Regardless of the outcome (resolve or reject), the function should ensure cleanup of the child process and any linked event listeners.
   *
   * @example
   * ```ts
   * const signal = new AbortController().signal
   * const process = new PredictedProcess(1, 'sleep 5; echo "Hello, world!"')
   *
   * process.run(signal).then(() => {
   *   console.log('The process has exited successfully.')
   * }).catch(() => {
   *   console.log('The process has exited with an error.')
   * })
   *
   * signal.abort() // "Hello, world!" should not be printed.
   * ```
   */
  public async run(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      throw new Error('Aborted before execution');
    }

    return new Promise((resolve, reject) => {
      // prepare arguments for spawn
      let [command, ...args] = this.command.split(' ');

      // spawn the child process
      this._childProcess = spawn(command, args);

      let cleanup = () => {
        this._childProcess?.removeAllListeners();
        this._childProcess?.kill();
      };

      // handle events
      this._childProcess?.on('error', (error) => {
        reject(error);
      });

      this._childProcess?.on('exit', (code, signal) => {
        if (code === 0) {
          cleanup();
          resolve();
        } else {
          reject(signal);
        }
      });

      this._childProcess?.on('close', (code) => {
        if (code === 0) {
          cleanup();
          resolve();
        } else {
          reject(new Error(`Process exited with code $ {code}`));
        }
      });

      // handle abort signal
      if (signal) {
        signal.addEventListener('abort', () => {
          cleanup();
          reject(new Error('AbortSignal triggered'));
        });
      }
    });
  }
  /**
   * Returns a memoized version of `PredictedProcess`.
   *
   * Expected behavior:
   * 1. If the `run` method was previously called with the same AbortSignal and completed without errors,
   *    subsequent calls with the same signal should return immediately, bypassing command re-execution.
   * 2. No process should be initiated if the AbortSignal is already aborted before invoking the `run` method.
   * 3. For concurrent invocations with the same AbortSignal, while `run` is in execution,
   *    these calls should await the ongoing process's completion.
   * 4. Results from executions of `run` that encounter errors or are aborted should not be stored in the memoization cache.
   *
   * Note: The uniqueness of a request is determined by the AbortSignal. Each distinct signal is considered a separate request.
   *
   * @example
   * ```ts
   * const process = new PredictedProcess(1, 'sleep 5; echo "Hello, world!"');
   * const memoizedProcess = process.memoize();
   *
   * const signal = new AbortController().signal;
   * memoizedProcess.run(signal).then(() => {
   *   console.log('The process has executed successfully.');
   * }).catch(() => {
   *   console.log('The process execution resulted in an error.');
   * });
   *
   * memoizedProcess.run(signal); // This call will return the cached result if the first call was successful.
   * ```
   */
  public memoize(): PredictedProcess {
    // Create a new PredictedProcess instance with the same id and command.
    let memoizedProcess = new PredictedProcess(this.id, this.command);

    memoizedProcess.run = async (signal: AbortSignal): Promise<void> => {
      // If the signal is already aborted, throw an error.
      if (signal?.aborted) {
        throw new Error('Signal already aborted');
      }

      // If the signal is already in the cache, return the cached promise.
      if (this._cache.has(signal)) {
        return this._cache.get(signal) as Promise<void>;
      }

      // Otherwise, run the process and store the promise in the cache.
      let promise = this.run(signal);
      this._cache.set(signal, promise);

      // Delete the promise from the cache if it fails
      promise.catch(() => {
        this._cache.delete(signal);
      });

      // Return the promise
      return promise;
    };

    return memoizedProcess;
  }
}
