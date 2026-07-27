# TrainingLogger Web

TrainingLogger の プログラムリーダー・ビルダー(静的 HTML/JS)。
GitHub Pages: https://kazzix14.github.io/training-logger-web/

- アプリの「Webで開く」は `#p=<base64url(JSON)>` フラグメントでプログラムを渡す
  (フラグメントはサーバーに送信されない)
- 形式は traininglogger.program v1(本体リポジトリ docs/formats/program-json.md)
- 編集後は「JSONをコピー」してアプリの「JSONを読み込む」へ貼り戻す

本体リポジトリの submodule (`web/`) として管理し、push で Pages に自動デプロイされる。

## 開発

```sh
node test.mjs
```
