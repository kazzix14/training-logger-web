# Vendored ESM

実行時の CDN 参照を避けるため、npm 公開版と同一の ESM 配布物を固定しています。

- `preact.module.js`: Preact 10.27.2 (`preact/dist/preact.module.js`)
- `htm.module.js`: htm 3.1.1 (`htm/dist/htm.module.js`)

取得元は npm 配布物をミラーする cdnjs の各リリースです。ライセンス本文は
`LICENSE.preact` と `LICENSE.htm` に同梱しています。
