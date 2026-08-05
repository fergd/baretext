// Minimal Chrome DevTools Protocol client for driving the real Electron app
// in E2E tests — talks to the renderer over the built-in WebSocket (Node 21+),
// no playwright/puppeteer dependency. Same approach used ad hoc throughout
// manual QA this session, just made reusable.

export async function connect(port) {
  const targetsRes = await fetch(`http://127.0.0.1:${port}/json`);
  const targets = await targetsRes.json();
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error(`no page target found on devtools port ${port}`);

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let nextId = 1;
  const pending = new Map();
  const consoleMessages = [];

  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data.toString());
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    } else if (msg.method === 'Runtime.consoleAPICalled') {
      const args = msg.params.args.map((a) => (a.value !== undefined ? a.value : a.description)).join(' ');
      consoleMessages.push({ type: msg.params.type, text: args });
    } else if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      consoleMessages.push({ type: 'exception', text: (d.exception && d.exception.description) || d.text });
    }
  });

  function send(method, params = {}) {
    return new Promise((resolve) => {
      const id = nextId++;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  await send('Runtime.enable');

  // Evaluates an async expression in the renderer's top-level context and
  // returns its value. Throws (with the real renderer error message) if the
  // expression itself throws, so a failing evaluate() surfaces as a failing
  // Node test rather than a silently-undefined result.
  async function evaluate(expr) {
    const result = await send('Runtime.evaluate', {
      expression: `(async function(){ ${expr} })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    const exceptionDetails = result.result && result.result.exceptionDetails;
    if (exceptionDetails) {
      const desc = (exceptionDetails.exception && exceptionDetails.exception.description) || exceptionDetails.text;
      throw new Error(`renderer evaluate() failed: ${desc}`);
    }
    return result.result && result.result.result ? result.result.result.value : undefined;
  }

  function getConsoleMessages() { return consoleMessages.slice(); }
  function clearConsoleMessages() { consoleMessages.length = 0; }
  function close() { ws.close(); }

  return { evaluate, getConsoleMessages, clearConsoleMessages, close };
}
