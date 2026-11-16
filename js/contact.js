// Sends suggestions and problem reports to the site owner's inbox through a small Google Apps Script
// that runs in the owner's own Google account (tools/email-relay.gs), so nobody needs a GitHub account.
// Its address goes in contactEndpoint in data/config.js. Until that is set, or if sending fails, the
// message opens in the visitor's email app instead, ready to send to contactEmail.
// Used by the app's "Report a problem" dialog and by the suggest.html and report.html pages.
globalThis.DP_CONTACT = (function () {
  "use strict";
  const cfg = globalThis.DP_CONFIG || {};
  const url = String(cfg.contactEndpoint || "").trim();
  const endpoint = /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url) ? url : "";
  const mail = String(cfg.contactEmail || "").trim();
  const address = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail) ? mail : "";

  function asText(title, fields) {
    return [title, "", ...Object.entries(fields).map(([k, v]) => `${k}: ${v || "(none)"}`)].join("\n");
  }

  // kind is "suggestion" or "report". Resolves when the relay confirms the email went out.
  async function send(kind, subject, fields) {
    if (!endpoint) throw new Error("Sending isn't set up yet.");
    const ctl = typeof AbortController === "function" ? new AbortController() : null;
    const timer = ctl && setTimeout(() => ctl.abort(), 20000);
    try {
      // A plain-text body keeps this a "simple" request, which Apps Script accepts from any site.
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ kind, subject, fields, page: location.origin + location.pathname }),
        signal: ctl ? ctl.signal : undefined,
      });
      let data = {};
      try { data = await res.json(); } catch (e) { /* not JSON */ }
      if (!res.ok || data.ok !== true) throw new Error(data.error || `The email service answered ${res.status}.`);
      return true;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function mailto(subject, text) {
    return address ? `mailto:${address}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}` : "";
  }

  // Copies text, falling back to selecting it when the clipboard is refused.
  async function copy(textarea, button) {
    try { await navigator.clipboard.writeText(textarea.value); button.textContent = "Copied"; }
    catch (e) { textarea.focus(); textarea.select(); button.textContent = "Selected: press Ctrl+C"; }
    setTimeout(() => { button.textContent = "Copy message"; }, 2000);
  }

  // Wires up a form on suggest.html or report.html. build(form) returns { kind, subject, title, fields }
  // or a string naming the first problem to fix.
  function wire(form, build) {
    const status = form.querySelector("[data-status]");
    const btn = form.querySelector('button[type="submit"]');
    const done = document.getElementById(form.dataset.done);
    const fallback = form.querySelector("[data-fallback]");
    const say = (text, kind) => { status.textContent = text; status.dataset.kind = kind || ""; };
    if (!endpoint && address) btn.textContent = "Open in my email app";
    fallback.querySelector("[data-copy]").addEventListener("click", (e) => copy(fallback.querySelector("textarea"), e.currentTarget));

    const showFallback = (msg) => {
      const text = asText(msg.title, msg.fields);
      fallback.querySelector("textarea").value = text;
      const link = fallback.querySelector("a");
      link.href = mailto(msg.subject, text) || "#";
      link.hidden = !address;
      fallback.querySelector("[data-to]").textContent = address ? ` to ${address}` : "";
      fallback.hidden = false;
      return link;
    };

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (form.querySelector('[name="_honey"]').value) return; // filled in by a bot
      const msg = build(form);
      fallback.hidden = true;
      if (typeof msg === "string") return say(msg, "error");
      if (!endpoint) {
        const link = showFallback(msg);
        if (address) { say("Your email app should open with the message written. Press Send there to finish."); location.href = link.href; }
        else say("Sending isn't set up on this copy of Dotpoint yet. Copy the message below instead.", "error");
        return;
      }
      btn.disabled = true;
      say("Sending…");
      try {
        await send(msg.kind, msg.subject, msg.fields);
        form.hidden = true;
        done.hidden = false;
        done.querySelector("h2").focus();
      } catch (err) {
        btn.disabled = false;
        say("It didn't send. Email it instead, or copy it below.", "error");
        showFallback(msg);
      }
    });
    const again = done && done.querySelector("[data-again]");
    if (again) again.addEventListener("click", () => {
      form.reset();
      say("");
      btn.disabled = false;
      done.hidden = true;
      form.hidden = false;
      form.querySelector("input:not([type=hidden]):not([name=_honey]), textarea").focus();
    });
  }

  return { ready: !!endpoint, address, send, mailto, asText, copy, wire };
})();
