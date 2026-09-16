import { spawn } from 'node:child_process'
import { isAbsolute } from 'node:path'

export interface CliEvent {
  type: string
  request_id?: string
  server?: string
  workspace?: string | null
  fetched_at?: string
  data?: unknown
}

export class CliError extends Error {
  constructor(readonly code: string, message: string, readonly exitCode = 8) { super(message) }
}

export interface RunOptions {
  input?: string
  signal?: AbortSignal
  onEvent?: (event: CliEvent) => void
  timeoutMs?: number
}

/** Executes the same CLI used by the Agent; this layer owns no credentials. */
export class CliProcess {
  constructor(readonly binary = process.env.APEMIND_CLI_BIN ?? 'apemind') {
    if (binary !== 'apemind' && !isAbsolute(binary)) throw new CliError('cli_unavailable', 'ApeMind 客户端路径不正确。')
  }

  run<T>(args: string[], options: RunOptions = {}): Promise<T> {
    return this.execute(args, false, options) as Promise<T>
  }

  text(args: string[]): Promise<string> {
    return this.execute(args, true, {}) as Promise<string>
  }

  private execute(args: string[], text: boolean, options: RunOptions): Promise<unknown> {
    if (options.signal?.aborted) return Promise.reject(new CliError('cancelled', '登录已取消。', 3))
    return new Promise((resolve, reject) => {
      const child = spawn(this.binary, text ? args : [...args, '--format', 'stream-json'], {
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      let output = ''
      let diagnostics = ''
      let total = 0
      let result: CliEvent | undefined
      let failure: CliError | undefined
      let killTimer: ReturnType<typeof setTimeout> | undefined
      const stop = (error: CliError): void => {
        failure ??= error
        child.kill('SIGINT')
        killTimer ??= setTimeout(() => { child.kill('SIGKILL') }, 5_000)
        killTimer.unref()
      }
      const abort = (): void => stop(new CliError('cancelled', '登录已取消。', 3))
      options.signal?.addEventListener('abort', abort, { once: true })
      const timer = setTimeout(() => stop(new CliError('timeout', '操作超时，请重试。')), options.timeoutMs ?? 120_000)
      timer.unref()
      const cleanup = (): void => {
        clearTimeout(timer)
        if (killTimer) clearTimeout(killTimer)
        options.signal?.removeEventListener('abort', abort)
      }
      const line = (value: string): void => {
        if (!value.trim()) return
        try {
          const event = JSON.parse(value) as CliEvent
          if (!event || typeof event.type !== 'string') throw new Error('invalid event')
          if (event.type === 'result') {
            if (result) throw new Error('duplicate result')
            result = event
          } else options.onEvent?.(event)
        } catch {
          stop(new CliError('invalid_response', 'ApeMind 客户端返回了无法识别的结果。'))
        }
      }
      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', (data: string) => {
        total += Buffer.byteLength(data)
        if (total > 4 * 1024 * 1024) { stop(new CliError('output_limit', '结果过大，请减少每页数量。')); return }
        output += data
        if (!text) {
          let end: number
          while ((end = output.indexOf('\n')) >= 0) {
            const current = output.slice(0, end)
            output = output.slice(end + 1)
            line(current)
          }
        }
      })
      child.stderr.on('data', (data: string) => {
        if (diagnostics.length + data.length > 64_000) { stop(new CliError('output_limit', 'ApeMind 客户端诊断输出过多。')); return }
        diagnostics += data
      })
      child.stdin.on('error', () => { /* A failed child can close stdin before consuming input. */ })
      child.on('error', () => {
        cleanup()
        reject(new CliError('cli_unavailable', '无法启动 ApeMind 客户端，请重新安装桌面应用。'))
      })
      child.on('close', (code) => {
        cleanup()
        if (failure) { reject(failure); return }
        if (code !== 0) {
          try {
            const error = JSON.parse(diagnostics.trim()) as { type: string; error: { code: string; message: string }; exit_code: number }
            if (error.type === 'error' && typeof error.error?.code === 'string' && typeof error.error.message === 'string' && error.exit_code === code) {
              reject(new CliError(error.error.code, error.error.message, code)); return
            }
          } catch { /* Raw process diagnostics must not reach the UI. */ }
          reject(new CliError('cli_failure', 'ApeMind 操作未完成，请重试。', code ?? 8)); return
        }
        if (text) { resolve(output.trim()); return }
        if (output.trim()) line(output)
        if (failure) { reject(failure); return }
        if (!result || !Object.hasOwn(result, 'data')) { reject(new CliError('invalid_response', 'ApeMind 客户端未返回操作结果。')); return }
        resolve(result.data)
      })
      child.stdin.end(options.input ?? '')
    })
  }
}
