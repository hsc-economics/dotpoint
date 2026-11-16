// Sends suggestions and problem reports to the site owner's inbox through FormSubmit (formsubmit.co),
// so nobody needs a GitHub account. The inbox is set in data/config.js.
// Used by the app's "Report a problem" dialog and by the suggest.html and report.html pages.
globalThis.DP_CONTACT = (function () {
  "use strict";
  const cfg = globalThis.DP_CONFIG || {};
  const inbox = String(cfg.contactInbox || "").trim();
  const endpoint = inbox ? `https://formsubmit.co/ajax/${encodeURIComponent(inbox)}` : "";
  // A real address (rather than FormSubmit's private alias) can also be offered as an email link.
  const address = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(inbox) ? inbox : "";

  function asText(title, fields) {
    return [title, ...Object.entries(fields).map(([k, v]) => `${k}: ${v || "(none)"}`)].join("\n");
  }

  async function send(subject, fields) {
    if (!endpoint) throw new Error("No inbox is set in data/config.js.");
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ _subject: subject, _template: "table", _captcha: "false", ...fields }),
    });
    let data = {};
    try { data = await res.json(); } catch (e) { /* not JSON */ }
    if (!res.ok || String(data.success) !== "true") throw new Error(data.message || `The message service answered ${res.status}.`);
    return true;
  }

  function mailto(subject, text) {
    return address ? `mailto:${address}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}` : "";
  }

  // Wires up a form on suggest.html or report.html. build(form) returns { subject, title, fields }
  // or a string naming the first problem to fix.
  function wire(form, build) {
    const status = form.querySelector("[data-status]");
    const btn = form.querySelector('button[type="submit"]');
    const done = document.getElementById(form.dataset.done);
    const fallback = form.querySelector("[data-fallback]");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (form.querySelector('[name="_honey"]').value) return; // filled in by a bot
      const msg = build(form);
      fallback.hidden = true;
      if (typeof msg === "string") {
        status.textContent = msg;
        status.dataset.kind = "error";
        return;
      }
      btn.disabled = true;
      status.dataset.kind = "";
      status.textContent = "Sending…";
      try {
        await send(msg.subject, msg.fields);
        form.hidden = true;
        done.hidden = false;
        done.querySelector("h2").focus();
      } catch (err) {
        btn.disabled = false;
        status.dataset.kind = "error";
        status.textContent = "It didn't send. You can email it instead, or copy it below.";
        const text = asText(msg.title, msg.fields);
        fallback.querySelector("textarea").value = text;
        const link = fallback.querySelector("a");
        link.href = mailto(msg.subject, text);
        link.hidden = !link.href;
        fallback.hidden = false;
      }
    });
    const again = done && done.querySelector("[data-again]");
    if (again) again.addEventListener("click", () => {
      form.reset();
      status.textContent = "";
      btn.disabled = false;
      done.hidden = true;
      form.hidden = false;
      form.querySelector("input:not([type=hidden]):not([name=_honey]), textarea").focus();
    });
  }

  return { ready: !!endpoint, send, mailto, asText, wire };
})();
