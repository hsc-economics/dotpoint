// The forms on suggest.html and report.html. Sending is done by js/contact.js.
(function () {
  "use strict";
  const C = globalThis.DP_CONTACT;
  const val = (form, name) => String((form.elements[name] && form.elements[name].value) || "").replace(/\s+/g, " ").trim();
  const picked = (form, name) => {
    const el = form.querySelector(`input[name="${name}"]:checked`);
    return el ? el.value : "";
  };

  const suggest = document.getElementById("suggest-form");
  if (suggest) {
    C.wire(suggest, (f) => {
      const title = val(f, "title").slice(0, 200);
      const source = val(f, "source").slice(0, 500);
      if (!title) return "Say what the example or statistic is.";
      if (!/^https?:\/\/\S+\.\S+/.test(source)) return "Add a link to where it comes from, starting with https://.";
      const kind = picked(f, "kind") || "Example";
      const dp = f.elements.dotpoint;
      return {
        subject: `Dotpoint suggestion: ${title}`.slice(0, 120),
        title: "Dotpoint suggestion",
        fields: {
          Type: kind,
          "What it is": title,
          Source: source,
          "Dot point": dp && dp.value ? dp.options[dp.selectedIndex].text : "Not chosen",
          "How to use it": val(f, "use").slice(0, 800),
          Sent: new Date().toISOString().slice(0, 10),
        },
      };
    });
  }

  const report = document.getElementById("report-page-form");
  if (report) {
    const about = new URLSearchParams(location.search).get("about");
    if (about) report.elements.where.value = about.slice(0, 200);
    C.wire(report, (f) => {
      const details = String(f.elements.details.value || "").trim().slice(0, 1200);
      if (!details) return "Describe the problem so it can be fixed.";
      const reason = picked(f, "reason") || "Something else";
      return {
        subject: `Dotpoint problem: ${reason}`,
        title: "Dotpoint problem report",
        fields: {
          Problem: reason,
          Where: val(f, "where").slice(0, 200) || "Not given",
          Details: details,
          Browser: navigator.userAgent.slice(0, 200),
          Sent: new Date().toISOString().slice(0, 10),
        },
      };
    });
  }
})();
