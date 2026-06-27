# Shindo Discord Bot

Discordで緊急地震速報と地震情報を通知するBOTです。

## Railwayで使う環境変数

Railwayのプロジェクト画面で `Variables` を開き、次の値を追加してください。

```env
TOKEN=Discord Bot Token
CLIENT_ID=Discord Application ID
GUILD_ID=Discord Server ID
```

`TOKEN` はDiscord Developer PortalのBot Tokenです。
`CLIENT_ID` はDiscord Developer PortalのApplication IDです。
`GUILD_ID` はBOTを使うDiscordサーバーのIDです。

## スラッシュコマンドを即時反映する方法

Discordのグローバルコマンドは反映まで時間がかかることがあります。
このBOTでは `GUILD_ID` を設定している場合、スラッシュコマンドをそのサーバー専用のギルドコマンドとして登録します。

ギルドコマンドは通常すぐ反映されるため、RailwayのVariablesに `GUILD_ID` を入れておくのがおすすめです。

複数サーバーで同じコマンドを使いたい場合は、`GUILD_ID` を外すとグローバルコマンドとして登録されます。ただし反映には時間がかかる場合があります。

## Railwayでの起動

Railwayでは `Dockerfile` を使って次の流れで動きます。

1. `npm run compile` でTypeScriptを `build/` に出力
2. `node build/deploy-commands.js` でスラッシュコマンドをDiscordへ登録
3. `npm start` でBOTを起動

## ローカルでの起動

`.env.example` を参考に `.env` を作成してください。

```powershell
npm.cmd run deploy-commands
npm.cmd run compile
npm.cmd start
```

通知先はDiscord上で `/set_eq_channel` を実行して設定します。
