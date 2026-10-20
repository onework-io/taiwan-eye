# 繁體中文（`zh-TW`）

Catalog: `src/i18n/locales/zh-TW.json`. General rules: [TRANSLATORS.md](../TRANSLATORS.md).

Every Chinese browser tag (`zh`, `zh-TW`, `zh-Hant`, `zh-HK`, `zh-CN`) resolves to this catalog.

## Style

- 台灣慣用語與正體字：「影片」不是「視頻」，「軟體」不是「軟件」，「網路」不是「網絡」，「資料」不是「數據」（數據 only for numeric readouts），「設定」不是「設置」，「訊息」不是「信息」，「伺服器」不是「服務器」，「連線」，「載入」，「檔案」，「支援」，「預設」，「螢幕」，「滑鼠」。
- 以禮貌、簡潔的祈使句：「點選地圖」、「請再試一次」。不必加「您」除非句子需要。
- 全形標點：，。：；？！「」（）。英文/數字與中文之間加一個半形空格（「{count} 架飛機」、「Google Maps 金鑰」）。保留 `·`、`—`、`→`、`↗`、`…` 分隔符。
- UPPERCASE English HUD labels become short Chinese (2–4 字) — Chinese has no case; keep it terse: LIVE → 即時, SIMULATED → 模擬.
- Units: km、m、km/h、m/s、kn（節）、ft、h、min、s stay as symbols; MW stays MW. `°` and `%` stay.
- Keep product, provider, dataset names as in English (Google Maps, Cesium ion, OpenAI, USGS, OpenSky, ADS-B, AIS, CCTV, HUD, OpenStreetMap…), and keyboard keys (Space, Esc, Enter, Backspace).

## Plurals

Chinese has only the `other` form. A `tn()` entry is `{ "other": "…" }`.

## Glossary

| English                                    | 繁體中文                                       |
| ------------------------------------------ | ---------------------------------------------- |
| layer / data layer                         | 圖層 / 資料圖層                                |
| feed                                       | 資料流                                         |
| source / data source                       | 來源 / 資料來源                                |
| LIVE / live data                           | 即時 / 即時資料                                |
| SIMULATED                                  | 模擬                                           |
| stale / degraded / unavailable             | 過時 / 降級 / 無法使用                         |
| retry                                      | 重試                                           |
| key (API key) / POWER UP                   | 金鑰 / 強化（POWER UP 面板）                   |
| Provider Settings                          | 供應商設定                                     |
| globe / map / map source / basemap         | 地球 / 地圖 / 地圖來源 / 底圖                  |
| aircraft / flight / military flights       | 航空器（HUD 短：機）/ 航班 / 軍機              |
| vessel, ship                               | 船舶                                           |
| satellite                                  | 衛星                                           |
| launch (rocket) / space mission            | 發射 / 太空任務                                |
| contact / tracking / track                 | 目標 / 追蹤 / 追蹤                             |
| installation, site                         | 設施                                           |
| camera / CCTV camera                       | 攝影機 / CCTV 攝影機                           |
| earthquake / active fire                   | 地震 / 活躍火點                                |
| scene / shot / scene recipe                | 場景 / 鏡頭 / 場景配方                         |
| briefing / panel / dock                    | 簡報 / 面板 / 停駐列                           |
| preset / visual preset                     | 預設 / 視覺預設                                |
| Scope (circular viewport mask)             | 瞄準鏡                                         |
| heading / altitude / ground speed          | 航向 / 高度 / 地速                             |
| HDG / BRG / CRS / FOV / DEST / SPD / RANGE | 航向 / 方位 / 航線 / 視角 / 目的 / 速度 / 距離 |
| advisory (NHC/CPHC cyclone)                | 警報（颱風/氣旋公報）                          |
| cyclone / typhoon                          | 氣旋 / 颱風                                    |
| Street View (Google)                       | 街景服務                                       |
| WHOT/BHOT, Ironbow, CRT, NVG, FLIR         | 不翻譯                                         |
| PREV / NEXT                                | 上一個 / 下一個                                |
| Previous / Next (button)                   | 上一步 / 下一步                                |
| anchor / data pack / bundle                | 錨點 / 資料包 / 套件                           |
| camera move                                | 運鏡                                           |
| SIG / NEWS / LOCAL (briefing tabs)         | 訊號 / 新聞 / 在地                             |
| compass points N, NNE, E…                  | 北、北北東、東…                                |
| L / R (relative bearing)                   | 左 / 右                                        |
| bike share                                 | 公共自行車                                     |
| transit                                    | 大眾運輸                                       |
| voice agent                                | 語音助理                                       |
| Global Context                             | 全球情勢                                       |
| Contacts (roster)                          | 鄰近目標                                       |
| Director (scene director)                  | 導演模式                                       |
| Share Link                                 | 分享連結                                       |
| Reset Globe                                | 重設地球                                       |
