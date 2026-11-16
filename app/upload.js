// Videos a person uploads into a project, from the archive or from the project's 素材 stage: each file its own upload,
// all at once — none waits for another, each says where it stands. The bytes go through the platform's own
// files.upload into the chat folder (片场/<project>/), and each video becomes a 素材 card on the project's table.
import { UPLOAD_LIMIT, materialCard, materialFolder } from './model.js'

/** Every upload of this page, newest first: { key, name, size, project, state: up | done | bad, why?, entry? }. */
export const uploads = []

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`

/**
 * Upload `files` into a project: `table` is its open handle (the card goes on it), `by` who uploads. Resolves when all
 * are done; a file that fails says why on its own row and stops no other. `changed` redraws the rows.
 */
export function uploadInto(files, { chat, project, table, by }, changed) {
  return Promise.all([...files].map(async (file) => {
    const row = { key: crypto.randomUUID(), name: file.name, size: file.size, project, state: 'up' }
    uploads.unshift(row)
    changed()
    try {
      if (file.size > UPLOAD_LIMIT) throw Object.assign(new Error('too large'), { code: 'too-large' })
      const [entry] = await window.gugu.files.upload({ chat, folder: materialFolder(project) }, file)
      if (!entry?.id) throw new Error('the chat folder gave no file back')
      table.data.cards[`m${crypto.randomUUID().slice(0, 8)}`] = materialCard(entry, by, new Date().toISOString())
      Object.assign(row, { state: 'done', entry })
    } catch (error) {
      Object.assign(row, { state: 'bad', why: error.code === 'too-large' ? `超过 ${mb(UPLOAD_LIMIT)}，没有上传` : `没有上传：${error.message}` })
    }
    changed()
  }))
}

/** The rows, drawn into a list (hidden when there are none). `open(row)` is what a finished row's 打开 does, if given. */
export function drawUploads(list, open) {
  list.hidden = !uploads.length
  list.replaceChildren(...uploads.map((row) => {
    const li = document.createElement('li')
    const name = document.createElement('span')
    name.className = 'name'
    const where = document.createElement('small')
    where.className = 'muted'
    where.textContent = ` → ${row.project} · ${mb(row.size)}`
    name.append(row.name, where)
    const state = document.createElement('span')
    state.className = 'state'
    const word = document.createElement('small')
    word.className = row.state === 'bad' ? 'bad' : row.state === 'done' ? 'good' : 'muted'
    word.textContent = row.state === 'bad' ? row.why : row.state === 'done' ? '已上传' : '上传中'
    state.append(word)
    if (row.state === 'done' && open) {
      const button = document.createElement('button')
      button.className = 'sm'
      button.textContent = '打开'
      button.onclick = () => open(row)
      state.append(button)
    }
    li.append(name, state)
    // The platform says nothing of how far an upload into a chat is: the bar moves, it does not count.
    if (row.state === 'up') li.append(document.createElement('progress'))
    return li
  }))
}
