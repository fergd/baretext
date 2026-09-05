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

  // Real OS-level mouse events via the CDP Input domain, as opposed to a
  // renderer-side script dispatching synthetic DragEvent objects by hand.
  // The distinction matters for drag-and-drop specifically: a hand-built
  // `el.dispatchEvent(new Event('dragstart'))` fires application code but
  // never exercises the browser's own native "should a drag actually start
  // here" heuristic (e.g. it does not care whether the initiating
  // mousedown's default was prevented). A real press+move+release sequence
  // through Input.dispatchMouseEvent does, so it's what actually caught the
  // rail drag handle regression a synthetic-dispatch test could not.
  async function mouseEvent(type, x, y, buttons = 0, button = 'left') {
    await send('Input.dispatchMouseEvent', { type, x, y, button, buttons, clickCount: type === 'mousePressed' ? 1 : 0 });
  }
  async function mouseWheel(x, y, deltaY) {
    await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY });
  }
  async function realDrag(fromX, fromY, toX, toY, { steps = 12, stepDelayMs = 30 } = {}) {
    await mouseEvent('mouseMoved', fromX, fromY);
    await new Promise((r) => setTimeout(r, 50));
    await mouseEvent('mousePressed', fromX, fromY, 1);
    await new Promise((r) => setTimeout(r, 80));
    for (let i = 1; i <= steps; i++) {
      const x = fromX + (toX - fromX) * (i / steps);
      const y = fromY + (toY - fromY) * (i / steps);
      await mouseEvent('mouseMoved', x, y, 1);
      await new Promise((r) => setTimeout(r, stepDelayMs));
    }
    await mouseEvent('mouseMoved', toX, toY, 1);
    await new Promise((r) => setTimeout(r, 80));
    await mouseEvent('mouseReleased', toX, toY, 0);
  }

  await send('Input.enable');
  await send('Page.enable');

  // PNG screenshot of the current viewport, base64-encoded — used for
  // manual/live visual verification (not asserted on directly by any test;
  // Node has no pixel-diffing here), e.g. to eyeball a redesign against a
  // real rendered window before/after a change.
  async function screenshot() {
    const result = await send('Page.captureScreenshot', { format: 'png' });
    return result.result.data;
  }

  // Switch CSS media without opening a native print dialog. Useful for
  // asserting the document's @media print layout in ordinary E2E runs.
  async function emulateMedia(media) {
    await send('Emulation.setEmulatedMedia', { media });
  }

  return { evaluate, getConsoleMessages, clearConsoleMessages, close, mouseEvent, mouseWheel, realDrag, screenshot, emulateMedia };
}
