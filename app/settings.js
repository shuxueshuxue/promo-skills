// What the card table's settings view and the image tool share (openrouterKey, imageModel; and writers: the agents
// ticked by default when a round is opened). settings.json lives in this App's own data folder on the
// person's computer (readData / writeData; GUGU_EXTENSION_DATA_DIR for the program) — never in the chat's table file,
// which everyone in the chat can read.
export const SETTINGS_FILE = 'settings.json'
/** OpenRouter's image model for storyboard frames and posters (the one the 2026-10-07 spike used). */
export const IMAGE_MODEL = 'openai/gpt-image-2.5-sunburst'

export function parseSettings(text) {
  try {
    const value = JSON.parse(text ?? '')
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  } catch {
    return {}
  }
}
