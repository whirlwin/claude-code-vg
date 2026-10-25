export type IsHidden = boolean

declare module 'claude-code' {
  interface PluginState {
    'vg': { isHidden: IsHidden }
  }
}
