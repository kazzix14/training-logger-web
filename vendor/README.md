# Vendored ESM

実行時の CDN 参照を避けるため、npm 公開版と同一の ESM 配布物を固定しています。

- `preact.module.js`: Preact 10.27.2 (`preact/dist/preact.module.js`)
- `htm.module.js`: htm 3.1.1 (`htm/dist/htm.module.js`)
- `browser-wasi-shim/`: @bjorn3/browser_wasi_shim 0.4.2 (`dist/*.js`)

Preact/htm は npm 配布物をミラーする cdnjs、browser_wasi_shim は npm
配布物をミラーする unpkg から取得しています。ライセンス本文は各配布物と
同じディレクトリに同梱しています。
