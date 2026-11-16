// Which page Studio is: a project's card table when it was opened on a .studio.json (app.js), the chat's archive of
// its projects on the App's own page, the tab `projects` that opens no file (archive.js) — an App's main page is a tab
// that opens no file, so the archive is what 打开 on Studio's card and the rail open.
const ctx = await window.gugu.getContext()
await import(ctx.file ? './app.js' : './archive.js')
