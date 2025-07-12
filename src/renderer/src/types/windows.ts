export type MiniWindowRoute = 'home' | 'chat' | 'translate' | 'summary' | 'explanation'

export interface ShowMiniWindowArgs {
  /**
   * The route to show in the mini window, default: 'home'
   */
  route?: MiniWindowRoute

  /**
   * The text to show in the mini window, default: ''
   */
  userInputText?: string

  /**
   * The text from clipboard to show in the mini window, default: ''
   */
  clipboardText?: string
}
