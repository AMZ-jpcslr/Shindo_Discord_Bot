# READMEの掲載画像

掲載画像は、リポジトリ内の既存PNGを加工せずにコピーしたものです。Discordアプリのスクリーンショットではなく、実際の画像生成処理の出力または既存サンプルです。現在の災害・気象情報として利用しないでください。

| 掲載ファイル | 元ファイル | 内容 |
| --- | --- | --- |
| `weather-radar.png` | `sample-output/weather-radar.png` | 2026年9月22日のAPI接続検証で生成した、東京都千代田区周辺の雨雲画像 |
| `earthquake-intensity.png` | `sample-output/sample-earthquake-intensity-20260728162718.png` | 既存の震度分布サンプル。ファイル名の日時から実際の地震発生日時は断定していません |
| `tsunami-advisory.png` | `sample-output/sample-tsunami-advisory-20260728162718.png` | 既存の津波注意報マップのサンプル。実際の発表状況を証明する画像ではありません |

雨雲画像の更新には、リポジトリのルートで次を実行します。

```sh
npm run compile
node scripts/smoke.cjs
```

生成された `sample-output/weather-radar.png` をこのディレクトリの `weather-radar.png` にコピーし、READMEのキャプションとこの表の取得日を合わせて更新してください。接続確認時に出力される画像の対象時刻も確認します。接続テストはDiscordにメッセージを送信しません。

雨雲画像の出典は気象庁・地理院タイルです。地震・津波マップの背景はCARTO／OpenStreetMapです。出典リンクはルートのREADMEに記載しています。
