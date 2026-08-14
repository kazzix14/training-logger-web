# TrainingLogger Web

TrainingLogger の プログラムリーダー・ビルダー(静的 HTML/JS)。
GitHub Pages: https://kazzix14.github.io/training-logger-web/

- アプリの「Webで開く」は `#p=<base64url(JSON)>` フラグメントでプログラムを渡す
  (フラグメントはサーバーに送信されない)
- 形式は traininglogger.program v2(本体リポジトリ docs/formats/program-json.md)
- 編集後は「JSONをコピー」してアプリの「JSONを読み込む」へ貼り戻す

本体リポジトリの submodule (`web/`) として管理し、push で Pages に自動デプロイされる。

## アーキテクチャ

- `Core/TrainingLoggerCore` は iOS アプリと Web が共有する Foundation のみの
  Swift コア。`CoreValidation.validate` が JSON エンベロープ検証の入口
- `CoreWasm` は共有コアを JSON 文字列 in/out の C ABI で公開する WASI
  reactor。GitHub Actions が SwiftWasm SDK で `core.wasm` を生成する
- `wasm-core.js` は vendored `@bjorn3/browser_wasi_shim` で wasm を初期化し、
  検証結果を UI に渡す
- JS フォールバックは廃止済み。wasm が未ロード・取得不可・実行失敗の場合は
  検証パネルに「Swiftコアを読み込めませんでした」を出す(= 壊れたら丸ごと
  使えない)
- C ABI を追加するときは `@_cdecl` / `wasm-core.js` の
  `REQUIRED_CORE_EXPORTS` / `pages.yml` の `-Xlinker --export=` の3点を
  必ず揃える。揃っていないと CI の `test-parity.mjs` が落ちる(ADR-0074 追記)

ローカル macOS に SwiftWasm ツールチェーンは不要。通常の SwiftPM ビルドで
共有コアと ABI のコンパイルを確認し、wasm の生成と JS とのパリティ検査は
Pages CI の `wasm` ジョブで行う。

## 開発

```sh
node test.mjs
node test-ui.mjs
node test-parity.mjs # core.wasm がなければ skip
(cd Core && swift build)
```
