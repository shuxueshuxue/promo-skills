// Which page Studio is: a project's card table when it was opened on a .studio.json (app.js), or the chat's archive of
// its projects when it opens no file in a chat (archive.js). Projects live in a chat: opened anywhere else (the App's own
// page from the rail or the market, which has no chat), there is no archive to draw — only where to open it instead.
const ctx = await window.gugu.getContext()
if (ctx.file) await import('./app.js')
else if (ctx.chat?.id) await import('./archive.js')
else document.querySelector('#status').textContent = '片场的工程在群里：在一个群里打开片场。'
