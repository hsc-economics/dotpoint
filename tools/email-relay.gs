/**
 * Dotpoint email relay (Google Apps Script).
 *
 * Receives suggestions and problem reports from the Dotpoint site and emails them to TO as a tidy,
 * easy-to-read message, sent by your own Gmail to your own Gmail. Nothing else stores or sees them.
 *
 * Set up once (about 3 minutes):
 *   1. Go to https://script.google.com and click New project. Name it "Dotpoint email relay".
 *   2. Delete what's in the editor, paste this whole file in, and click Save.
 *   3. Click Deploy → New deployment → the gear → Web app.
 *        Execute as: Me.   Who has access: Anyone.   Then Deploy.
 *   4. Google asks you to authorise sending email as you: click through and Allow.
 *   5. Copy the Web app URL (it ends in /exec) into contactEndpoint in data/config.js.
 * If you change this file later, use Deploy → Manage deployments → Edit → New version, so the URL stays the same.
 */
const TO = "ethan.sn.tsui@gmail.com";
const MAX_PER_HOUR = 40; // stops a flood of spam from emptying your daily Gmail quota

function doPost(e) {
  try {
    const data = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    if (data._honey) return reply({ ok: true }); // a bot filled in the hidden field
    const fields = clean(data.fields);
    if (!Object.keys(fields).length) return reply({ ok: false, error: "The message was empty." });

    const cache = CacheService.getScriptCache();
    const sent = Number(cache.get("sent") || 0);
    if (sent >= MAX_PER_HOUR) return reply({ ok: false, error: "Too many messages this hour. Try again later." });
    cache.put("sent", String(sent + 1), 3600);

    const kind = data.kind === "suggestion" ? "Suggestion" : "Problem report";
    const subject = ("Dotpoint · " + String(data.subject || kind)).slice(0, 160);
    const page = String(data.page || "").slice(0, 200);
    MailApp.sendEmail({ to: TO, subject: subject, name: "Dotpoint", body: asText(kind, fields, page), htmlBody: asHtml(kind, fields, page) });
    return reply({ ok: true });
  } catch (err) {
    return reply({ ok: false, error: String((err && err.message) || err) });
  }
}

// Opening the URL in a browser shows this, which is a quick way to check the deployment works.
function doGet() {
  return reply({ ok: true, service: "Dotpoint email relay" });
}

function clean(f) {
  const out = {};
  if (f && typeof f === "object") {
    Object.keys(f).slice(0, 12).forEach(function (k) {
      out[String(k).slice(0, 60)] = String(f[k] == null ? "" : f[k]).trim().slice(0, 2000);
    });
  }
  return out;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

function linkify(s) {
  return esc(s).replace(/https?:\/\/[^\s<]+/g, function (u) {
    return '<a href="' + u + '" style="color:#1d5fbf;word-break:break-all">' + u + "</a>";
  }).replace(/\n/g, "<br>");
}

function asText(kind, f, page) {
  const lines = ["Dotpoint " + kind.toLowerCase(), ""];
  Object.keys(f).forEach(function (k) { lines.push(k + ": " + (f[k] || "(none)")); });
  if (page) lines.push("", "Sent from " + page);
  return lines.join("\n");
}

function asHtml(kind, f, page) {
  const keys = Object.keys(f);
  const headline = f["What it is"] || f["Problem"] || kind;
  const rows = keys.map(function (k) {
    const v = f[k] || "(none)";
    return '<tr><td style="padding:10px 16px 10px 0;color:#56625c;font-size:13px;vertical-align:top;white-space:nowrap;border-top:1px solid #e3e7e2">' + esc(k) +
      '</td><td style="padding:10px 0;color:#18211d;font-size:15px;line-height:1.5;border-top:1px solid #e3e7e2">' + linkify(v) + "</td></tr>";
  }).join("");
  const when = Utilities.formatDate(new Date(), "Australia/Sydney", "d MMM yyyy, h:mm a");
  return '<div style="background:#f3f5f1;padding:24px 12px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif">' +
    '<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #d8ded8;border-radius:14px;overflow:hidden">' +
    '<div style="padding:18px 24px;border-bottom:1px solid #d8ded8;display:flex;align-items:center">' +
    '<span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:#eedd3a;box-shadow:0 0 0 2px #18211d;margin-right:10px;vertical-align:middle"></span>' +
    '<span style="font-weight:700;font-size:16px;color:#18211d;vertical-align:middle">Dotpoint</span>' +
    '<span style="margin-left:auto;background:' + (kind === "Suggestion" ? "#fbf5cc" : "#f8e4e1") + ';color:#18211d;font-size:12px;font-weight:600;padding:3px 10px;border-radius:999px">' + esc(kind) + "</span></div>" +
    '<div style="padding:20px 24px 8px"><div style="font-size:20px;font-weight:700;line-height:1.3;color:#18211d">' + esc(headline) + "</div></div>" +
    '<div style="padding:4px 24px 20px"><table style="width:100%;border-collapse:collapse">' + rows + "</table></div>" +
    '<div style="padding:14px 24px;background:#f3f5f1;color:#56625c;font-size:12px">' + esc(when) + (page ? " · from " + esc(page) : "") + "</div>" +
    "</div></div>";
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
