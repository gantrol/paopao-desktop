const { spawn } = require('node:child_process');

const REQUEST_TIMEOUT_MS = 30_000;

function createProtocolError(error) {
  const message = error?.message || 'Unknown Codex app-server error';
  const next = new Error(message);
  next.data = error?.data || null;
  return next;
}

class CodexAppServerClient {
  constructor(options = {}) {
    this.clientInfo = options.clientInfo || { name: 'paopao', version: '0.0.0' };
    this.onNotification = typeof options.onNotification === 'function'
      ? options.onNotification
      : () => {};
    this.onServerRequest = typeof options.onServerRequest === 'function'
      ? options.onServerRequest
      : null;
    this.child = null;
    this.buffer = '';
    this.requestId = 1;
    this.pending = new Map();
    this.started = false;
  }

  async start() {
    if (this.started) return;
    this.child = spawn('codex', ['app-server'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });
    this.started = true;

    this.child.stdout.on('data', (chunk) => {
      this.buffer += chunk.toString('utf8');
      const lines = this.buffer.split('\n');
      this.buffer = lines.pop() || '';
      lines.forEach((line) => this.handleLine(line));
    });

    this.child.stderr.on('data', () => {
      // app-server writes diagnostic noise here during normal startup.
    });

    this.child.on('error', (error) => {
      this.rejectPending(error);
    });

    this.child.on('close', (code, signal) => {
      const reason = code === 0
        ? 'Codex app-server closed.'
        : `Codex app-server closed unexpectedly (${code ?? 'null'}${signal ? `, ${signal}` : ''}).`;
      this.rejectPending(new Error(reason));
      this.started = false;
      this.child = null;
    });

    await this.request('initialize', {
      clientInfo: this.clientInfo,
    });
  }

  handleLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return;

    let parsed = null;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return;
    }

    if (parsed && typeof parsed === 'object' && Object.prototype.hasOwnProperty.call(parsed, 'id') && !Object.prototype.hasOwnProperty.call(parsed, 'method')) {
      const pending = this.pending.get(parsed.id);
      if (!pending) return;
      this.pending.delete(parsed.id);
      clearTimeout(pending.timeoutId);
      if (parsed.error) {
        pending.reject(createProtocolError(parsed.error));
        return;
      }
      pending.resolve(parsed.result);
      return;
    }

    if (parsed && typeof parsed === 'object' && Object.prototype.hasOwnProperty.call(parsed, 'id') && typeof parsed.method === 'string') {
      void this.handleServerRequest(parsed);
      return;
    }

    if (parsed && typeof parsed === 'object' && typeof parsed.method === 'string') {
      this.onNotification(parsed);
    }
  }

  async handleServerRequest(request) {
    if (this.onServerRequest) {
      await this.onServerRequest(request, this);
      return;
    }

    const response = resolveDefaultServerRequestResponse(request.method);
    if (response !== null) {
      this.sendResponse(request.id, response);
    }
  }

  request(method, params) {
    if (!this.child || !this.child.stdin.writable) {
      return Promise.reject(new Error('Codex app-server is not running.'));
    }

    const id = this.requestId++;
    const payload = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for Codex app-server response: ${method}`));
      }, REQUEST_TIMEOUT_MS);

      this.pending.set(id, {
        resolve,
        reject,
        timeoutId,
      });

      try {
        this.child.stdin.write(`${JSON.stringify(payload)}\n`);
      } catch (error) {
        clearTimeout(timeoutId);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  sendResponse(id, result) {
    if (!this.child || !this.child.stdin.writable) return;
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
  }

  sendError(id, code, message, data = null) {
    if (!this.child || !this.child.stdin.writable) return;
    this.child.stdin.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id,
      error: {
        code,
        message,
        data,
      },
    })}\n`);
  }

  rejectPending(error) {
    this.pending.forEach((pending, id) => {
      clearTimeout(pending.timeoutId);
      pending.reject(error);
      this.pending.delete(id);
    });
  }

  dispose() {
    if (!this.child) return;
    if (this.child.stdin.writable && !this.child.stdin.destroyed) {
      this.child.stdin.end();
    }
    this.child.kill('SIGTERM');
    this.child = null;
    this.started = false;
  }
}

function resolveDefaultServerRequestResponse(method) {
  if (method === 'item/commandExecution/requestApproval') {
    return { decision: 'decline' };
  }
  if (method === 'item/fileChange/requestApproval') {
    return { decision: 'decline' };
  }
  if (method === 'applyPatchApproval') {
    return { decision: 'denied' };
  }
  if (method === 'execCommandApproval') {
    return { decision: 'denied' };
  }
  return null;
}

module.exports = {
  CodexAppServerClient,
};
