# TrainingLogger Web

TrainingLogger の プログラムリーダー・ビルダー(静的 HTML/JS)。
GitHub Pages: https://kazzix14.github.io/training-logger-web/

- アプリの「Webで開く」は `#p=<base64url(JSON)>` フラグメントでプログラムを渡す
  (フラグメントはサーバーに送信されない)
- 形式は traininglogger.program v1(本体リポジトリ docs/formats/program-json.md)
- 編集後は「JSONをコピー」してアプリの「JSONを読み込む」へ貼り戻す

本体リポジトリの submodule (`web/`) として管理し、push で Pages に自動デプロイされる。

## アーキテクチャ

- `Core/TrainingLoggerCore` は iOS アプリと Web が共有する Foundation のみの
  Swift コア。`CoreValidation.validate` が JSON エンベロープ検証の入口
- `CoreWasm` は共有コアを JSON 文字列 in/out の C ABI で公開する WASI
  reactor。GitHub Actions が SwiftWasm SDK で `core.wasm` を生成する
- `wasm-core.js` は vendored `@bjorn3/browser_wasi_shim` で wasm を初期化し、
  検証結果を UI に渡す
- wasm が未ロード、取得不可、または実行失敗の場合は `logic.js` の同じ検証へ
  自動的にフォールバックする。検証パネルの `wasm ⚙︎` / `js` が使用中の
  エンジンを示す

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
