# Shindo Discord Bot

Discordで緊急地震速報と地震情報を通知するBOTです。

## Railwayで使う環境変数

Railwayのプロジェクト画面で `Variables` を開き、次の2つを追加してください。

```env
TOKEN=Discord Bot Token
CLIENT_ID=Discord Application Client ID
```

`TOKEN` はDiscord Developer PortalのBot Tokenです。
`CLIENT_ID` はDiscord Developer PortalのApplication IDです。

## Railwayでの起動

このリポジトリには `railway.json` を入れてあるので、Railwayでは次の流れで動きます。

1. `npm run compile` でTypeScriptを `build/` に出力
2. `npm run deploy-commands` でスラッシュコマンドをDiscordへ登録
3. `npm start` でBOTを起動

## ローカルでの起動

`.env.example` を参考に `.env` を作成してください。

```powershell
npm.cmd run deploy-commands
npm.cmd run compile
npm.cmd start
```

通知先はDiscord上で `/set_eq_channel` を実行して設定します。
