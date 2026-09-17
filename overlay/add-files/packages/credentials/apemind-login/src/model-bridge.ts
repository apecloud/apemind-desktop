import { spawn } from 'node:child_process'
import { CliError, type CliProcess } from './cli-process.ts'

/** Host-only temporary credential. Never return this through Typert or persist it. */
export interface ModelBridge {
  baseURL: string
  apiKey: string
  stop(): void
}

export function startModelBridge(cli: CliProcess, connectionId: string, onExit: () => void): Promise<ModelBridge> {
  return new Promise((resolve, reject) => {
    const child = spawn(cli.binary, ['model', 'serve', '--connection', connectionId, '--format', 'stream-json'], {
      shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    })
    let output = ''
    let diagnostics = ''
    let total = 0
    let ready = false
    let stopping = false
    let killTimer: ReturnType<typeof setTimeout> | undefined
    const stop = (): void => {
      if (stopping) return
      stopping = true
      child.stdin.end()
      killTimer = setTimeout(() => child.kill('SIGKILL'), 5_000)
      killTimer.unref()
    }
    const timer = setTimeout(() => {
      stop()
      reject(new CliError('timeout', '连接 ApeMind 模型超时，请重试。'))
    }, 30_000)
    timer.unref()
    child.stdin.on('error', () => {})
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (text: string) => {
      if (diagnostics.length < 64_000) diagnostics += text
    })
    child.stdout.on('data', (text: string) => {
      total += Buffer.byteLength(text)
      if (total > 64_000) { stop(); reject(new CliError('invalid_response', '模型连接返回了无效信息。')); return }
      output += text
      let end: number
      while ((end = output.indexOf('\n')) >= 0) {
        const line = output.slice(0, end); output = output.slice(end + 1)
        if (!line.trim()) continue
        try {
          const event = JSON.parse(line)
          if (event.type !== 'model_ready' || ready) continue
          const data = event.data
          const url = new URL(data.base_url)
          if (data.connection_id !== connectionId || data.protocol !== 'openai-completions'
            || url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port
            || url.pathname !== '/v1' || url.username || url.password || url.search || url.hash
            || typeof data.api_key !== 'string' || !/^[a-f0-9]{64}$/.test(data.api_key)) throw new Error()
          ready = true
          clearTimeout(timer)
          resolve({ baseURL: url.href, apiKey: data.api_key, stop })
        } catch {
          stop()
          reject(new CliError('invalid_response', '模型连接返回了无效信息。'))
        }
      }
    })
    child.on('error', () => {
      clearTimeout(timer)
      reject(new CliError('cli_unavailable', '无法启动 ApeMind 模型连接，请更新桌面应用。'))
    })
    child.on('close', () => {
      clearTimeout(timer)
      if (killTimer) clearTimeout(killTimer)
      if (ready) { if (!stopping) onExit(); return }
      let code = 'model_unavailable'
      try {
        const error = JSON.parse(diagnostics.trim())
        if (['model_authorization_required', 'authentication_required', 'credential_unavailable'].includes(error.error?.code)) code = error.error.code
      } catch { /* Raw diagnostics may contain credentials; never surface them. */ }
      reject(new CliError(code, code === 'model_authorization_required' ? '请重新登录 ApeMind，授权使用对话模型。' : 'ApeMind 模型连接暂时不可用。'))
    })
  })
}
