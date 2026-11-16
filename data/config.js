// Site settings.
// repo: your GitHub repository as "username/repository" (for example "jsmith/dotpoint").
// contactEndpoint: the Web app URL (ending in /exec) of tools/email-relay.gs, deployed in your Google account.
//   Suggestions and problem reports are emailed to you through it. See tools/email-relay.gs for the steps.
// contactEmail: used only when contactEndpoint is empty or sending fails, to open the visitor's email app
//   with the message written. Leave it empty to keep the address out of the site's public code.
globalThis.DP_CONFIG = {
  repo: "hsc-economics/dotpoint",
  contactEndpoint: "",
  contactEmail: "ethan.sn.tsui@gmail.com",
};
